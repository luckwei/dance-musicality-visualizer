export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function phraseAt(time, bpm, offset = 0) {
  return Math.max(0, Math.floor((time - offset + 1e-7) / (480 / bpm)));
}
export function phraseBounds(index, bpm, offset = 0) {
  const start = offset + index * 480 / bpm;
  return { start, end: start + 480 / bpm };
}
export function phraseCount(duration, bpm, offset = 0) {
  return Math.max(1, Math.ceil(Math.max(0, duration - offset) / (480 / bpm)));
}
export function waveformPath(peaks, peakRate, start, duration, audioDuration, resolution = 480) {
  if (!peaks?.length) return '';
  const parts = ['M0 90'];
  for (let i = 0; i < resolution; i++) {
    const from = start + i / resolution * duration;
    const to = start + (i + 1) / resolution * duration;
    let peak = 0;
    if (from < audioDuration && to > 0) {
      for (let j = Math.max(0, Math.floor(from * peakRate)); j < Math.min(peaks.length, Math.max(Math.floor(from * peakRate) + 1, Math.ceil(to * peakRate))); j++) peak = Math.max(peak, peaks[j]);
    }
    parts.push(`L${(i / (resolution - 1) * 1000).toFixed(2)} ${(90 - Math.min(1, peak) * 82).toFixed(2)}`);
  }
  parts.push('L1000 90 Z');
  return parts.join(' ');
}
export function validateProject(project, duration = Infinity) {
  if (project?.version !== 1 || !Number.isFinite(project.bpm) || project.bpm < 40 || project.bpm > 240 || !Number.isFinite(project.offset) || project.offset < 0 || project.offset >= duration) throw new Error('Invalid project tempo or first-count time.');
  if (!Array.isArray(project.syllables) || project.syllables.length > 10000) throw new Error('Invalid or oversized lyric timing data.');
  for (const cue of project.syllables) {
    if (typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 200 || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.start >= duration || cue.end <= cue.start || cue.end > duration) throw new Error('Every syllable needs text and valid start/end times within the track.');
  }
  return {bpm:project.bpm,offset:project.offset,syllables:project.syllables.map(({start,end,text})=>({start,end,text})).sort((a,b)=>a.start-b.start)};
}
