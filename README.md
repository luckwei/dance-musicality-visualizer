# Musicality studio prototype

An interactive web wireframe for exploring waveform, dance counts, lyric highlighting and optional choreography layouts. Sample data only: uploaded audio changes the session title but is not analyzed or played. No backend or credentials required.

## Develop

Node.js 20.19+ or 22.12+.

```sh
npm ci
npm run dev
```

## Validate

```sh
npm run build
```

Use Play or Space to animate a 48-second sample session. Seek on the waveform or timeline; click counts or words. Compare stacked and side-by-side layouts, 4/8 counts, tempo, three lyric highlight styles, and video visibility. Edit lyric text/start times. Optional demo metronome provides a pulse. Audio balance and video alignment are illustrative controls. Edits are session-only; Reset restores defaults.

Production beat/bar analysis, lyric transcription, real video alignment, and media mixing are future work outside this design prototype.

## GitHub Pages

The prototype is configured for https://luckwei.github.io/dance-musicality-visualizer/.
In the repository's **Settings → Pages**, select **GitHub Actions** as the build and deployment source. The `Deploy prototype to GitHub Pages` workflow builds and deploys on pushes to `main`; it can also be run manually from the Actions tab after enabling Pages.

For local development, open the `/dance-musicality-visualizer/` path shown by Vite.
