# AI choices, cost control, and secrets

## Choose the cheapest adequate mechanism

| Job | Implementation | AI/provider cost |
| --- | --- | --- |
| Waveform, eight-count layout, playback, looping, seeking and mixing | Browser Web Audio/media APIs and JavaScript | No model calls. |
| Tempo/phase estimate and local video offset | Local signal analysis; user verifies the result | No model calls. |
| Syllable splitting and editable timing | Local text heuristics plus human corrections | No model calls; these are estimates. |
| First-pass English lyrics | Optional browser Whisper tiny.en | No provider invoice; model download, device compute, memory and battery are real costs. |
| Higher-resource hosted lyric recognition | Optional OpenAI whisper-1 through your backend | Metered by the provider. Word timestamps are required, so an arbitrary cheaper text-only model is not interchangeable. |
| YouTube search | Official YouTube Data API | API quota applies; it is not generative AI. Link paste avoids search calls. |
| “Which correction should I try next?” | Optional TypeSafe JEV typed choice from metadata/user note | One small request on explicit click. Core playback/editing still works without it. |

Do not use an LLM to redraw a waveform, calculate timestamps, save a project, or decide a simple condition that can be a local rule. The JEV feature is an optional experiment for interpreting a user's description and choosing a review path; it has not been shown to outperform a fixed help flow. It must earn its cost through testing.

## TypeSafe JEV research and scope

The user supplied the official [TypeSafe model documentation](https://docs.typesafe.ai/models). That URL returned HTTP 403 from this environment; current provider pricing and the complete model documentation could not be verified.

The published [TanStack TypeSafe adapter](https://www.npmjs.com/package/@tanstack/ai-typesafe) version 0.1.11 was retrieved from the npm registry. Its distributed source confirms the `TYPESAFE_API_KEY` environment name, `jev-latest` alias, Bearer authentication, and `POST https://api.typesafe.ai/v1/systemone` with `{model,state,questions}`. TanStack AI 0.68.0's published types confirm choice questions with `type`, `instructions`, and `criteria`, and choice answers under `answers`.

The app uses that observed interface behind `/api/review`. Its server request and response handling are tested with injected provider responses. A live TypeSafe request still requires your key and network access; no live benchmark or cost savings claim is made. Verify current pricing and the model alias in TypeSafe's own console/docs before use; `TYPESAFE_MODEL` can pin a supported release.

The advisor sends only audio/video presence, BPM, beat-estimate confidence, syllable count, and an optional note of up to 500 characters. It returns one bounded review action: check tempo, choose count 1, review lyrics, align video, or practice. It does not hear audio, assess choreography, transcribe singing, return calibrated correctness, or change timing.

Potential later experiments: categorize correction notes, prioritize ambiguous phrases for human review, or choose a help flow. Do not route users to paid transcription automatically based on its answer. Compare against local rules and measure correction success, latency and total cost before expanding its role.

## Exactly where keys go

Recommended deployment: keep the frontend on GitHub Pages and deploy the included Docker backend as a Render Web Service. In **Render → your Web Service → Environment**, add:

| Name | Get it from | Needed for |
| --- | --- | --- |
| `OPENAI_API_KEY` | Your OpenAI project API-key settings | Hosted lyric transcription only. |
| `YOUTUBE_API_KEY` | Google Cloud credentials with YouTube Data API v3 enabled | Shared in-app YouTube search only. |
| `TYPESAFE_API_KEY` | Your TypeSafe account | JEV review advice only. |
| `APP_ACCESS_TOKEN` | Generate a long random value yourself | Protect access to all shared provider keys. |
| `ALLOWED_ORIGINS` | Set to `https://luckwei.github.io` | Permit your Pages frontend to call the backend. |
| `TYPESAFE_MODEL` | Optional supported TypeSafe model ID; defaults to `jev-latest` | Pin the decision model if desired. |

The provider keys are individually optional. A configured shared provider key requires a valid `APP_ACCESS_TOKEN`; the server refuses requests that would spend it without that token. A shared token is suitable for a small trusted group, not a complete public multi-user billing/authentication system. Configure provider usage limits and use per-user authentication before a large public rollout.

After deployment, open **AI & API connections** in the app, enter the Render URL and backend access token, and select **My backend** for hosted transcription. The app's **Test connection** checks reachability only, not key validity or quota.

### Personal keys / bring your own key

A user can enter a personal OpenAI or TypeSafe key in **AI & API connections**. The key exists only in page memory, is sent over HTTPS to the selected backend, and is forwarded to its respective provider for that request. The backend code does not persist or log it. A backend operator could change that code, so users must choose a backend they trust. Keys are excluded from exported timing and cleared on page reload or **Clear keys**.

For personal YouTube search, use **Set up YouTube search**. That key is sent directly to Google; restrict it to YouTube Data API v3 and the permitted website referrers. A browser key is observable to its owner and should not be treated as a hidden server secret.

### What about GitHub secrets?

**GitHub → repository → Settings → Secrets and variables → Actions → New repository secret** stores secrets for GitHub Actions jobs. It does not create a running backend or automatically populate Render's environment. The Pages workflow deliberately consumes no provider secrets. Put runtime provider keys in Render's environment settings. Only add GitHub deployment credentials later if you choose an automated deployment workflow that actually needs them.

Never commit real keys, paste them in chat, put them in `VITE_*` variables, pass them as Docker build arguments, or embed them in frontend assets. `.env.example` lists names without values; `.env` and `.env.*` are ignored. For local work, copy `.env.example` to `.env`, enter values locally, and run `node --env-file=.env server/server.mjs` after building.

## Remaining live setup

No backend has been provisioned in a hosting account and no provider keys have been supplied. To activate hosted features, deploy the Docker service, enter only the provider keys you want to use, and connect its URL in the frontend. The local audio editor is independent of those steps.
