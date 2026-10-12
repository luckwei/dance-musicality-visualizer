/** Browser-only audio analysis. All times are in seconds; no audio leaves the device. */
const ENVELOPE_RATE = 100;
const PEAK_RATE = 200;

function audioChannels(buffer) {
  if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 || !Number.isInteger(buffer.length) || buffer.length <= 0 || !buffer.numberOfChannels) {
    throw new Error('This audio is empty or could not be decoded.');
  }
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function interpolate(values, index) {
  const left = Math.floor(index);
  return (values[left] || 0) * (1 - index + left) + (values[left + 1] || 0) * (index - left);
}

function noveltyFromEnvelope(envelope) {
  const novelty = new Float32Array(envelope.length);
  let largest = 0;
  // A short difference isolates note attacks; logarithmic compression keeps quiet
  // beats useful even when the kick on count one is much louder than other beats.
  for (let i = 0; i < envelope.length; i++) {
    novelty[i] = Math.max(0, Math.log1p(envelope[i] * 100) - Math.log1p((envelope[i - 2] || 0) * 100));
    largest = Math.max(largest, novelty[i]);
  }
  const positive = [];
  for (let i = 0; i < novelty.length; i++) {
    if (novelty[i] > largest * 0.08) positive.push(novelty[i]);
  }
  const ceiling = percentile(positive, 0.7) || 1;
  for (let i = 0; i < novelty.length; i++) {
    novelty[i] = novelty[i] > largest * 0.08 ? Math.min(1, novelty[i] / ceiling) : 0;
  }
  return novelty;
}

function tempoEstimate(envelope) {
  const novelty = noveltyFromEnvelope(envelope);
  // Limit tempo work to three minutes, spread across the track for long files.
  const sampleStride = Math.max(1, Math.ceil(novelty.length / 18000));
  const correlation = lag => {
    let product = 0, energyA = 0, energyB = 0;
    for (let i = Math.ceil(lag); i < novelty.length; i += sampleStride) {
      const a = novelty[i], b = interpolate(novelty, i - lag);
      product += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    return energyA && energyB ? product / Math.sqrt(energyA * energyB) : 0;
  };
  let best = { bpm: 120, score: 0, correlation: 0 };
  const candidates = [];
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = ENVELOPE_RATE * 60 / bpm;
    const first = correlation(lag);
    const score = (first + 0.35 * correlation(lag * 2) + 0.15 * correlation(lag * 3)) * (bpm / 120) ** 0.12;
    const candidate = { bpm, score, correlation: first };
    candidates.push(candidate);
    if (score > best.score) best = candidate;
  }
  if (best.score < 0.05) return { bpm: 120, offset: 0, confidence: 0 };

  // Refine the period over the track, rather than rounding every song to half a
  // BPM. Tiny tempo errors accumulate into visibly misplaced beats after minutes.
  const coarseBpm = best.bpm;
  let bestCoherence = -1;
  for (let step = -50; step <= 50; step++) {
    const bpm = coarseBpm + step / 100;
    if (bpm < 60 || bpm > 200) continue;
    let real = 0, imaginary = 0;
    const frequency = Math.PI * 2 * bpm / (60 * ENVELOPE_RATE);
    for (let i = 0; i < novelty.length; i += sampleStride) {
      if (!novelty[i]) continue;
      real += novelty[i] * Math.cos(i * frequency);
      imaginary += novelty[i] * Math.sin(i * frequency);
    }
    const coherence = real * real + imaginary * imaginary;
    if (coherence > bestCoherence) { bestCoherence = coherence; best.bpm = Math.round(bpm * 100) / 100; }
  }
  const period = 60 / best.bpm;
  let phase = 0, phaseScore = -1;
  const phaseSteps = Math.ceil(period * ENVELOPE_RATE);
  // Sum attacks near each phase of the beat. The sub-frame weighted read keeps
  // the phase smooth when a beat falls between two analysis frames.
  for (let step = 0; step < phaseSteps; step++) {
    const candidate = step * period / phaseSteps;
    let score = 0;
    for (let index = candidate * ENVELOPE_RATE; index < novelty.length; index += period * ENVELOPE_RATE * sampleStride) {
      score += interpolate(novelty, index) + 0.5 * interpolate(novelty, index + 1) + 0.5 * interpolate(novelty, index - 1);
    }
    if (score > phaseScore) { phaseScore = score; phase = candidate; }
  }
  let firstAttack = 0;
  while (firstAttack < novelty.length && novelty[firstAttack] < 0.3) firstAttack++;
  // Begin the grid at the first audible beat, preserving any opening silence.
  let offset = phase + Math.round((firstAttack / ENVELOPE_RATE - phase) / period) * period;
  offset = Math.max(0, offset);
  const distant = candidates.filter(candidate => Math.abs(candidate.bpm - best.bpm) > 4);
  const alternative = Math.max(0, ...distant.map(candidate => candidate.score));
  const ambiguity = Math.min(1, Math.max(0, (best.score - alternative) / best.score) * 8);
  const confidence = Math.min(1, best.correlation * (0.65 + 0.35 * ambiguity)) * Math.min(1, envelope.length / ENVELOPE_RATE / 8);
  return { bpm: best.bpm, offset: Math.round(offset * 1000) / 1000, confidence };
}

/**
 * Decode audio with AudioContext.decodeAudioData before calling this function.
 * peaks: absolute sample maxima (200 bins/sec); envelope: RMS energy (100 bins/sec).
 * bpm/offset are estimates for a constant-tempo beat grid, intended to be editable.
 */
export function analyzeAudio(buffer) {
  const channels = audioChannels(buffer);
  const duration = buffer.length / buffer.sampleRate;
  const peaks = new Float32Array(Math.ceil(duration * PEAK_RATE));
  const envelope = new Float32Array(Math.ceil(duration * ENVELOPE_RATE));
  // One sample pass, retaining channel energy even for opposite-phase stereo.
  for (let bin = 0; bin < peaks.length; bin++) {
    const start = Math.floor(bin * buffer.sampleRate / PEAK_RATE);
    const end = Math.min(buffer.length, Math.floor((bin + 1) * buffer.sampleRate / PEAK_RATE));
    let peak = 0, squares = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const sample = Number.isFinite(channel[i]) ? channel[i] : 0;
        peak = Math.max(peak, Math.abs(sample));
        squares += sample * sample;
      }
    }
    peaks[bin] = peak;
    envelope[Math.floor(bin / 2)] += squares;
  }
  for (let bin = 0; bin < envelope.length; bin++) {
    const start = Math.floor(bin * buffer.sampleRate / ENVELOPE_RATE);
    const end = Math.min(buffer.length, Math.floor((bin + 1) * buffer.sampleRate / ENVELOPE_RATE));
    envelope[bin] = Math.sqrt(envelope[bin] / Math.max(1, (end - start) * channels.length));
  }
  return { ...tempoEstimate(envelope), peaks, peakRate: PEAK_RATE, envelope, envelopeRate: ENVELOPE_RATE, duration };
}

function reducedEnvelope(analysis, rate) {
  const source = analysis?.envelope;
  const sourceRate = analysis?.envelopeRate;
  if (!source?.length || !Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error('Analyze both audio tracks before aligning them.');
  const reduced = new Float32Array(Math.ceil(source.length * rate / sourceRate));
  for (let i = 0; i < reduced.length; i++) {
    const start = Math.floor(i * sourceRate / rate);
    const end = Math.min(source.length, Math.max(start + 1, Math.floor((i + 1) * sourceRate / rate)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += source[j];
    reduced[i] = Math.log1p(sum / (end - start) * 100);
  }
  return reduced;
}

/**
 * Align recorded choreography audio against a song by envelope correlation.
 * The convention is videoTime = songTime + offset. Searches offsets ±60 seconds.
 * Low confidence means the user should adjust manually (silence, different music,
 * repeated phrases, and room noise can make the match ambiguous).
 */
export function alignAudio(songAnalysis, videoAnalysis) {
  const rate = 25;
  const song = reducedEnvelope(songAnalysis, rate);
  const video = reducedEnvelope(videoAnalysis, rate);
  const minimumOverlap = Math.max(rate * 3, Math.min(song.length, video.length) * 0.2);
  const scoreAt = (lag, stride = 1) => {
    const start = Math.max(0, -lag), end = Math.min(song.length, video.length - lag);
    if (end - start < minimumOverlap) return -1;
    const step = Math.max(stride, Math.ceil((end - start) / 4500));
    let count = 0, sumA = 0, sumB = 0, squaredA = 0, squaredB = 0, product = 0;
    for (let i = start; i < end; i += step) {
      const a = song[i], b = video[i + lag];
      count++; sumA += a; sumB += b; squaredA += a * a; squaredB += b * b; product += a * b;
    }
    const variance = (squaredA - sumA * sumA / count) * (squaredB - sumB * sumB / count);
    return variance > 1e-9 ? (product - sumA * sumB / count) / Math.sqrt(variance) : -1;
  };
  const candidates = [];
  for (let lag = -60 * rate; lag <= 60 * rate; lag += 2) candidates.push({ lag, score: scoreAt(lag, 2) });
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.lag) - Math.abs(b.lag));
  let best = { lag: 0, score: -1 };
  // Refine several coarse peaks so one unlucky sampling interval cannot hide a
  // better alignment. At 25 Hz the returned precision is 40 milliseconds.
  for (const candidate of candidates.slice(0, 8)) {
    for (let lag = Math.max(-60 * rate, candidate.lag - 2); lag <= Math.min(60 * rate, candidate.lag + 2); lag++) {
      const score = scoreAt(lag);
      if (score > best.score) best = { lag, score };
    }
  }
  if (best.score <= 0) return { offset: 0, confidence: 0 };
  const alternative = candidates.find(candidate => Math.abs(candidate.lag - best.lag) > rate / 2)?.score || 0;
  const separation = Math.min(1, Math.max(0, best.score - alternative) * 4);
  return { offset: best.lag / rate, confidence: Math.max(0, Math.min(1, best.score * (0.35 + 0.65 * separation))) };
}

/** Resample to mono Float32 PCM for speech models, with box filtering on reduction. */
export function resampleMono(buffer, targetRate = 16000) {
  const channels = audioChannels(buffer);
  if (!Number.isFinite(targetRate) || targetRate <= 0) throw new Error('Choose a valid target sample rate.');
  const ratio = buffer.sampleRate / targetRate;
  const output = new Float32Array(Math.ceil(buffer.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = i * ratio, end = Math.min(buffer.length, (i + 1) * ratio);
    let sum = 0;
    for (const channel of channels) {
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        const weight = Math.min(end, j + 1) - Math.max(start, j);
        sum += (Number.isFinite(channel[j]) ? channel[j] : 0) * weight;
      }
    }
    output[i] = sum / ((end - start) * channels.length);
  }
  return output;
}
