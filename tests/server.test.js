import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/server.mjs';

const HOSTED = { OPENAI_API_KEY: 'hosted-openai-secret', YOUTUBE_API_KEY: 'hosted-youtube-secret', APP_ACCESS_TOKEN: 'app-access-secret' };
const AUTH = { 'X-App-Token': HOSTED.APP_ACCESS_TOKEN };
const AUDIO = { 'Content-Type': 'audio/wav', 'X-File-Name': 'song.wav' };
const transcript = { words: [{ start: 0.2, end: 0.5, word: ' hello ' }, { start: -1, end: 0, word: 'invalid' }, { start: 0.7, end: 1, word: 'world' }] };
const providerResponse = (body = transcript, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function start(t, overrides = {}) {
  const server = createApp({ env: {}, fetchImpl: () => assert.fail('Unexpected provider request'), ...overrides });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function upload(base, headers = {}, body = 'audio bytes') {
  return fetch(`${base}/api/transcribe`, { method: 'POST', headers: { ...AUDIO, ...headers }, body });
}

test('health response reveals no provider configuration', async t => {
  const base = await start(t, { env: HOSTED });
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('configured paid keys refuse requests without configured and matching app tokens', async t => {
  const missingToken = await start(t, { env: { OPENAI_API_KEY: HOSTED.OPENAI_API_KEY, YOUTUBE_API_KEY: HOSTED.YOUTUBE_API_KEY } });
  assert.equal((await upload(missingToken)).status, 503);
  assert.equal((await fetch(`${missingToken}/api/youtube-search?q=dance`)).status, 503);
  const configured = await start(t, { env: HOSTED });
  for (const headers of [{}, { 'X-App-Token': 'wrong-token' }]) {
    assert.equal((await upload(configured, headers)).status, 401);
    assert.equal((await fetch(`${configured}/api/youtube-search?q=dance`, { headers })).status, 401);
  }
  assert.equal((await upload(configured, { Authorization: 'invalid', ...AUTH })).status, 401);
});

test('hosted transcription sends raw audio only to the fixed OpenAI endpoint and returns timed words', async t => {
  let called = false;
  const base = await start(t, { env: HOSTED, fetchImpl: async (url, options) => {
    called = true;
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, `Bearer ${HOSTED.OPENAI_API_KEY}`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('model'), 'whisper-1');
    assert.equal(options.body.get('response_format'), 'verbose_json');
    assert.equal(options.body.get('timestamp_granularities[]'), 'word');
    const file = options.body.get('file');
    assert.equal(file.name, 'song.wav');
    assert.equal(file.type, 'audio/wav');
    assert.equal(await file.text(), 'audio bytes');
    return providerResponse();
  } });
  const response = await upload(base, AUTH);
  assert.equal(response.status, 200);
  assert.ok(called);
  assert.deepEqual(await response.json(), { model: 'whisper-1', words: [{ start: 0.2, end: 0.5, text: 'hello' }, { start: 0.7, end: 1, text: 'world' }] });
});

test('personal keys work without configured credentials and override a hosted key for that request', async t => {
  for (const env of [{}, HOSTED]) {
    const base = await start(t, { env, fetchImpl: async (_, options) => {
      assert.equal(options.headers.Authorization, 'Bearer personal-openai-secret');
      return providerResponse();
    } });
    assert.equal((await upload(base, { Authorization: 'Bearer personal-openai-secret' })).status, 200);
  }
});

test('CORS accepts configured exact origins and same origin, rejecting other origins before provider access', async t => {
  const base = await start(t, { env: { ...HOSTED, ALLOWED_ORIGINS: 'https://luckwei.github.io' } });
  for (const origin of ['https://untrusted.example', 'https://luckwei.github.io.evil.example', 'null', base.replace('http:', 'https:')]) {
    const response = await upload(base, { ...AUTH, Origin: origin });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  for (const origin of [base, 'https://luckwei.github.io']) {
    const response = await fetch(`${base}/api/health`, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  const preflight = await fetch(`${base}/api/transcribe`, { method: 'OPTIONS', headers: { Origin: 'https://luckwei.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, x-file-name, x-app-token' } });
  assert.equal(preflight.status, 204);
  const forbidden = await fetch(`${base}/api/transcribe`, { method: 'OPTIONS', headers: { Origin: base, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-forwarded-proto' } });
  assert.equal(forbidden.status, 403);
  assert.throws(() => createApp({ env: { ALLOWED_ORIGINS: '*' } }), /ALLOWED_ORIGINS/);
  assert.throws(() => createApp({ env: { ALLOWED_ORIGINS: 'https://example.com/path' } }), /ALLOWED_ORIGINS/);
});

test('request bodies enforce size and format before provider requests, including chunked uploads', async t => {
  const base = await start(t, { env: HOSTED, limits: { maxBytes: 8 } });
  assert.equal((await upload(base, AUTH, '123456789')).status, 413);
  assert.equal((await upload(base, AUTH, '')).status, 400);
  assert.equal((await upload(base, { ...AUTH, 'Content-Type': 'text/html' }, '123')).status, 415);
  assert.equal((await upload(base, { ...AUTH, 'X-File-Name': 'script.html' }, '123')).status, 415);
  assert.equal((await upload(base, { ...AUTH, 'Content-Encoding': 'gzip' }, '123')).status, 415);
  const response = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/transcribe`, { method: 'POST', headers: { ...AUTH, ...AUDIO, 'Transfer-Encoding': 'chunked' } }, res => {
      res.resume(); res.on('end', () => resolve(res));
    });
    req.on('error', reject); req.write('12345'); req.end('67890');
  });
  assert.equal(response.statusCode, 413);
});

test('hosted YouTube search uses official embeddable video filtering and bounded result shapes', async t => {
  const base = await start(t, { env: HOSTED, fetchImpl: async (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, 'https://www.googleapis.com');
    assert.equal(endpoint.pathname, '/youtube/v3/search');
    assert.equal(endpoint.searchParams.get('q'), 'dance & song');
    assert.equal(endpoint.searchParams.get('key'), HOSTED.YOUTUBE_API_KEY);
    assert.equal(endpoint.searchParams.get('videoEmbeddable'), 'true');
    assert.equal(endpoint.searchParams.get('videoSyndicated'), 'true');
    assert.equal(options.redirect, 'error');
    return providerResponse({ items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Song', channelTitle: 'Artist' } }, { id: { videoId: 'invalid' } }] });
  } });
  const response = await fetch(`${base}/api/youtube-search?q=dance%20%26%20song`, { headers: AUTH });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { videos: [{ id: 'dQw4w9WgXcQ', title: 'Song', channel: 'Artist', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' }] });
});

test('provider errors redact bodies and transport errors, and timeouts are bounded', async t => {
  const base = await start(t, { env: HOSTED, fetchImpl: async () => providerResponse({ error: { message: 'SECRET-PROVIDER-DETAILS' } }, 401) });
  const response = await upload(base, AUTH);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('SECRET'));
  const networkFailure = await start(t, { env: HOSTED, fetchImpl: async () => { throw new Error('URL CONTAINS SECRET'); } });
  const failure = await upload(networkFailure, AUTH);
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes('SECRET'));
  const timeout = await start(t, { env: HOSTED, limits: { upstreamTimeoutMs: 10 }, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) });
  assert.equal((await upload(timeout, AUTH)).status, 504);
});

test('rate and concurrency limits prevent extra provider work', async t => {
  let calls = 0;
  const base = await start(t, { env: HOSTED, limits: { maxRequests: 2 }, fetchImpl: async () => { calls++; return providerResponse(); } });
  assert.equal((await upload(base, AUTH)).status, 200);
  assert.equal((await upload(base, AUTH)).status, 200);
  const limited = await upload(base, AUTH);
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(calls, 2);

  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const blocking = await start(t, { env: HOSTED, limits: { maxConcurrent: 1 }, fetchImpl: async () => { started(); return new Promise(resolve => { release = () => resolve(providerResponse()); }); } });
  const first = upload(blocking, AUTH);
  await began;
  assert.equal((await upload(blocking, AUTH)).status, 429);
  release(); assert.equal((await first).status, 200);
});

test('serves built files at root and Pages base without exposing files outside dist', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'musicality-server-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const dist = join(temp, 'dist'); await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<h1>Studio</h1>');
  await writeFile(join(dist, 'assets', 'app.js'), 'export const ready = true;');
  await writeFile(join(temp, 'secret.txt'), 'OUTSIDE-DIST-SECRET');
  const base = await start(t, { distDir: dist });
  for (const route of ['/', '/dance-musicality-visualizer/']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200); assert.equal(await response.text(), '<h1>Studio</h1>');
  }
  const asset = await fetch(`${base}/dance-musicality-visualizer/assets/app.js`);
  assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/);
  const traversal = await fetch(`${base}/%2e%2e%2fsecret.txt`);
  assert.equal(traversal.status, 404); assert.ok(!(await traversal.text()).includes('OUTSIDE-DIST-SECRET'));
  assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);
});

test('JEV review uses typed decisions and whitelists metrics without sending media or lyrics', async t => {
  const payload = {hasAudio:true,hasVideo:false,bpm:120,syllableCount:12,beatConfidence:.2,note:'The count feels too fast',lyrics:'private lyrics',audio:'private bytes'};
  const base = await start(t,{env:{TYPESAFE_API_KEY:'typesafe-secret',APP_ACCESS_TOKEN:HOSTED.APP_ACCESS_TOKEN},fetchImpl:async(url,options)=>{
    assert.equal(url,'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.headers.Authorization,'Bearer typesafe-secret');
    const sent=JSON.parse(options.body);
    assert.equal(sent.model,'jev-latest');assert.equal(sent.questions.next_action.type,'choice');
    assert.equal(sent.state.lyrics,undefined);assert.equal(sent.state.audio,undefined);
    assert.equal(sent.state.note,payload.note);
    return providerResponse({model:'jev-latest',answers:{next_action:{type:'choice',choice:'check_tempo'}}});
  }});
  assert.equal((await fetch(`${base}/api/review`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,401);
  const response=await fetch(`${base}/api/review`,{method:'POST',headers:{...AUTH,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(response.status,200);assert.equal((await response.json()).action,'check_tempo');
  assert.equal((await fetch(`${base}/api/review`,{method:'POST',headers:{...AUTH,'Content-Type':'application/json'},body:JSON.stringify({...payload,note:'a'.repeat(501)})})).status,400);
});

test('personal JEV key is isolated from other provider keys and unknown decisions are rejected', async t => {
  const base=await start(t,{fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer personal-jev');return providerResponse({answers:{next_action:{choice:'run_arbitrary_command'}}});}});
  const response=await fetch(`${base}/api/review`,{method:'POST',headers:{Authorization:'Bearer personal-jev','Content-Type':'application/json'},body:JSON.stringify({hasAudio:true,hasVideo:true,bpm:120,syllableCount:0,beatConfidence:.5,note:''})});
  assert.equal(response.status,502);assert.match((await response.json()).error,/unrecognized/);
});

test('downloads require explicit enablement and app token before invoking a subprocess', async t => {
 const post=(base,headers={},body={id:'v1t4MTqdfyI',format:'mp3'})=>fetch(`${base}/api/youtube-download`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const disabled=await start(t,{downloadImpl:()=>assert.fail('must not download')});assert.equal((await post(disabled,AUTH)).status,503);
 const enabled=await start(t,{env:{ENABLE_YOUTUBE_DOWNLOADS:'true',APP_ACCESS_TOKEN:HOSTED.APP_ACCESS_TOKEN},downloadImpl:()=>assert.fail('must not download')});
 assert.equal((await post(enabled)).status,401);assert.equal((await post(enabled,{'X-App-Token':'wrong'})).status,401);
 for(const body of [null,{id:'http://127.0.0.1/',format:'mp3'},{id:'v1t4MTqdfyI',format:'--exec'},{id:'v1t4MTqdfyI',format:'wav'}])assert.equal((await post(enabled,AUTH,body)).status,400);
 assert.equal((await post(enabled,AUTH,{id:'a'.repeat(2000),format:'mp3'})).status,413);
 assert.equal((await fetch(`${enabled}/api/youtube-download`)).status,405);
 assert.equal((await post(enabled,{...AUTH,Origin:'https://untrusted.example'})).status,403);
});

test('downloads stream the requested format and clean up after the response',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'download-api-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'fixture');await writeFile(path,'binary media');let calls=0,cleaned=0,finishCleanup;const cleanupDone=new Promise(resolve=>finishCleanup=resolve);
 const base=await start(t,{env:{ENABLE_YOUTUBE_DOWNLOADS:'true',APP_ACCESS_TOKEN:HOSTED.APP_ACCESS_TOKEN},downloadImpl:async options=>{
  assert.equal(options.id,'v1t4MTqdfyI');assert.ok(['mp3','mp4'].includes(options.format));assert.ok(options.signal instanceof AbortSignal);calls++;
  return {path,size:12,cleanup:async()=>{cleaned++;if(cleaned===2)finishCleanup();}};
 }});
 for(const format of ['mp3','mp4']){
  const response=await fetch(`${base}/api/youtube-download`,{method:'POST',headers:{...AUTH,'Content-Type':'application/json'},body:JSON.stringify({id:'v1t4MTqdfyI',format})});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),format==='mp3'?'audio/mpeg':'video/mp4');
  assert.match(response.headers.get('content-disposition'),new RegExp(`youtube-v1t4MTqdfyI\\.${format}`));assert.equal(await response.text(),'binary media');
 }
 assert.equal(calls,2);await cleanupDone;assert.equal(cleaned,2);
});
