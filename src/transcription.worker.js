import { env, pipeline } from '@huggingface/transformers';

// GitHub Pages does not supply cross-origin isolation. Single-threaded WASM
// works without SharedArrayBuffer and can still use the browser's model cache.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const MODEL = 'onnx-community/whisper-tiny.en';
const progress = value => self.postMessage({ type: 'progress', progress: value });

self.onmessage = async ({ data }) => {
  let recognizer;
  try {
    const samples = data.samples;
    if (!(samples instanceof Float32Array) || samples.length === 0) throw new Error('No audio samples were provided.');
    progress({ status: 'download', progress: 0, message: 'Loading the English speech model (downloaded once, cached by your browser)…' });
    recognizer = await pipeline('automatic-speech-recognition', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: event => {
        if (event.status === 'progress') {
          progress({ status: 'download', progress: event.progress, message: `Loading speech model: ${Math.round(event.progress)}% of ${event.file?.split('/').at(-1) || 'file'}` });
        }
      },
    });
    progress({ status: 'transcribing', message: 'Listening for English lyrics locally. Songs can take a few minutes; you can cancel at any time.' });
    const result = await recognizer(samples, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      // Tiny is less robust with music than speech; avoid forcing text during
      // silence, and leave the final text/timing visibly editable in the UI.
      force_full_sequences: false,
    });
    const duration = samples.length / 16000;
    const chunks = result.chunks || [];
    const words = chunks.flatMap((chunk, index) => {
      const text = chunk.text?.trim();
      if (!text) return [];
      const rawStart = chunk.timestamp?.[0];
      const rawEnd = chunk.timestamp?.[1];
      const start = Math.min(duration, Math.max(0, Number.isFinite(rawStart) ? rawStart : chunks[index - 1]?.timestamp?.[1] ?? 0));
      const nextStart = chunks[index + 1]?.timestamp?.[0];
      const end = Math.min(duration, Math.max(start, Number.isFinite(rawEnd) ? rawEnd : Number.isFinite(nextStart) ? nextStart : duration));
      if (end <= start) return [];
      return [{ start, end, text }];
    });
    self.postMessage({ type: 'result', words });
  } catch (error) {
    const message = error?.message || String(error);
    const hint = /fetch|network|download|load.*file|failed to load/i.test(message)
      ? 'The speech model could not download. Check your connection and access to huggingface.co and its download hosts, then retry.'
      : /memory|alloc|out of bounds/i.test(message)
        ? 'The browser ran out of memory. Try a shorter audio clip or close other tabs, then retry.'
        : 'Local transcription failed. Try a recent desktop browser or import timed lyrics instead.';
    self.postMessage({ type: 'error', message: `${hint} ${message}` });
  } finally {
    await recognizer?.dispose();
  }
};
