import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE = '/dance-musicality-visualizer/';
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const AUDIO_TYPES = new Set(['application/octet-stream', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac', 'audio/ogg', 'audio/webm', 'video/mp4', 'video/webm']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseOrigins(value = '') {
  const origins = new Set();
  for (const entry of value.split(',').map(item => item.trim()).filter(Boolean)) {
    let url;
    try { url = new URL(entry); } catch { throw new Error('ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== entry || url.username || url.password) throw new Error('ALLOWED_ORIGINS accepts exact HTTP(S) origins without paths, trailing slashes, or wildcards.');
    origins.add(entry);
  }
  return origins;
}

function constantTimeEqual(value, expected) {
  if (typeof value !== 'string' || !expected) return false;
  const a = createHash('sha256').update(value).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function configuredCredential(req, configuredKey, accessToken) {
  if (!configuredKey || !accessToken) throw new HttpError(503, 'This hosted service has not been configured.');
  if (!constantTimeEqual(req.headers['x-app-token'], accessToken)) throw new HttpError(401, 'A valid app access token is required for the hosted service.');
  return configuredKey;
}

function transcriptionCredential(req, env) {
  const authorization = req.headers.authorization;
  if (authorization !== undefined) {
    const match = /^Bearer ([^\s]{1,512})$/i.exec(authorization);
    if (!match) throw new HttpError(401, 'Use a valid Bearer key for personal transcription.');
    return match[1];
  }
  return configuredCredential(req, env.OPENAI_API_KEY, env.APP_ACCESS_TOKEN);
}

function json(res, status, body, headers = {}) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, maxBytes, timeoutMs, sizeMessage = 'Audio must be no larger than 25 MB.') {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, sizeMessage);
  return new Promise((resolveBody, reject) => {
    let bytes = 0;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAbort); req.off('error', onError); };
    const fail = error => { cleanup(); req.resume(); reject(error); };
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { fail(new HttpError(413, sizeMessage)); return; }
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolveBody(Buffer.concat(chunks, bytes)); };
    const onAbort = () => fail(new HttpError(400, 'The audio upload was interrupted.'));
    const onError = () => fail(new HttpError(400, 'The audio upload failed.'));
    const timer = setTimeout(() => fail(new HttpError(408, 'The audio upload timed out.')), timeoutMs);
    req.on('data', onData); req.on('end', onEnd); req.on('aborted', onAbort); req.on('error', onError);
  });
}

function safeFilename(value, mime) {
  const defaultExtension = mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm' : mime.includes('ogg') ? 'ogg' : mime.includes('flac') ? 'flac' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'mp3';
  const filename = String(value || `audio.${defaultExtension}`).split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._ -]/g, '_').slice(-120);
  if (!/\.(mp3|mp4|mpeg|mpga|m4a|wav|webm|flac|ogg)$/i.test(filename)) throw new HttpError(415, 'Use an MP3, MP4, M4A, WAV, WebM, FLAC, or OGG audio file.');
  return filename;
}

function upstreamError(status, service) {
  if (status === 429) return new HttpError(429, `${service} quota or rate limit reached. Try again later or check the provider account.`);
  if (status === 401 || status === 403) return new HttpError(502, `${service} rejected the provider credentials or their permissions.`);
  if (status === 413) return new HttpError(413, 'The transcription provider rejected the audio size. Use a file under 25 MB.');
  if (status === 400 && service === 'Transcription') return new HttpError(422, 'The transcription provider could not read this audio. Try a supported audio format.');
  return new HttpError(502, `${service} is unavailable. Try again later.`);
}

async function providerJSON(fetchImpl, url, options, timeoutMs, res, service) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  res.once('close', abort);
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw upstreamError(response.status, service);
    try { return await response.json(); } catch { throw new HttpError(502, `${service} returned an unreadable response.`); }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (timedOut) throw new HttpError(504, `${service} timed out. Try again with a shorter file.`);
    throw new HttpError(502, `${service} could not be reached. Try again later.`);
  } finally {
    clearTimeout(timeout); res.off('close', abort);
  }
}

export function createApp({ env = process.env, fetchImpl = globalThis.fetch, distDir = resolve(HERE, '../dist'), limits = {} } = {}) {
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS);
  const maxBytes = limits.maxBytes ?? 25_000_000;
  const bodyTimeoutMs = limits.bodyTimeoutMs ?? 30_000;
  const upstreamTimeoutMs = limits.upstreamTimeoutMs ?? 90_000;
  const maxConcurrent = limits.maxConcurrent ?? 2;
  const maxRequests = limits.maxRequests ?? 20;
  const windowMs = limits.windowMs ?? 60_000;
  const rates = new Map();
  let concurrent = 0;

  function rateLimit(req, credential) {
    const now = Date.now();
    for (const [key, value] of rates) if (now >= value.resetAt) rates.delete(key);
    const identity = createHash('sha256').update(`${req.socket.remoteAddress}\n${credential}`).digest('hex');
    let entry = rates.get(identity);
    if (!entry) {
      if (rates.size >= 1000) throw new HttpError(429, 'The service is busy. Try again shortly.');
      entry = { count: 0, resetAt: now + windowMs }; rates.set(identity, entry);
    }
    if (entry.count >= maxRequests) throw new HttpError(429, 'Too many requests. Wait a minute before trying again.');
    entry.count++;
    if (concurrent >= maxConcurrent) throw new HttpError(429, 'The service is processing other requests. Try again shortly.');
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const origin = req.headers.origin;
    if (origin) {
      let sameOrigin = false;
      try {
        const candidate = new URL(origin);
        // Render terminates TLS before forwarding to Node. Browsers cannot add
        // this custom header through our allowed preflight headers.
        const protocol = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
        sameOrigin = candidate.origin === origin && candidate.protocol === protocol && candidate.host === req.headers.host;
      } catch { /* Untrusted origin is rejected below. */ }
      if (!sameOrigin && !allowedOrigins.has(origin)) { json(res, 403, { error: 'This origin is not allowed.' }); return; }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    let acquired = false;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') {
        if (!origin || !url.pathname.startsWith('/api/')) throw new HttpError(400, 'A permitted origin and API route are required.');
        const method = req.headers['access-control-request-method'];
        const requestHeaders = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!['GET', 'POST'].includes(method) || requestHeaders.some(header => !['authorization', 'content-type', 'x-file-name', 'x-app-token'].includes(header))) throw new HttpError(403, 'This cross-origin request is not allowed.');
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name, X-App-Token', 'Access-Control-Max-Age': '600' }); res.end(); return;
      }
      if (url.pathname === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true }); return; }
      if (url.pathname === '/api/transcribe') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'Use POST for transcription.'); }
        const credential = transcriptionCredential(req, env);
        const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!AUDIO_TYPES.has(mime)) throw new HttpError(415, 'Send the raw audio file with its audio Content-Type.');
        if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new HttpError(415, 'Compressed request bodies are not supported.');
        const filename = safeFilename(req.headers['x-file-name'], mime);
        rateLimit(req, credential); concurrent++; acquired = true;
        const body = await readBody(req, maxBytes, bodyTimeoutMs);
        if (!body.length) throw new HttpError(400, 'Choose a nonempty audio file.');
        const form = new FormData();
        form.append('file', new Blob([body], { type: mime }), filename);
        form.append('model', 'whisper-1');
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'word');
        const result = await providerJSON(fetchImpl, 'https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: form }, upstreamTimeoutMs, res, 'Transcription');
        if (!Array.isArray(result.words)) throw new HttpError(502, 'Transcription returned no word timestamps. Try another audio file.');
        const words = result.words.filter(word => Number.isFinite(word?.start) && Number.isFinite(word?.end) && word.start >= 0 && word.end >= word.start && typeof (word.word ?? word.text) === 'string').map(word => ({ start: word.start, end: word.end, text: (word.word ?? word.text).trim() })).filter(word => word.text).sort((a, b) => a.start - b.start);
        json(res, 200, { words, model: 'whisper-1' }); return;
      }
      if (url.pathname === '/api/review') {
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST for review advice.');
        const credential = transcriptionCredential(req, {OPENAI_API_KEY:env.TYPESAFE_API_KEY,APP_ACCESS_TOKEN:env.APP_ACCESS_TOKEN});
        if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') throw new HttpError(415, 'Send review metrics as JSON.');
        rateLimit(req, credential); concurrent++; acquired = true;
        const body = await readBody(req, 16_384, bodyTimeoutMs, 'Review requests must be smaller than 16 KB.');
        let input;
        try { input = JSON.parse(body.toString()); } catch { throw new HttpError(400, 'Invalid review data.'); }
        if (!input || typeof input !== 'object' || typeof input.hasAudio !== 'boolean' || typeof input.hasVideo !== 'boolean' || !Number.isFinite(input.bpm) || input.bpm < 40 || input.bpm > 240 || !Number.isInteger(input.syllableCount) || input.syllableCount < 0 || input.syllableCount > 10000 || !Number.isFinite(input.beatConfidence) || input.beatConfidence < 0 || input.beatConfidence > 1 || typeof input.note !== 'string' || input.note.length > 500) throw new HttpError(400, 'Provide valid project metrics and a note of up to 500 characters.');
        // Whitelist metrics: raw media, lyric text, keys and extra caller fields never reach JEV.
        const state = {hasAudio:input.hasAudio,hasVideo:input.hasVideo,bpm:input.bpm,syllableCount:input.syllableCount,beatConfidence:input.beatConfidence,note:input.note};
        const criteria = {
          check_tempo: 'Check estimated tempo with tap, half or double controls when the pulse is uncertain or counts drift.',
          choose_count1: 'Choose the dance phrase start when the beat spacing is right but count one is displaced.',
          review_lyrics: 'Add or correct lyric text and estimated syllable timing.',
          align_video: 'Align matching song/video frames and check multiple landmarks.',
          practice: 'Practice an eight at reduced speed after reviewing timing.'
        };
        const payload = {model:env.TYPESAFE_MODEL || 'jev-latest',state,questions:{next_action:{type:'choice',instructions:'Recommend one next review step for this dance musicality editor using the metrics and user note as data. You have no access to audio or video; do not claim to hear it or certify correctness. This is advisory and must not alter timing.',criteria}}};
        const result = await providerJSON(fetchImpl, 'https://api.typesafe.ai/v1/systemone', {method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}, upstreamTimeoutMs, res, 'JEV review');
        const choice = result?.answers?.next_action?.choice;
        if (!Object.hasOwn(criteria, choice || '')) throw new HttpError(502, 'JEV returned an unrecognized review suggestion.');
        json(res, 200, {action:choice,suggestion:criteria[choice],model:typeof result.model==='string'?result.model:payload.model}); return;
      }
      if (url.pathname === '/api/youtube-search') {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); throw new HttpError(405, 'Use GET for video search.'); }
        const credential = configuredCredential(req, env.YOUTUBE_API_KEY, env.APP_ACCESS_TOKEN);
        const query = (url.searchParams.get('q') || '').trim();
        if (!query || query.length > 200) throw new HttpError(400, 'Enter search words between 1 and 200 characters.');
        rateLimit(req, credential); concurrent++; acquired = true;
        const endpoint = new URL('https://www.googleapis.com/youtube/v3/search');
        endpoint.search = new URLSearchParams({ part: 'snippet', q: query, type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true', maxResults: '8', key: credential }).toString();
        const result = await providerJSON(fetchImpl, endpoint.toString(), { method: 'GET' }, upstreamTimeoutMs, res, 'YouTube search');
        if (!Array.isArray(result.items)) throw new HttpError(502, 'YouTube search returned an unexpected response.');
        const videos = result.items.filter(item => VIDEO_ID.test(item?.id?.videoId || '')).map(item => ({ id: item.id.videoId, title: String(item.snippet?.title || 'YouTube video'), channel: String(item.snippet?.channelTitle || ''), thumbnail: `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg` }));
        json(res, 200, { videos }); return;
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid URL.'); }
      if (pathname.includes('\0') || pathname.includes('\\')) throw new HttpError(400, 'Invalid URL.');
      if (pathname === DEFAULT_BASE.slice(0, -1)) { res.writeHead(308, { Location: DEFAULT_BASE }); res.end(); return; }
      if (pathname.startsWith(DEFAULT_BASE)) pathname = pathname.slice(DEFAULT_BASE.length);
      else pathname = pathname.replace(/^\//, '');
      if (!pathname) pathname = 'index.html';
      const path = resolve(distDir, pathname);
      if (!path.startsWith(resolve(distDir) + sep)) throw new HttpError(404, 'Not found.');
      let info;
      try { info = await stat(path); } catch { throw new HttpError(404, 'Not found.'); }
      if (!info.isFile()) throw new HttpError(404, 'Not found.');
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': extname(path) === '.html' ? 'no-cache' : pathname.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(path);
      stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 413 || status === 408) res.setHeader('Connection', 'close');
      if (status === 429) res.setHeader('Retry-After', '60');
      json(res, status, { error: error instanceof HttpError ? error.message : 'The service could not complete this request.' });
    } finally {
      if (acquired) concurrent--;
    }
  });
  server.requestTimeout = bodyTimeoutMs;
  server.headersTimeout = Math.min(bodyTimeoutMs, 15_000);
  server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const server = createApp();
  server.listen(port, '0.0.0.0', () => console.log(`Musicality Studio listening on port ${port}`));
  const stop = () => { server.close(); setTimeout(() => process.exit(0), 10_000).unref(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
