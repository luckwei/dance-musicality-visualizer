import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimedLyrics, splitSyllables, wordsToSyllables } from '../src/lyrics.js';
import { transcribeAudio } from '../src/transcription.js';

test('syllables preserve spelling, punctuation, and deliberate manual splits', () => {
  assert.deepEqual(splitSyllables('Musical!'), ['Mu', 'si', 'cal!']);
  assert.deepEqual(splitSyllables('beau-ti-ful'), ['beau', 'ti', 'ful']);
  assert.deepEqual(splitSyllables('dance'), ['dance']);
  assert.deepEqual(splitSyllables('moving'), ['mov', 'ing']);
  assert.deepEqual(splitSyllables('tonight'), ['to', 'night']);
  assert.deepEqual(splitSyllables('你好'), ['你好']);
});

test('word timing remains bounded and adjacent syllables share exact boundaries', () => {
  const syllables = wordsToSyllables([{ text: 'mu-si-cal', start: 1.25, end: 2.4 }]);
  assert.equal(syllables.length, 3);
  assert.equal(syllables[0].start, 1.25);
  assert.equal(syllables.at(-1).end, 2.4);
  assert.equal(syllables[0].end, syllables[1].start);
  assert.equal(syllables[1].end, syllables[2].start);
  assert.ok(syllables.every(s => s.estimated));
  assert.throws(() => wordsToSyllables([{ text: 'no', start: 5, end: 2 }]), /valid start\/end/);
  assert.throws(() => wordsToSyllables([{ text: 'no', start: NaN, end: 2 }]), /valid start\/end/);
});

test('LRC lines preserve timing, trim words, and stop at an empty timestamp', () => {
  const words = parseTimedLyrics('[ar:Someone]\n[00:01.25]Feel the rhythm\n[00:03.25]\n[00:04.00]Dance', 6);
  assert.equal(words[0].start, 1.25);
  assert.equal(words[2].end, 3.25);
  assert.equal(words[3].start, 4);
  assert.equal(words[3].end, 6);
  assert.deepEqual(words.map(w => w.text), ['Feel', 'the', 'rhythm', 'Dance']);
});

test('LRC repeated timestamps and offset are applied to song positions', () => {
  const words = parseTimedLyrics('[offset:500]\n[00:01.00][00:03.00]Hey', 5);
  assert.deepEqual(words.map(w => [w.start, w.end]), [[1.5, 3.5], [3.5, 5]]);
});

test('explicit start/end format keeps instrumental gaps', () => {
  assert.deepEqual(parseTimedLyrics('0-1 | Hey\n3-4 | Go', 8), [
    { text: 'Hey', start: 0, end: 1 }, { text: 'Go', start: 3, end: 4 },
  ]);
  const words = parseTimedLyrics('1 | mu-si-cal\n4 | Hey', 5);
  assert.equal(words[0].start, 1);
  assert.equal(words[0].end, 4);
  assert.equal(words.at(-1).end, 5);
});

test('plain lyrics distribute estimated timing over the complete song', () => {
  const words = parseTimedLyrics('Mu-si-cal\nHey', 4);
  assert.deepEqual(words.map(w => [w.start, w.end]), [[0, 3], [3, 4]]);
  assert.deepEqual(parseTimedLyrics('', 4), []);
});

test('invalid lyric input produces actionable errors rather than invalid times', () => {
  assert.throws(() => parseTimedLyrics('Hey', 0), /Load audio/);
  assert.throws(() => parseTimedLyrics('[00:90]Hey', 5), /Line 1/);
  assert.throws(() => parseTimedLyrics('-1 | Hey', 5), /Line 1/);
  assert.throws(() => parseTimedLyrics('1 | Hey\nOops', 5), /every line/);
  assert.throws(() => parseTimedLyrics('6 | Hey', 5), /within the song/);
  assert.throws(() => parseTimedLyrics('1-4 | Hey\n3 | Go', 5), /overlaps/);
  assert.throws(() => parseTimedLyrics('1 | Hey\n1 | Go', 5), /positive duration|different start/);
});

test('transcription cancellation and invalid samples fail without starting a worker', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transcribeAudio(new Float32Array(160), { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(transcribeAudio(new Float32Array()), /Choose an audio/);
});

test('transcription resolves worker words and keeps source audio available', async () => {
  const originalWorker = globalThis.Worker;
  const source = new Float32Array([0.2, -0.3]);
  const words = [{ start: 0, end: 1, text: 'Hey' }];
  let instance;
  globalThis.Worker = class {
    constructor() { instance = this; this.terminated = false; }
    postMessage({ samples }) {
      assert.notEqual(samples.buffer, source.buffer);
      assert.deepEqual(samples, source);
      queueMicrotask(() => this.onmessage({ data: { type: 'result', words } }));
    }
    terminate() { this.terminated = true; }
  };
  try {
    assert.deepEqual(await transcribeAudio(source), words);
    assert.equal(source.length, 2);
    assert.equal(instance.terminated, true);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test('cancelling a running transcription terminates its worker', async () => {
  const originalWorker = globalThis.Worker;
  let terminated = 0;
  globalThis.Worker = class {
    postMessage() {}
    terminate() { terminated += 1; }
  };
  try {
    const controller = new AbortController();
    const pending = transcribeAudio(new Float32Array(160), { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(terminated, 1);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});
