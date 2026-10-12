import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeId, searchYouTubeVideos, YouTubePlayer, youtubePlayerError } from '../src/youtube.js';

test('accepts official YouTube video URLs and rejects other origins or invalid IDs', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [id, `https://youtube.com/watch?v=${id}&t=12`, `https://youtu.be/${id}?t=12`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube-nocookie.com/embed/${id}`, `https://m.youtube.com/live/${id}`, `youtube.com/watch?v=${id}`]) assert.equal(parseYouTubeId(url), id);
  for (const url of ['', null, 'javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ', 'https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=invalid', 'https://youtube.com/playlist?list=dQw4w9WgXcQ', 'ftp://youtube.com/watch?v=dQw4w9WgXcQ']) assert.equal(parseYouTubeId(url), null);
});

test('search uses Google API only, requires embeddable videos, and filters bad IDs', async () => {
  let requested;
  const videos = await searchYouTubeVideos('dance & count', 'session-only-key', { fetchImpl: async (url, options) => {
    requested = new URL(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: '<img onerror=alert(1)>', channelTitle: 'Artist' } }, { id: { videoId: 'bad-id' } }] }) };
  } });
  assert.equal(requested.origin, 'https://www.googleapis.com');
  assert.equal(requested.searchParams.get('q'), 'dance & count');
  assert.equal(requested.searchParams.get('key'), 'session-only-key');
  assert.equal(requested.searchParams.get('videoEmbeddable'), 'true');
  assert.equal(requested.searchParams.get('videoSyndicated'), 'true');
  assert.equal(videos.length, 1);
  assert.equal(videos[0].title, '<img onerror=alert(1)>');
  assert.equal(videos[0].thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
});

test('missing key or query never makes a request', async () => {
  const fetchImpl = () => assert.fail('Unexpected network request');
  await assert.rejects(searchYouTubeVideos('dance', '', { fetchImpl }), /API key/);
  await assert.rejects(searchYouTubeVideos(' ', 'key', { fetchImpl }), /Enter a song/);
});

test('quota and key errors give useful messages without reflecting API response secrets', async () => {
  for (const [reason, expected] of [['quotaExceeded', /quota is exhausted/], ['keyInvalid', /API key/]]) {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'secret-value-from-api', errors: [{ reason }] } }) });
    await assert.rejects(searchYouTubeVideos('dance', 'key', { fetchImpl }), error => expected.test(error.message) && !error.message.includes('secret-value'));
  }
});

test('search supports cancellation and bounded network timeout', async () => {
  const fetchImpl = async (_, { signal }) => new Promise((resolve, reject) => {
    const cancel = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
  const controller = new AbortController();
  const request = searchYouTubeVideos('dance', 'key', { signal: controller.signal, fetchImpl });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  await assert.rejects(searchYouTubeVideos('dance', 'key', { fetchImpl, timeoutMs: 5 }), /timed out/);
});

test('player clamps volume, rejects invalid seeks, and uses supported playback rates', () => {
  const calls = [];
  const player = new YouTubePlayer({});
  player.ready = true;
  player.player = { setVolume: value => calls.push(['volume', value]), seekTo: value => calls.push(['seek', value]), getAvailablePlaybackRates: () => [0.5, 1, 1.5, 2], setPlaybackRate: value => calls.push(['rate', value]) };
  player.setVolume(2); player.setVolume(-1); player.setVolume(NaN);
  player.seek(-5); player.seek(NaN); player.setPlaybackRate(1.6);
  assert.deepEqual(calls, [['volume', 100], ['volume', 0], ['seek', 0], ['rate', 1.5]]);
  assert.match(youtubePlayerError(150), /disabled embedded playback/);
  assert.match(youtubePlayerError(153), /published HTTPS/);
});
