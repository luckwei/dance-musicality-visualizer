/**
 * Lyrics supplied by speech recognition have word timestamps, not syllable
 * timestamps. These helpers make an editable estimate; they never claim forced
 * alignment. An explicit hyphen ("mu-si-cal") overrides the English heuristic.
 */
const EXCEPTIONS = {
  a: ['a'], i: ['I'], the: ['the'], one: ['one'], once: ['once'], some: ['some'],
  come: ['come'], love: ['love'], move: ['move'], have: ['have'], give: ['give'],
  live: ['live'], there: ['there'], where: ['where'], every: ['ev', 'ery'],
  people: ['peo', 'ple'], rhythm: ['rhythm'], fire: ['fire'], hour: ['hour'],
  our: ['our'], world: ['world'], dance: ['dance'], danced: ['danced'],
  dancing: ['danc', 'ing'], music: ['mu', 'sic'], musical: ['mu', 'si', 'cal'],
  beautiful: ['beau', 'ti', 'ful'], heartbeat: ['heart', 'beat'],
  away: ['a', 'way'], another: ['an', 'oth', 'er'], together: ['to', 'geth', 'er'],
};

/** Approximate English syllables while preserving the original characters. */
export function splitSyllables(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (/[-\u2010\u2011]/.test(text)) {
    return text.split(/[-\u2010\u2011]+/).filter(Boolean);
  }
  const match = text.match(/^([^A-Za-z]*)([A-Za-z'’]+)([^A-Za-z]*)$/);
  if (!match) return [text]; // Other languages stay intact for manual splitting.
  const [, prefix, word, suffix] = match;
  const lower = word.toLowerCase();
  if (word.length < 4) return [text];

  let parts;
  if (EXCEPTIONS[lower]) {
    let cursor = 0;
    parts = EXCEPTIONS[lower].map(part => {
      const original = word.slice(cursor, cursor + part.length);
      cursor += part.length;
      return original;
    });
  } else {
    const vowels = [...lower.matchAll(/[aeiouy]+/g)];
    // Final e, -ed, and -es are commonly silent. -le after a consonant is not.
    const last = vowels.at(-1);
    if (vowels.length > 1 && last?.[0] === 'e' && (
      (last.index === word.length - 1 && !/[^aeiouy]le$/.test(lower)) ||
      (last.index === word.length - 2 && /ed$/.test(lower) && !/[td]ed$/.test(lower)) ||
      (last.index === word.length - 2 && /es$/.test(lower) && !/(?:[sxz]|ch|sh)es$/.test(lower))
    )) vowels.pop();
    if (vowels.length < 2) return [text];

    const breaks = [];
    for (let i = 1; i < vowels.length; i += 1) {
      const previousEnd = vowels[i - 1].index + vowels[i - 1][0].length;
      const nextStart = vowels[i].index;
      const consonants = lower.slice(previousEnd, nextStart);
      // Prefer a single consonant at the beginning of the following syllable.
      // Keep common consonant pairs together, with the usual -ing exception.
      let boundary = nextStart - Math.min(1, consonants.length);
      if (/(?:ch|sh|th|ph|wh|qu|ck|[bcfgpt]r|[bcfgp]l)$/.test(consonants)) boundary -= 1;
      if (lower.slice(nextStart) === 'ing') boundary = nextStart;
      boundary = Math.max(previousEnd, boundary);
      breaks.push(boundary);
    }
    parts = [];
    let cursor = 0;
    for (const boundary of [...breaks, word.length]) {
      parts.push(word.slice(cursor, boundary));
      cursor = boundary;
    }
  }
  parts[0] = prefix + parts[0];
  parts[parts.length - 1] += suffix;
  return parts;
}

/** Spread a word's syllables across its observed duration (editable estimates). */
export function wordsToSyllables(words) {
  if (!Array.isArray(words)) throw new TypeError('Lyrics must be a list of timed words.');
  return words.flatMap((word, wordIndex) => {
    const { start, end, text } = word ?? {};
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || typeof text !== 'string') {
      throw new TypeError(`Word ${wordIndex + 1} needs text and valid start/end times.`);
    }
    const parts = splitSyllables(text);
    return parts.map((part, index) => ({
      text: part,
      start: start + (end - start) * index / parts.length,
      end: index === parts.length - 1 ? end : start + (end - start) * (index + 1) / parts.length,
      estimated: true,
    }));
  });
}

/**
 * Import standard LRC, `start | lyric`, `start-end | lyric`, or plain lines.
 * Numeric times are seconds; LRC timestamps are [minutes:seconds.fraction].
 * Line timing is divided among words, weighted by estimated syllable count.
 * The result is always words; pass to wordsToSyllables for the lane renderer.
 */
export function parseTimedLyrics(source, duration) {
  if (typeof source !== 'string') throw new TypeError('Paste lyrics as text.');
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Load audio before adding timed lyrics.');
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const timed = [];
  const plain = [];
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    if (/^\[offset:[+-]?\d+\]$/i.test(line)) {
      offset = Number(line.slice(8, -1)) / 1000;
      continue;
    }
    if (/^\[(?:ar|ti|al|by|re|ve|length):.*\]$/i.test(line)) continue;
    const lrc = [...line.matchAll(/\[(\d+):([0-5]?\d(?:\.\d+)?)\]/g)];
    if (lrc.length) {
      const content = line.replace(/\[(\d+):([0-5]?\d(?:\.\d+)?)\]/g, '').trim();
      // An empty LRC timestamp can explicitly end the previous line.
      for (const match of lrc) timed.push({ start: Number(match[1]) * 60 + Number(match[2]), text: content, lrc: true });
      continue;
    }
    const numeric = line.match(/^(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*\|\s*(.*)$/);
    if (numeric) {
      timed.push({ start: Number(numeric[1]), end: numeric[2] == null ? undefined : Number(numeric[2]), text: numeric[3].trim() });
      continue;
    }
    if (/^\[/.test(line) || line.includes('|')) {
      throw new SyntaxError(`Line ${index + 1}: use [00:12.50]lyric or 12.5 | lyric.`);
    }
    plain.push(line);
  }
  if (timed.length && plain.length) throw new SyntaxError('Use timestamps on every line, or remove them all for estimated timing.');
  if (!timed.length) {
    if (!plain.length) return [];
    const weights = plain.map(line => countLineSyllables(line));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsed = 0;
    plain.forEach((text, index) => {
      const start = elapsed / total * duration;
      elapsed += weights[index];
      timed.push({ start, end: elapsed / total * duration, text });
    });
  }
  for (const line of timed) {
    if (line.lrc) line.start = Math.max(0, line.start + offset);
  }
  timed.sort((a, b) => a.start - b.start);
  return timed.flatMap((line, index) => {
    const nextStart = timed[index + 1]?.start ?? duration;
    const end = line.end ?? nextStart;
    if (line.start > duration || (line.start === duration && line.text) || end > duration || end < line.start || (line.text && end === line.start)) {
      throw new RangeError(`Lyric timing at ${line.start}s must be within the song and have a positive duration.`);
    }
    if (index > 0 && line.start === timed[index - 1].start) throw new RangeError('Each lyric line needs a different start time.');
    if (line.end != null && end > nextStart) throw new RangeError(`Lyric ending at ${end}s overlaps the next line.`);
    const words = line.text.split(/\s+/).filter(Boolean);
    const weights = words.map(word => splitSyllables(word).length);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsed = 0;
    return words.map((text, wordIndex) => {
      const start = line.start + (end - line.start) * elapsed / total;
      elapsed += weights[wordIndex];
      return { text, start, end: wordIndex === words.length - 1 ? end : line.start + (end - line.start) * elapsed / total };
    });
  });
}

function countLineSyllables(line) {
  return line.split(/\s+/).reduce((total, word) => total + splitSyllables(word).length, 0);
}
