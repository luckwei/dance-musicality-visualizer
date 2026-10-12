/**
 * Start Whisper only on an explicit user action. Samples must be mono 16 kHz.
 * A worker keeps model loading and inference off the main interaction thread.
 */
export function transcribeAudio(samples, { onProgress = () => {}, signal } = {}) {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    return Promise.reject(new TypeError('Choose an audio track before transcribing.'));
  }
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot run local transcription. Try a recent Chrome, Edge, Firefox, or Safari, or import timed lyrics.'));

  return new Promise((resolve, reject) => {
    let worker;
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(abortError());
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker(new URL('./transcription.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') onProgress(data.progress);
        else if (data.type === 'result') finish(null, data.words);
        else if (data.type === 'error') finish(new Error(data.message));
      };
      worker.onerror = event => finish(new Error(`Local transcription could not start. Check your connection and retry in a recent browser, or import lyrics. ${event.message || ''}`.trim()));
      worker.onmessageerror = () => finish(new Error('The transcription worker could not return its result. Try a shorter audio clip.'));
      // Transfer a copy so the waveform and playback keep their source samples.
      const copy = samples.slice();
      worker.postMessage({ samples: copy }, [copy.buffer]);
    } catch (error) {
      finish(new Error(`Could not start local transcription: ${error.message}. Try a shorter audio clip or import lyrics.`));
    }
  });
}

function abortError() {
  return new DOMException('Transcription cancelled.', 'AbortError');
}
