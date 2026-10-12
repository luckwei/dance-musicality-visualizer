# Musicality Studio: interaction research and validation plan

Prepared 12 October 2026. This document combines a code review, authoritative documentation, and design hypotheses. It does **not** report interviews, usability sessions, a formal accessibility audit, or measured recognition accuracy on commercial music. The implementation is changing during this review; recommendations below describe the review baseline and should be checked against the final build.

## What the interface needs to communicate

The shared unit is **one eight-count phrase**. Waveform amplitude, evenly spaced counts, lyric syllables, and the moving playhead use the same time mapping. A syllable belongs where it is sung, including between counts; snapping is optional. Every phrase has the same visual width even when a final phrase contains only part of the recording.

Separate three ideas that are easy to confuse:

1. **Tempo** describes the spacing of beats. An automatic estimate can be half or double the useful dance tempo.
2. **Count 1** is the dancer's chosen phrase start. Finding an audio attack does not establish the musical downbeat, bar boundaries, or choreography's count 1.
3. **Video offset** places a video frame on the song's timeline. It does not change tempo or lyric timing.

The current analyzer estimates a single constant tempo and an attack phase. It does not infer a complete variable-tempo beat map or music-theory meter. Wording such as “Estimated tempo” and “Choose your count 1” reflects those capabilities. “Every eight falls into place” needs qualification for live performances, tempo changes, and edited choreography audio.

## Evidence and source access

The public HTML endpoints for W3C, GitHub Docs, Google developer documentation, Hugging Face, and Nielsen Norman Group returned an HTTP 403 tunnel response in this environment. Official source documents were successfully retrieved from the publishers' GitHub repositories where available. This is a documentation-access limitation, not evidence that those services are unavailable in a user's browser.

| Source | What was verified | Relevance |
| --- | --- | --- |
| W3C, [Understanding SC 2.5.7: Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [retrieved official source](https://github.com/w3c/wcag/blob/main/understanding/22/dragging-movements.html) | A drag action needs a single-pointer alternative. Keyboard access alone is insufficient for this criterion; numeric text inputs can provide an equivalent alternative. | Keep precise timing fields and clickable nudge controls, alongside dragging. |
| W3C, [Understanding SC 2.1.1: Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [retrieved official source](https://github.com/w3c/wcag/blob/main/understanding/20/keyboard.html) | Comparable actions must be possible through a keyboard interface. Discoverable conventional controls are recommended. | Editing, applying an estimate, undoing, seeking, and closing dialogs need keyboard paths. |
| W3C, [Understanding SC 2.5.8: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [retrieved official source](https://github.com/w3c/wcag/blob/main/understanding/22/target-size-minimum.html) | The criterion uses a 24 × 24 CSS pixel minimum with specified exceptions, including spacing and equivalent controls. Larger targets remain useful. | Dense syllables need a comfortably sized selection/editor alternative; count and transport controls should have generous targets. |
| GitHub, [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [retrieved official source](https://github.com/github/docs/blob/main/content/pages/getting-started-with-github-pages/what-is-github-pages.md) | Pages publishes HTML, CSS, and JavaScript as a static site, optionally after a build. | Browser processing and external APIs are possible. A server-side secret store or hosted inference backend is not supplied by Pages. |
| OpenAI, [Whisper model card](https://github.com/openai/whisper/blob/main/model-card.md) | The models target speech recognition/translation; the card documents hallucinated and repetitive text and recommends evaluation in the actual deployment domain. | Treat singing transcription as a draft. The card does not establish accurate syllable alignment for songs. |
| Google, [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [search.list](https://developers.google.com/youtube/v3/docs/search/list), and [API key best practices](https://cloud.google.com/docs/authentication/api-keys-best-practices) | Reference URLs identified; current page contents could not be retrieved. App code was reviewed separately. | Recheck provider details before quoting quotas or making compatibility guarantees. The implementation uses embedded playback and an optional Data API search key. |
| Nielsen Norman Group, [10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Reference URL identified; the current article could not be retrieved. No quotation or claim of newly verified wording is made. | “Recognition rather than recall,” user control, and error recovery guide the hypotheses below. |
| Hugging Face, [onnx-community/whisper-tiny.en](https://huggingface.co/onnx-community/whisper-tiny.en) | The model identifier, quantized loading, and WASM execution are verified in this repository's worker. Its current remote model card and artifact sizes could not be retrieved. | Download size and performance need measurement in the deployed browser; they are not fixed UX promises. |

## Three modes to compare

Modes are presets for attention and available controls over **one shared project**. Switching modes should retain playback position, loop, tempo, count 1, media, and edits. Show the selected mode in words, and make the complete editing tools discoverable from each mode.

| Mode | Main task and hierarchy | Controls to emphasize | Hypothesis to test |
| --- | --- | --- | --- |
| **Learn** | Watch the active eight, then the upcoming eight, with optional choreography. | Play/pause, phrase loop, previous/next eight, speed, large counts, follow-playhead toggle. Keep correction tools one action away. | A learner can recognize the current count and anticipate a syllable without repeatedly moving attention between distant panels. |
| **Align** | Establish count 1 and match a song moment with a video moment. Show the current eight and video together. | Estimated BPM, tap/half/double tempo, set count 1 at playhead, one-beat phase shifts, independent frame selection, offset nudges, link-playback toggle, song/video balance. | Users understand which parameter to adjust when everything is displaced versus when timing progressively drifts. |
| **Correct** | Review a small set of syllables while hearing their phrase. | Selected syllable text/start/end, play selection, earlier/later nudge, snap toggle, split/merge or explicit hyphen entry, delete, undo/redo, apply/discard draft. | Editing alongside the relevant sound causes fewer timing errors than a large isolated table of seconds. |

Keep the full timing table as an equivalent precise editing route. Do not require a double-click to discover it, and do not require dragging on a phone. A mode switch should not unexpectedly mute sound, start playback, clear timing, or apply an AI candidate.

## Correction and AI review contract

Automatic analysis proposes changes; the existing project remains the working version until application.

1. **Before running:** describe the scope, language, data path, and likely wait. For local transcription, state that the speech model downloads to the device, inference runs locally, and singing can be inaccurate. Let users continue learning or cancel while processing.
2. **When a candidate is ready:** show current versus proposed lyric text and timing, and allow playback of a selected affected phrase. Mark interpolated syllables as estimated. Highlight added/removed words and shifted times, not merely the number of output tokens.
3. **Apply or discard:** keep both actions adjacent. Applying creates one undoable change; discarding keeps existing edits intact. A no-words result must not erase a manually corrected transcript.
4. **If the project changes during processing:** do not replace the newer project silently. Tie the candidate to its source media and project revision, then allow deliberate review or discard.
5. **After correction:** show a quiet saved/unsaved state. Export/import needs to explain that the timing file does not contain the media. Retain an undo path for drag, delete, timing edits, replacements, tempo, and video offset.

The side-by-side comparison and visible current values apply recognition-over-recall as a design hypothesis. Clear undo and local error messages support recovery; neither has yet been validated with this app's users.

## Priority findings from the code review

| Priority | Failure or uncertainty | User consequence | Recommended response and verification |
| --- | --- | --- | --- |
| **P0** | Transcription completion, “Place lyrics,” and timing import directly replace `state.syllables` in the review baseline. | Manual corrections disappear, including when a slow AI job finishes after an edit. | Use pending drafts, revision-aware apply, undo, and no-op discard. Test editing while transcription is running. |
| **P0** | `tick()` resynchronizes the video every 700 ms even while paused. | Independently seeking the video is immediately reversed, making “Align current frames” unreliable. | In frame-selection mode explicitly suspend linked playback. Capture both anchors, apply their difference, and relink. Test native and YouTube players separately. |
| **P0** | A normalized envelope correlation is displayed as “N% match.” It is not a calibrated probability. Repeated choruses can produce plausible wrong offsets. | Users may trust a wrong phrase alignment. | Label an estimated offset, require listening at more than one landmark, preserve low-confidence candidates without auto-applying, and expose nudges/undo. |
| **P1** | Beat analysis can choose half/double tempo; the earliest attack is not necessarily count 1. | A clean-looking grid can be musically wrong. | Keep half/double/tap controls and a clear count-1 action; add ±1 beat shifts. Label estimation and make the dancer's interpretation authoritative. |
| **P1** | One BPM value cannot describe changing tempo or different edits of a song. | Start alignment looks correct but later phrases drift. | Check beginning, middle, and end. Explain this limitation; a future tempo map needs per-section anchors. Do not promise an offset slider fixes drift. |
| **P1** | Speech ASR can hallucinate words in instrumental sections or mishear singing; English-only transcription limits language coverage. | Confident-looking lyrics mislead a learner. | Keep empty instrumental regions editable; offer paste/import, candidate review, deletion, and language disclosure before starting. Evaluate singing separately from speech. |
| **P1** | Word timestamps are split across heuristic English syllables using estimated durations. | A melisma, elision, “fire,” or non-English word may have the wrong number and position of highlights. | Label syllable timing as estimated, preserve manual splits, and provide explicit text and start/end edits. Test repeated vowel sounds and a held syllable crossing an eight boundary. |
| **P1** | Drag is easy to trigger accidentally; `pointercancel` uses the same commit path as pointer-up in the review baseline. | A interrupted touch gesture can commit a timing change. | Restore the original timing on cancellation, use a movement threshold, allow undo, and provide clickable/keyboard nudges and numeric fields. |
| **P1** | Model download and single-threaded inference can be slow or fail; a media-byte limit does not bound decoded PCM memory. | The browser appears stuck or exhausts memory, especially on phones. | Distinguish download from inference, keep cancel responsive, offer shorter clips/manual lyrics, retain prior edits, and measure cold/warm performance on real devices. |
| **P1** | Loading another song clears cues; timing is session-based. | Switching media or refreshing loses work. | Indicate unsaved timing, make export obvious, and provide recovery appropriate to the storage policy. Define undo history per media rather than applying old timing to unrelated audio. |
| **P2** | All eights and all cues render at once; labels can overlap on narrow displays. | Long songs become costly to render and individual targets become difficult to select. | Start with a mobile layout and a selected-cue editor. Measure long tracks; render a limited phrase window if necessary. Maintain the same axis mapping. |
| **P2** | YouTube speed options can differ from the requested song speed; embedding/autoplay can be blocked. | Video drifts or stays paused while the UI implies synchronization. | Surface the actual supported rate and player error, with manual playback/link alternatives. Validate on the published origin. |
| **P2** | Moving playheads and automatic scrolling may be distracting; errors currently rely partly on timed notices. | Users lose orientation or miss a recovery action. | Offer follow off, honor reduced motion for scrolling, keep important errors beside the failing control, and avoid announcing frame-by-frame motion to screen readers. |

These are prioritization findings, not claims that every listed issue remains in the final build. A final regression pass should close or explicitly defer each item.

## Costs, keys, and realistic service boundaries

| Capability | Current implementation and data path | Key or cost implication |
| --- | --- | --- |
| Local audio playback, waveform, tempo, manual lyrics, mixing, local video alignment | The browser decodes and analyzes selected files. The reviewed code does not upload these samples to a transcription service. | No paid inference API or credential is used for these operations. Device memory/CPU and normal network/hosting costs still exist. |
| Automatic English transcription | The worker loads `onnx-community/whisper-tiny.en` through Transformers.js using quantized WASM inference. Model assets download separately from the audio. | No transcription API key or per-minute vendor request is implemented. Download size, time, browser cache behavior, and battery impact should be measured. The app's download estimate must remain approximate unless derived from selected artifacts. |
| Pasted YouTube link | Official embedded player; the app controls play, seek, volume, and supported playback rate. It does not obtain decoded song samples from that iframe. | A pasted link does not require a Data API search key. Matching local audio is needed for the implemented waveform/transcription workflow. |
| Search results inside the app | `search.list` requests go to Google using the user's entered YouTube Data API key. The reviewed implementation keeps the key in memory for the page session and excludes it from timing export. | The user must configure an eligible Google project/key. Verify current quota and terms with Google; do not describe quota units as a dollar price or promise unlimited searches. Link paste/external YouTube search remains available. |
| Future hosted transcription or source separation | Would require a deliberately chosen provider and backend/proxy, outside the current Pages-only architecture. | Publish verified provider pricing, upload handling, and per-job limits before enabling it. Never place a server secret in a public Pages bundle. No provider price is asserted here. |

A browser-visible API key is not a secret simply because its input is masked. The search key should be constrained to the appropriate API and allowed website origins where supported. Do not ask users to paste server-side inference secrets into this static site. Project exports, logs, and source code must exclude keys.

GitHub Pages supplies static hosting, not private execution for model APIs. This is compatible with browser-only processing, but it does not make arbitrary YouTube audio extraction possible. Avoid a workflow that promises “search any video → automatically analyze its audio” when the actual implemented path is “choose a video → open matching local audio.”

## Meaningful validation tasks

The following are **planned tasks and acceptance criteria**, not completed user testing. Use recordings with known rights and known timings, plus volunteered user material where appropriate. Synthetic audio can test temporal correctness but cannot establish performance on real music.

| Task | Test material or deliberate fault | Evidence to collect / acceptance condition |
| --- | --- | --- |
| Understand the eight | A steady-tempo phrase with a lyric deliberately between counts 3 and 4. | Participant identifies the highlighted syllable and expected next count; waveform, counts, and cue retain their shared time mapping at every viewport size. |
| Fix the tempo level | Start a 120 BPM recording with an intentionally incorrect 60 BPM grid. | Participant discovers the double-tempo control, checks more than one eight, and can undo. Record time, false starts, and whether terminology causes confusion. |
| Choose count 1 | Opening silence and a pickup note before the desired choreographic phrase. | Participant sets the intended phrase start without changing lyric times or video offset; can move by one beat and recover. |
| Detect drift | A recording that changes tempo mid-song or a choreography video with a cut. | Participant notices that a single offset does not solve all sections. The app does not falsely label it perfectly synchronized. |
| Match two media timelines | Video with a known 2.4-second extra intro; repeat with video starting part-way through the song. | Participant independently selects both anchors, applies the correct sign, auditions two landmarks, and restores the previous offset. Links do not snap back during anchor selection. |
| Reject an ambiguous auto-alignment | Two nearly identical choruses at different positions. | Low/ambiguous confidence is understandable; participant can compare landmarks and fix the offset instead of trusting a percentage. |
| Correct an AI draft | A transcript with a wrong word, missing word, hallucinated instrumental line, and mis-split syllable. | Existing edits survive generating/discarding a draft. Applying is undoable. Participant corrects text and timing while hearing the affected phrase. |
| Recover from a gesture | Drag a syllable across an eight boundary, cancel a touch gesture, delete the syllable, then undo. | Cancel restores original timing; undo returns identical text/start/end; keyboard and single-pointer numeric alternatives complete the same changes. |
| Recover from latency or error | Cold model cache, blocked model download, cancellation, unsupported media, and exhausted/rejected search key. | Existing playback and edits remain usable; status distinguishes the failure; a visible retry/manual route works; no invalid draft is applied. |
| Use without an API key | Search intent with no key, then paste a known embeddable YouTube URL. | Participant reaches useful playback and understands why waveform/transcription needs a local file; key configuration is optional to the primary workflow. |
| Move between modes | Create a loop and edit cues, then switch Learn → Align → Correct → Learn. | No project settings or edits change merely because of mode selection. Selected mode and available next action are clear. |
| Use keyboard, touch, and zoom | Keyboard-only; a narrow touch screen; 200% browser zoom; reduced motion; at least one screen-reader check. | Core tasks work without dragging; focus remains visible and logical; no inaccessible modal trap; sticky transport does not cover focused controls; important actions have adequate targets. |
| Keep work | Export, reload/open matching media, import; attempt import against different media. | Export round-trips timing accurately and excludes keys/media. Wrong-media import has understandable consequences; no silent timing replacement. |

For formative testing, recruit dancers with different familiarity with eight-counts, including a teacher/choreographer and first-time learners. Include keyboard and touch users rather than treating them as an afterthought. Begin with approximately five to eight sessions to find recurring issues; that sample is a practical planning choice, not a statistical guarantee.

Record task completion, time to the first correct action, unintended changes, successful recovery, and participants' explanations of tempo/count 1/video offset. Ask users to show what they would change before explaining controls. Compare Learn/Align/Correct against one all-controls view on the same tasks, counterbalancing order where possible. Prioritize recurring misunderstanding and lost work over aesthetic preference. Report observations separately from any model-accuracy benchmark or accessibility conformance claim.

## Implementation follow-up

The finished revision adds the three shared-project modes, intro/pickup rows, tempo/phase nudges, drag cancellation recovery, timing undo/redo, lyric candidate review, independent video-frame selection via Link playback, and export before track-replacement guidance. The optional Node backend and key UI now exist; the earlier “future hosted” discussion describes the initial review baseline rather than the final scope. Model-assisted JEV review is optional and advisory. See [AI and secrets](AI-AND-SECRETS.md) for the current provider contracts and limitations.

Automated Chromium checks exercise actual WAV playback, count spacing, phrase looping, lyric review/drag/table correction/undo, mode switching, import/export without keys, and MP4 audio alignment against a known 2.4-second delay. These are functional checks, not a replacement for the participant tasks above. Provider-specific calls are mocked in automated tests; live service credentials and local model inference remain to be validated.
