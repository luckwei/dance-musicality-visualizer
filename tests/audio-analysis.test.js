import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudio, alignAudio, resampleMono } from '../src/audio-analysis.js';

function audio(samples, sampleRate = 8000, extraChannels = []) {
  const channels = [samples, ...extraChannels];
  return { sampleRate, length: samples.length, duration: samples.length / sampleRate, numberOfChannels: channels.length, getChannelData: index => channels[index] };
}

function rhythm(bpm, duration = 24, offset = 0.23) {
  const sampleRate = 8000, data = new Float32Array(duration * sampleRate);
  let seed = 12345;
  for (let beat = 0; offset + beat * 60 / bpm < duration; beat++) {
    const start = Math.round((offset + beat * 60 / bpm) * sampleRate);
    const amplitude = beat % 4 === 0 ? 0.85 : 0.4;
    for (let frame = 0; frame < 640 && start + frame < data.length; frame++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const noise = seed / 0x100000000 * 2 - 1;
      data[start + frame] += amplitude * Math.exp(-frame / 120) * (0.7 * Math.sin(frame * 0.13) + 0.3 * noise);
    }
  }
  return audio(data, sampleRate);
}

test('extracts real waveform amplitude and retains opposite-phase stereo energy', () => {
  const samples = Float32Array.from({ length: 8000 }, (_, index) => index < 80 ? 0.75 : 0);
  const result = analyzeAudio(audio(samples, 8000, [samples.map(value => -value)]));
  assert.equal(result.peaks.length, 200);
  assert.equal(result.envelope.length, 100);
  assert.equal(result.peaks[0], 0.75);
  assert.equal(result.envelope[0], 0.75);
  assert.equal(result.peaks[10], 0);
});

for (const bpm of [72, 95, 108, 120, 137.32, 156, 180]) {
  test(`detects ${bpm} BPM with accented beats and opening silence`, () => {
    const result = analyzeAudio(rhythm(bpm));
    assert.ok(Math.abs(result.bpm - bpm) <= 0.1, `estimated ${result.bpm} BPM`);
    assert.ok(Math.abs(result.offset - 0.23) < 0.05, `estimated offset ${result.offset}`);
    assert.ok(result.confidence > 0.35, `confidence ${result.confidence}`);
  });
}

test('silent and extremely short audio provide a low-confidence fallback', () => {
  const result = analyzeAudio(audio(new Float32Array(8000)));
  assert.equal(result.confidence, 0);
  assert.equal(result.offset, 0);
  assert.ok(Number.isFinite(result.bpm));
  assert.equal(analyzeAudio(audio(Float32Array.of(0.5))).confidence, 0);
  assert.throws(() => analyzeAudio(audio(new Float32Array(0))), /empty/);
});

test('keeps opening silence before the first detected beat', () => {
  const result = analyzeAudio(rhythm(120, 24, 2.35));
  assert.ok(Math.abs(result.offset - 2.35) < 0.05, `estimated offset ${result.offset}`);
});

function uniqueEnvelope(duration, rate = 100) {
  let seed = 222;
  const envelope = new Float32Array(duration * rate);
  let target = 0, smoothed = 0;
  for (let i = 0; i < envelope.length; i++) {
    if (i % 13 === 0) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      target = 0.01 + seed / 0x100000000 * 0.4;
    }
    smoothed += (target - smoothed) * 0.25;
    envelope[i] = smoothed;
  }
  return { envelope, envelopeRate: rate };
}

for (const offset of [2.4, -3.2, 0, 12.84]) {
  test(`aligns recorded video audio with ${offset}s offset, gain changes, and noise`, () => {
    const song = uniqueEnvelope(40);
    const video = { envelopeRate: 100, envelope: new Float32Array(35 * 100) };
    for (let i = 0; i < video.envelope.length; i++) {
      const source = song.envelope[i - Math.round(offset * 100)] || 0;
      video.envelope[i] = source * 0.55 + 0.01 * (1 + Math.sin(i * 2.19));
    }
    const result = alignAudio(song, video);
    assert.ok(Math.abs(result.offset - offset) <= 0.08, `estimated ${result.offset}s`);
    assert.ok(result.confidence > 0.7, `confidence ${result.confidence}`);
  });
}

test('alignment reports no match for silence or insufficient overlap', () => {
  const silence = { envelope: new Float32Array(1000), envelopeRate: 100 };
  assert.deepEqual(alignAudio(silence, silence), { offset: 0, confidence: 0 });
  assert.deepEqual(alignAudio(uniqueEnvelope(1), uniqueEnvelope(1)), { offset: 0, confidence: 0 });
  assert.throws(() => alignAudio({}, silence), /Analyze both/);
});

test('resamples stereo to mono at the requested sample rate', () => {
  const left = new Float32Array(48000).fill(0.5);
  const right = new Float32Array(48000).fill(0.25);
  const result = resampleMono(audio(left, 48000, [right]));
  assert.equal(result.length, 16000);
  assert.ok(result.every(value => value === 0.375));
  const alternating = Float32Array.from({ length: 8000 }, (_, i) => i % 2 ? -1 : 1);
  assert.ok(resampleMono(audio(alternating), 4000).every(value => value === 0));
  assert.throws(() => resampleMono(audio(left), 0), /valid target/);
});
