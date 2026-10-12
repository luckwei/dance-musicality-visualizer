import test from 'node:test';
import assert from 'node:assert/strict';
import { phraseAt, phraseBounds, phraseCount, waveformPath, validateProject } from '../src/timeline.js';

const project = overrides => ({
  version: 1, bpm: 120, offset: 0,
  syllables: [{ start: 1, end: 1.5, text: 'dance' }],
  ...overrides,
});
const plottedPoints = path => [...path.matchAll(/L([\d.-]+) ([\d.-]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));

test('each phrase covers exactly eight evenly spaced counts', () => {
  assert.deepEqual(phraseBounds(0, 120), { start: 0, end: 4 });
  assert.deepEqual(phraseBounds(1, 120), { start: 4, end: 8 });
  assert.deepEqual(phraseBounds(2, 60, 1.25), { start: 17.25, end: 25.25 });
  for (const bpm of [83.47, 108, 120, 199.9, 240]) {
    const bounds = phraseBounds(13, bpm, 0.31);
    assert.ok(Math.abs((bounds.end - bounds.start) / (60 / bpm) - 8) < 1e-10);
  }
});

test('phrase boundaries place exact beat one in the next phrase', () => {
  assert.equal(phraseAt(3.999, 120), 0);
  assert.equal(phraseAt(4, 120), 1);
  assert.equal(phraseAt(0.4, 120, 0.5), 0);
  assert.equal(phraseAt(4.499, 120, 0.5), 0);
  assert.equal(phraseAt(4.5, 120, 0.5), 1);
  for (const bpm of [83.47, 108, 199.9]) {
    for (let index = 0; index < 50; index++) {
      assert.equal(phraseAt(phraseBounds(index, bpm, 0.25).start, bpm, 0.25), index);
    }
  }
});

test('phrase count includes partial last eights without adding an extra complete row', () => {
  assert.equal(phraseCount(8, 120), 2);
  assert.equal(phraseCount(8.001, 120), 3);
  assert.equal(phraseCount(8.5, 120, 0.5), 2);
  assert.equal(phraseCount(8.6, 120, 0.5), 3);
  assert.equal(phraseCount(0.1, 120), 1);
});

test('a waveform transient stays at its time on the shared phrase axis', () => {
  const peaks = new Float32Array(1600); // Eight seconds, 200 bins/second.
  peaks[600] = 1; // Three seconds: one second into a phrase starting at two.
  const points = plottedPoints(waveformPath(peaks, 200, 2, 4, 8));
  const transient = points.filter(point => point.y < 90);
  assert.ok(transient.length > 0);
  assert.ok(transient.every(point => Math.abs(point.x - 250) < 3));
  assert.ok(transient.every(point => point.y >= 8 && point.y <= 90));
  assert.ok(plottedPoints(waveformPath(peaks, 200, 4, 4, 8)).every(point => point.y === 90));
});

test('waveform pads the unfinished final eight with silence', () => {
  const peaks = new Float32Array(400).fill(0.5); // Two seconds of audio.
  const points = plottedPoints(waveformPath(peaks, 200, 0, 4, 2));
  assert.ok(points.filter(point => point.x < 490).every(point => point.y === 49));
  assert.ok(points.filter(point => point.x > 510).every(point => point.y === 90));
  assert.equal(waveformPath(new Float32Array(), 200, 0, 4, 0), '');
});

test('project import sorts a copy and keeps only documented timing data', () => {
  const data = project({ syllables: [{ start: 3, end: 4, text: 'two', extra: 'ignore' }, { start: 0, end: 1, text: 'one' }], extra: 'ignore' });
  assert.deepEqual(validateProject(data, 4), { bpm: 120, offset: 0, syllables: [{ start: 0, end: 1, text: 'one' }, { start: 3, end: 4, text: 'two' }] });
  assert.equal(data.syllables[0].text, 'two');
});

test('invalid tempo, first count, and oversized timing imports are rejected', () => {
  for (const bpm of [0, 39, 241, NaN, Infinity, '120']) assert.throws(() => validateProject(project({ bpm }), 4));
  for (const offset of [-1, 4, Infinity, NaN]) assert.throws(() => validateProject(project({ offset }), 4));
  assert.throws(() => validateProject(project({ version: 2 }), 4));
  assert.throws(() => validateProject(project({ syllables: new Array(10001).fill({ start: 0, end: 1, text: 'a' }) }), 4), /oversized/);
});

test('malformed and unreachable syllables are rejected', () => {
  const invalid = [null, {}, { start: 0, end: 1, text: '' }, { start: 0, end: 1, text: ' '.repeat(4) }, { start: 0, end: 1, text: 'a'.repeat(201) }, { start: -1, end: 1, text: 'a' }, { start: 1, end: 1, text: 'a' }, { start: 1, end: NaN, text: 'a' }, { start: 4, end: 4.05, text: 'a' }];
  for (const cue of invalid) assert.throws(() => validateProject(project({ syllables: [cue] }), 4), undefined, JSON.stringify(cue));
});
