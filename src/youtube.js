// YouTube is used through its official search and player APIs. Embedded media
// stays on YouTube; audio samples cannot be read from this cross-origin player.
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export function parseYouTubeId(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (VIDEO_ID.test(text)) return text;
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  let id;
  if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split('/')[2];
  }
  return VIDEO_ID.test(id || '') ? id : null;
}

function searchError(status, payload) {
  const reasons = payload?.error?.errors?.map(error => error.reason) || [];
  if (status === 429 || reasons.some(reason => /quota|rateLimit|dailyLimit/i.test(reason))) return 'YouTube search quota is exhausted for this key. Try a different key or paste a video link.';
  if (status === 401 || status === 403 || reasons.some(reason => /keyInvalid|accessNotConfigured/i.test(reason))) return 'YouTube rejected this API key. Enable YouTube Data API v3 and allow this site in the key’s website restrictions.';
  if (status === 400) return 'YouTube could not accept this search. Check your API key and search words.';
  return 'YouTube search is unavailable right now. Try again or paste a video link.';
}

export async function searchYouTubeVideos(query, apiKey, { signal, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const search = String(query || '').trim();
  const key = String(apiKey || '').trim();
  if (!search) throw new Error('Enter a song, artist, or choreography to search.');
  if (!key) throw new Error('Add a YouTube Data API key to search here, or paste a YouTube link without a key.');
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.search = new URLSearchParams({ part: 'snippet', q: search, type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true', maxResults: '8', key }).toString();
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), { signal: controller.signal, credentials: 'omit', redirect: 'error' });
    let payload;
    try { payload = await response.json(); } catch { throw new Error('YouTube returned an unreadable response. Try again.'); }
    if (!response.ok) throw new Error(searchError(response.status, payload));
    if (!Array.isArray(payload.items)) throw new Error('YouTube returned an unexpected response. Try again.');
    return payload.items.filter(item => VIDEO_ID.test(item?.id?.videoId || '')).map(item => ({
      id: item.id.videoId,
      title: String(item.snippet?.title || 'YouTube video'),
      channel: String(item.snippet?.channelTitle || ''),
      // Build the official image URL from the validated ID, never arbitrary API URLs.
      thumbnail: `https://i.ytimg.com/vi/${item.id.videoId}/mqdefault.jpg`,
    }));
  } catch (error) {
    if (timedOut) throw new Error('YouTube search timed out. Check your connection and try again.');
    if (signal?.aborted || error.name === 'AbortError') throw error;
    if (error instanceof TypeError) throw new Error('Could not reach YouTube search. Check your connection or paste a video link.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

let iframeAPIPromise;
function loadIframeAPI() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (iframeAPIPromise) return iframeAPIPromise;
  iframeAPIPromise = new Promise((resolve, reject) => {
    const previous = globalThis.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const cleanup = () => { clearTimeout(timeout); globalThis.onYouTubeIframeAPIReady = previous; };
    const fail = () => { cleanup(); script.remove(); iframeAPIPromise = undefined; reject(new Error('The YouTube player could not load. Check your connection or browser content blockers.')); };
    const timeout = setTimeout(fail, 20000);
    globalThis.onYouTubeIframeAPIReady = () => {
      cleanup();
      resolve(globalThis.YT);
      if (typeof previous === 'function') previous();
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
  return iframeAPIPromise;
}

export function youtubePlayerError(code) {
  if (code === 100) return 'This YouTube video is unavailable or private. Choose another video.';
  if (code === 101 || code === 150) return 'The owner disabled embedded playback for this video. Choose another video or open it on YouTube.';
  if (code === 153) return 'YouTube could not identify this website. Open the app on its published HTTPS address and allow the browser to send its origin.';
  if (code === 2) return 'This YouTube video link is invalid.';
  return 'YouTube could not play this video. Try another video or open it on YouTube.';
}

export class YouTubePlayer {
  constructor(container, { onError = () => {}, onStateChange = () => {}, onReady = () => {} } = {}) {
    this.container = container;
    this.onError = onError;
    this.onStateChange = onStateChange;
    this.onReady = onReady;
    this.player = null;
    this.ready = false;
    this.destroyed = false;
    this.volume = 1;
    this.rate = 1;
    this.loadSequence = 0;
  }

  async init() {
    if (this.destroyed) throw new Error('This video player has been closed.');
    if (this.ready) return;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const YT = await loadIframeAPI();
      if (this.destroyed) throw new Error('This video player has been closed.');
      const host = document.createElement('div');
      this.container.replaceChildren(host);
      await new Promise((resolve, reject) => {
        this.rejectReady = reject;
        const timeout = setTimeout(() => reject(new Error('YouTube playback did not become ready. Check your connection and try again.')), 20000);
        this.readyTimeout = timeout;
        this.player = new YT.Player(host, {
          host: 'https://www.youtube-nocookie.com',
          width: '100%', height: '100%',
          playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
          events: {
            onReady: () => {
              clearTimeout(timeout);
              if (this.destroyed) return;
              this.ready = true;
              this.player.setVolume(this.volume * 100);
              this.setPlaybackRate(this.rate);
              this.onReady();
              resolve();
            },
            onStateChange: event => {
              if (this.destroyed) return;
              // Cueing a new video resets YouTube's rate to 1, so reapply the
              // user's speed after the new video's available rates are known.
              if (event.data === 5) this.setPlaybackRate(this.rate);
              this.onStateChange({ data: event.data, state: event.data });
            },
            onAutoplayBlocked: () => this.onError('Your browser blocked YouTube playback. Press Play inside the video once, then use the app’s playback controls.'),
            onError: event => {
              const message = youtubePlayerError(event.data);
              this.onError(message);
              if (!this.ready) { clearTimeout(timeout); reject(new Error(message)); }
            },
          },
        });
      });
    })();
    try { await this.readyPromise; } catch (error) {
      this.readyPromise = null;
      this.player?.destroy?.();
      this.player = null;
      throw error;
    }
  }

  async load(video) {
    const id = parseYouTubeId(video);
    if (!id) throw new Error('Paste a valid YouTube video link.');
    const sequence = ++this.loadSequence;
    await this.init();
    if (sequence !== this.loadSequence || this.destroyed) return false;
    this.player.cueVideoById(id);
    return true;
  }

  isReady() { return this.ready && !this.destroyed; }
  isPlaying() { return this.isReady() && this.player.getPlayerState() === 1; }
  play() { if (this.isReady()) this.player.playVideo(); }
  pause() { if (this.isReady()) this.player.pauseVideo(); }
  seek(seconds) { if (this.isReady() && Number.isFinite(seconds)) this.player.seekTo(Math.max(0, seconds), true); }
  getCurrentTime() { return this.isReady() ? this.player.getCurrentTime() || 0 : 0; }
  getDuration() { return this.isReady() ? this.player.getDuration() || 0 : 0; }
  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.isReady()) this.player.setVolume(this.volume * 100);
  }
  setPlaybackRate(rate) {
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.rate = rate;
    if (this.isReady()) {
      const rates = this.player.getAvailablePlaybackRates?.() || [1];
      const closest = rates.reduce((best, available) => Math.abs(available - rate) < Math.abs(best - rate) ? available : best, rates[0] || 1);
      this.player.setPlaybackRate(closest);
    }
  }
  destroy() {
    this.destroyed = true;
    this.ready = false;
    this.loadSequence++;
    clearTimeout(this.readyTimeout);
    this.rejectReady?.(new Error('This video player has been closed.'));
    this.player?.destroy?.();
    this.player = null;
    this.container.replaceChildren();
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function mountYouTube(container, { onSelect = () => {}, onError = () => {}, onStateChange = () => {}, searchProvider } = {}) {
  const root = element('div', 'youtube-panel');
  const keyDetails = element('details', 'youtube-key');
  const keySummary = element('summary', '', 'Set up YouTube search');
  const keyLabel = element('label', 'field-label', 'YouTube Data API key');
  const keyInput = element('input');
  keyInput.type = 'password'; keyInput.autocomplete = 'off'; keyInput.spellcheck = false;
  keyInput.placeholder = 'Paste your API key'; keyInput.setAttribute('aria-label', 'YouTube Data API key');
  const keyHelp = element('p', 'helper', 'Required for results inside this app. Enable YouTube Data API v3 and restrict the key to this website. It is sent only to Google for search and is cleared when you leave. Pasting a link needs no key.');
  const keyLink = element('a', 'text-button', 'Create or manage a Google API key ↗');
  keyLink.href = 'https://console.cloud.google.com/apis/credentials'; keyLink.target = '_blank'; keyLink.rel = 'noopener noreferrer';
  keyLabel.append(keyInput); keyDetails.append(keySummary, keyLabel, keyHelp, keyLink);
  const searchForm = element('form', 'youtube-search');
  const searchInput = element('input');
  searchInput.type = 'search'; searchInput.placeholder = 'Song, artist, or choreography'; searchInput.setAttribute('aria-label', 'Search YouTube videos');
  const searchButton = element('button', 'button', 'Search'); searchButton.type = 'submit';
  const externalLink = element('a', 'text-button', 'Search on YouTube ↗');
  externalLink.href = 'https://www.youtube.com/results?search_query=dance+choreography'; externalLink.target = '_blank'; externalLink.rel = 'noopener noreferrer';
  searchForm.append(searchInput, searchButton);
  const pasteForm = element('form', 'youtube-paste');
  const pasteInput = element('input');
  pasteInput.type = 'text'; pasteInput.placeholder = 'Paste a YouTube link'; pasteInput.setAttribute('aria-label', 'YouTube video link');
  const pasteButton = element('button', 'button', 'Load video'); pasteButton.type = 'submit';
  pasteForm.append(pasteInput, pasteButton);
  const status = element('p', 'youtube-status helper'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const results = element('div', 'youtube-results');
  const selectedTitle = element('p', 'youtube-selected');
  const playerHost = element('div', 'youtube-player'); playerHost.hidden = true;
  const watchLink = element('a', 'text-button', 'Open selected video on YouTube ↗'); watchLink.target = '_blank'; watchLink.rel = 'noopener noreferrer'; watchLink.hidden = true;
  const searchDetails = element('details', 'youtube-discovery');
  searchDetails.append(element('summary', '', 'search for a video'), searchForm, externalLink, keyDetails);
  root.append(pasteForm, searchDetails, status, results, selectedTitle, playerHost, watchLink);
  container.replaceChildren(root);
  let searchController, searchSequence = 0, loadSequence = 0, destroyed = false;
  const fail = message => { status.textContent = message; onError(message); };
  const player = new YouTubePlayer(playerHost, { onError: fail, onStateChange });

  async function load(video, { isCurrent = () => true } = {}) {
    const id = parseYouTubeId(typeof video === 'string' ? video : video?.id);
    if (!id) { fail('Paste a valid YouTube video link, such as youtube.com/watch?v=… or youtu.be/….'); return false; }
    const sequence = ++loadSequence;
    pasteInput.value = `https://www.youtube.com/watch?v=${id}`;
    status.textContent = 'Loading YouTube player…';
    playerHost.hidden = false;
    try {
      const loaded = await player.load(id);
      if (!loaded || destroyed || sequence !== loadSequence) return false;
      if (!isCurrent()) { status.textContent = ''; return false; }
      const title = typeof video === 'object' ? video.title || 'YouTube video' : 'YouTube video';
      selectedTitle.textContent = title;
      pasteInput.value = `https://www.youtube.com/watch?v=${id}`;
      watchLink.href = pasteInput.value; watchLink.hidden = false;
      status.textContent = 'Video ready. Press Play to use its own audio. No separate audio upload is required.';
      onSelect({ id, title });
      return true;
    } catch (error) {
      if (!destroyed && sequence === loadSequence && isCurrent()) fail(error.message);
      return false;
    }
  }

  searchInput.addEventListener('input', () => {
    externalLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchInput.value.trim() || 'dance choreography')}`;
    // A response for a previous query must never overwrite the new query's state.
    searchSequence++;
    searchController?.abort();
    searchButton.disabled = false;
    results.replaceChildren();
    status.textContent = '';
  });
  searchForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!keyInput.value.trim() && !searchProvider) { keyDetails.open = true; fail('Add a YouTube Data API key to see results here, or use “Search on YouTube” and paste a video link.'); keyInput.focus(); return; }
    searchController?.abort();
    searchController = new AbortController();
    const sequence = ++searchSequence;
    searchButton.disabled = true;
    results.replaceChildren(); status.textContent = 'Searching YouTube…';
    try {
      const videos = keyInput.value.trim() ? await searchYouTubeVideos(searchInput.value, keyInput.value, { signal: searchController.signal }) : await searchProvider(searchInput.value.trim(), { signal: searchController.signal });
      if (sequence !== searchSequence || destroyed) return;
      status.textContent = videos.length ? `${videos.length} videos found. Select one to load it.` : 'No embeddable videos found. Try different search words.';
      for (const video of videos) {
        const button = element('button', 'youtube-result'); button.type = 'button';
        const thumbnail = element('img'); thumbnail.src = video.thumbnail; thumbnail.alt = ''; thumbnail.loading = 'lazy';
        const copy = element('span'); copy.append(element('strong', '', video.title), element('small', '', video.channel));
        button.append(thumbnail, copy); button.addEventListener('click', () => load(video));
        results.append(button);
      }
    } catch (error) {
      if (error.name !== 'AbortError' && sequence === searchSequence && !destroyed) fail(error.message);
    } finally {
      if (sequence === searchSequence && !destroyed) searchButton.disabled = false;
    }
  });
  pasteForm.addEventListener('submit', event => { event.preventDefault(); load(pasteInput.value); });
  return { player, load, destroy() { destroyed = true; searchSequence++; loadSequence++; searchController?.abort(); keyInput.value = ''; player.destroy(); root.remove(); } };
}
