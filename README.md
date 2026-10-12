# Musicality Studio

A browser music-and-choreography workspace. Each eight-count phrase has one shared time axis: actual waveform amplitude above, evenly spaced counts, editable syllables below, and a smooth playhead. Intro/pickup rows preserve lyrics before the selected count 1.

**Published frontend:** https://luckwei.github.io/dance-musicality-visualizer/

## Workflows

- **Learn:** current and next eight, slower playback and phrase looping.
- **Align:** choreography alongside the score; unlink video to select matching frames, then align them. Local video audio can also be matched automatically.
- **Correct:** complete score, tempo/phase controls, draggable syllables, numeric timing editor, candidate review, and undo/redo.

All modes share the same project; switching modes preserves timing and playback position.

## What works locally

Open MP3/WAV or another browser-supported audio format. Decode the actual audio, estimate constant tempo and an initial beat phase, draw phrase waveforms, and play/seek/loop at adjustable speed. Half/double/tap tempo and “Set at playhead” correct dance count 1. Analysis does not establish meter or guarantee the musical downbeat. Variable-tempo recordings still need a future tempo-map editor.

Paste lyrics or import LRC/text. Explicit hyphens control syllable splitting. Suggested timings are reviewed before application. Drag syllables or edit start/end/text in the table; undo restores previous changes. Export/import JSON preserves timing, not media or API keys. Reopening another track resets its timing; export before replacing the track or refreshing.

Optional Whisper tiny.en transcription runs in a worker on this device after a model download. It is English-only and optimized for speech; singing and syllable boundaries need correction. Model downloads need access to Hugging Face/CDN hosts. The download is substantial and inference may be slow on phones. Cancel and manual lyrics remain available.

Local choreography video supports real volume mixing and synchronization. Automatic alignment compares audio envelopes over a bounded ±60-second range; repeated sections or different edits can be ambiguous. Listen at several points. YouTube embeds support playback/manual offset and volume, but do not expose audio samples: open matching audio for waveform/beat/transcription analysis.

## YouTube and optional hosted AI

Paste a YouTube link with no API key. In-app search uses either a session-only Google key with YouTube Data API v3 enabled, or your backend's configured YouTube key. Embedding restrictions, autoplay policy and supported video playback rates still apply.

The optional Node backend supports:

- Hosted OpenAI `whisper-1` transcription with word timestamps.
- YouTube Data API search with a server-side key.
- TypeSafe JEV review suggestions from small project metrics and a user note. It does not receive audio/lyric text or alter timing. This is a metadata-only decision, not proof of musical correctness.
- User-provided OpenAI or TypeSafe keys for individual requests, held in memory and forwarded only to the relevant fixed provider endpoint.

See [backend deployment and secrets](server/README.md), [AI/cost decisions](docs/AI-AND-SECRETS.md), and [UX research and task plan](docs/UX-RESEARCH.md).

## Development

Node 24 is the tested runtime.

```sh
npm ci
npm run dev
```

Open the `/dance-musicality-visualizer/` path shown by Vite. `.npmrc` skips native ONNX CUDA binaries; browser inference uses WASM. Package integrity and TLS verification remain enabled.

```sh
npm test
npm run build
npm start
```

`npm start` serves the build and API routes on port 3000. To load a local ignored `.env`, use `node --env-file=.env server/server.mjs`.

Browser checks:

```sh
npx playwright install chromium
npm run test:browser
```

Or set `BROWSER_PATH` to an installed Chromium executable. The suite uses real synthesized WAV audio, and real MP4/AAC when ffmpeg with libx264 is installed. External-provider responses in the browser smoke test are explicitly mocked. Provider calls also have server-side contract tests with injected fetch; these do not establish live credentials or model quality.

## GitHub Pages

Select **Settings → Pages → GitHub Actions** once. The workflow tests, builds and deploys on pushes to `main`. It can also run manually from Actions.

GitHub Pages is static hosting. **Do not place API keys in Pages build variables or `VITE_*` values.** Deploy the optional backend separately, put keys in that service's secret environment settings, and enter its URL in **AI & API connections**.
