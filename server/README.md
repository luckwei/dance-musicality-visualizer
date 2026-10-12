# Optional hosted services

This Node 24 service adds OpenAI transcription and YouTube Data API search to the static app. It also serves the built app at `/` and `/dance-musicality-visualizer/`, including Vite's existing asset base path. GitHub Pages hosts static files only; these API routes require a separate service. Local media analysis and YouTube links work without this backend.

## Run locally

Use Node 24. Run `npm ci`, `npm run build`, then `node server/server.mjs`. Open `http://localhost:3000`. `PORT` defaults to 3000. Put secrets in your hosting platform's secret environment settings or inject them into the server process; do not commit them or prefix them with `VITE_`.

| Environment variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Optional provider key for hosted transcription. |
| `TYPESAFE_API_KEY` | Optional TypeSafe key for JEV review advice. |
| `TYPESAFE_MODEL` | Optional model ID, default `jev-latest`. |
| `YOUTUBE_API_KEY` | Optional provider key with YouTube Data API v3 enabled for hosted search. |
| `APP_ACCESS_TOKEN` | A long random access token required whenever either hosted provider key is used. Share only with intended users. |
| `ALLOWED_ORIGINS` | Comma-separated exact frontend origins. Example: `https://luckwei.github.io,http://localhost:5173`. Same-host requests are allowed automatically. No paths, trailing slashes, or wildcards. |
| `PORT` | Listening port. Hosting platforms normally set this. |

Generate an access token using `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and save it directly in the host's environment settings. Enter that token in the frontend's hosted service settings. A configured provider key without an access token is deliberately unusable. The token protects paid usage; it is not a multi-user account system. All users holding it share the provider's budget. Set provider spending and quota limits before sharing it. Process-local limits permit two simultaneous provider requests and twenty requests per minute per credential and network address; multiple server instances have independent limits.

## Deploy on Render

1. Create a **Web Service**, connect `luckwei/dance-musicality-visualizer`, and select the intended branch.
2. Select **Docker** as the runtime, use repository root as the root directory, and `./Dockerfile` as the Dockerfile path. The image builds the frontend and runs the server as an unprivileged user. Do not add provider keys as Docker build arguments.
3. In the Render service's **Environment**, add `OPENAI_API_KEY` and/or `YOUTUBE_API_KEY`, `APP_ACCESS_TOKEN`, and `ALLOWED_ORIGINS=https://luckwei.github.io`. If testing from Vite too, use `https://luckwei.github.io,http://localhost:5173`. Render supplies `PORT`.
4. Set the health check path to `/api/health`, then deploy the service. Open `https://YOUR-SERVICE.onrender.com/api/health`; it should return `{"ok":true}`. The built app is also available at the service root.
5. In the GitHub Pages app's service settings, enter the Render origin (for example `https://YOUR-SERVICE.onrender.com`) and the app access token. Use hosted transcription or hosted YouTube search. Cold starts on sleeping plans can require a retry.

GitHub repository or Actions secrets **do not automatically become Render environment variables**. Add secrets to the Render service itself. Never expose `OPENAI_API_KEY`, `YOUTUBE_API_KEY`, or `APP_ACCESS_TOKEN` through a `VITE_*` variable, a committed file, frontend build arguments, URLs, or the public health endpoint. For a backend YouTube key, use the provider's server-side restrictions where supported, rather than browser HTTP-referrer restrictions; a personal frontend search key should use website restrictions instead.

## API

`GET /api/health` returns only `{"ok":true}` and exposes no configured-key information.

`POST /api/transcribe` accepts the **raw audio bytes** with an audio `Content-Type` (or `application/octet-stream`) and `X-File-Name: song.mp3`. Supported formats are MP3, MP4, MPEG/MPGA, M4A, WAV, WebM, FLAC, and OGG. Maximum body size is 25,000,000 bytes. Uploads time out after 30 seconds and provider requests after 90 seconds. The response is `{"words":[{"start":0.1,"end":0.4,"text":"Hello"}],"model":"whisper-1"}`. Word timestamps come from OpenAI; syllable subdivision is performed in the app and remains editable. Transcription sends the uploaded audio to OpenAI.

Choose one authentication mode for transcription:

- **Hosted key:** send `X-App-Token` matching `APP_ACCESS_TOKEN`. The server uses its `OPENAI_API_KEY` and refuses requests if either server setting is absent.
- **Personal key:** send `Authorization: Bearer PERSONAL_OPENAI_KEY`. This request uses that personal key instead of the server key and does not require the shared app token. The key stays in request memory and is sent only to the fixed OpenAI endpoint. Use HTTPS outside local development.

`GET /api/youtube-search?q=choreography` requires `X-App-Token` and a configured `YOUTUBE_API_KEY`. It returns `{"videos":[{"id":"...","title":"...","channel":"...","thumbnail":"..."}]}` using YouTube's official embeddable/syndicated-video search. This service never downloads YouTube audio or video.

Errors use `{"error":"Human-readable message"}` with HTTP 400/401/403/405/408/413/415/422/429/502/503/504 as appropriate. Provider messages are redacted, and the server does not log request bodies, keys, filenames, queries, or provider responses. CORS permits only same-host origins and `ALLOWED_ORIGINS`; server-to-server requests without an Origin header still require normal authentication.

Run `node --test tests/server.test.js` to validate authentication, CORS, size/rate/concurrency limits, fixed provider requests, errors, and static serving without contacting providers.

## Optional TypeSafe JEV advisor

Add `TYPESAFE_API_KEY` in the backend host's Environment settings (or let a user supply a personal TypeSafe key for one request). `TYPESAFE_MODEL` optionally overrides `jev-latest`. A shared key requires `APP_ACCESS_TOKEN` just like the other providers.

`POST /api/review` takes JSON `{hasAudio:boolean,hasVideo:boolean,bpm:number,syllableCount:integer,beatConfidence:number,note:string}`. The note is limited to 500 characters; the body to 16 KB. Authentication is either `X-App-Token` for the shared TypeSafe key or `Authorization: Bearer PERSONAL_TYPESAFE_KEY`. It calls the fixed TypeSafe `/v1/systemone` endpoint with a bounded typed choice and returns `{action,suggestion,model}`. The app never sends media or lyric text to JEV, and a suggestion does not alter timing. See [verification and cost scope](../docs/AI-AND-SECRETS.md).
