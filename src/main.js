import './style.css';
import { analyzeAudio, alignAudio, resampleMono } from './audio-analysis.js';
import { companionTime, sourceGains, shiftCues } from './media-routing.js';
import { backendRequest } from './backend.js';
import { mountYouTube } from './youtube.js';
import { transcribeAudio } from './transcription.js';
import { wordsToSyllables, parseTimedLyrics } from './lyrics.js';
import { clamp, phraseAt, phraseBounds, phraseCount, waveformPath, validateProject } from './timeline.js';

const $ = selector => document.querySelector(selector);
const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const format = time => `${Math.floor(Math.max(0,time)/60)}:${Math.floor(Math.max(0,time)%60).toString().padStart(2,'0')}`;
const state = { duration:0, bpm:120, offset:0, time:0, playing:false, speed:1, mix:100, videoOffset:0, syllables:[], song:null, video:null, videoMode:'youtube', timeline:null, soundSource:'video', youtube:null, loop:null, activePhrase:-1 };
const undoStack=[], redoStack=[];
let pendingLyrics=null, lyricRevision=0, savedRevision=0;
const audio = new Audio();
audio.preload = 'auto';
let audioContext, transcriptionController, mediaGeneration = 0, videoGeneration = 0, currentCue = -1, lastVideoSync = 0, lastYoutubePoll = 0, youtubeAnchor = null, taps = [], transportGeneration = 0;

document.querySelector('#app').innerHTML = `
<header class="topbar"><a class="brand" href="#">m<span>•</span><span class="brand-name">musicality</span></a><span class="header-note">SEE WHAT YOU HEAR</span><button id="export" class="button quiet">Export timing ↗</button><button id="import" class="button quiet">Import timing</button><input id="project-file" type="file" accept=".json,application/json" hidden></header>
<main><div class="page-heading"><div><p class="eyebrow">ONE PHRASE. EVERY DETAIL.</p><h1>Find your rhythm<span>.</span></h1><p class="subtitle">Waveform, counts, and syllables. All on the same eight.</p></div><div class="source-actions"><button id="choose-video" class="button primary">▶ Use a video</button><button id="upload" class="button">＋ Add audio <span>(optional)</span></button></div><input id="audio-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg" hidden></div>
<div class="mode-switcher" aria-label="Workspace mode"><span>Workspace</span><button class="mode-choice" data-mode="learn">Learn</button><button class="mode-choice" data-mode="align">Align</button><button class="mode-choice active" data-mode="correct">Correct</button><span class="mode-description" id="mode-description">See the detail. Fix what you hear.</span></div><div class="workspace"><section class="music-workspace"><div class="track-bar"><div class="track-icon">♫</div><div><h2 id="track-name">Start with a video or audio</h2><p id="track-detail">YouTube, your own video, an audio file — or both</p></div><span class="local-badge" id="source-badge">LOCAL FIRST</span></div>
<div class="source-routing"><label for="sound-source">Listen to</label><select id="sound-source" aria-label="Audio source"><option value="video">Video soundtrack</option><option value="audio">Uploaded audio</option><option value="mix">Mix both</option></select><span id="source-status">No media loaded</span><button id="remove-audio" class="text-button" hidden>Remove uploaded audio</button></div><p id="source-help" class="help source-help">A video can be your entire session. Separate audio is optional.</p><div class="timing-toolbar"><label>Tempo <input id="bpm" type="number" min="40" max="240" step="0.1" value="120"> <span>BPM</span></label><button id="tap-tempo" class="button mini">Tap tempo</button><span class="toolbar-divider"></span><label>Count 1 at <input id="first-count" type="number" min="0" step="0.01" value="0"> <span>s</span></label><button id="set-first" class="button mini">Set at playhead</button><button id="half-tempo" class="text-button">½</button><button id="double-tempo" class="text-button">×2</button></div>
<div class="correction-toolbar"><button class="button mini" id="undo" disabled>↶ Undo</button><button class="button mini" id="redo" disabled>↷ Redo</button><button class="button mini" id="phase-back">Count 1 −1 beat</button><button class="button mini" id="phase-forward">+1 beat</button><span class="help" id="edit-state">Edits stay on this device</span></div><p id="pickup-note" class="help" hidden></p><div class="score-heading"><span>THE EIGHT-COUNT SCORE</span><button id="jump-lyrics" class="text-button">Add / edit lyrics ↓</button><div><label><input type="checkbox" id="follow" checked> Follow playhead</label><label><input type="checkbox" id="snap"> Snap syllables</label></div></div>
<div id="score" class="score"><div class="empty-score"><div class="empty-eights">1 <span>&</span> 2 <span>&</span> 3 <span>&</span> 4 <span>&</span> 5 <span>&</span> 6 <span>&</span> 7 <span>&</span> 8 <span>&</span></div><h2>Your music, one eight at a time.</h2><p>Start with a YouTube link, your own video, or an audio file.<br>Listen, set count 1, and place your lyrics on the same eight.</p><button class="button" id="try-example">Try a generated rhythm</button><small>A real synthesized audio clip for trying the controls.</small></div></div>
<div class="score-footer"><span>Drag syllables to adjust timing · click anywhere to seek</span><span id="phrase-total">8 counts per phrase</span></div>
<section class="lyrics-tools"><div class="section-heading"><div><h2>Put words to the rhythm</h2><p>Transcribe locally, paste lyrics, or import timed lyrics.</p></div><button id="edit-timing" class="button">Edit syllables</button></div><textarea id="lyrics-text" rows="3" placeholder="Paste lyrics, use hy-phens for syllables, or add timestamps:&#10;[00:12.50] you de-cide who&#10;[00:16.80] lights up the room" aria-label="Lyrics text or timed lyrics"></textarea><div class="lyrics-actions"><button id="place-lyrics" class="button">Place lyrics</button><button id="transcribe" class="button primary">✧ Transcribe audio</button><button id="cancel-transcription" class="button" hidden>Cancel</button><label class="file-button">Import .lrc / .txt<input type="file" id="lyrics-file" accept=".lrc,.txt,text/plain" hidden></label></div><p class="help">Automatic transcription downloads an English speech model (a substantial first-time download) and runs on this device. Singing can be inaccurate. Syllable splits and timing are estimates you can edit.</p><div id="transcription-status" class="task-status" role="status" hidden></div></section>
</section>
<aside class="video-sidebar"><section class="video-card"><div class="section-heading"><div><p class="eyebrow">THE MOVEMENT</p><h2>Your video</h2></div><span class="optional-label">SOUND + MOVEMENT</span></div><div class="tabs"><button id="tab-youtube" class="active">YouTube</button><button id="tab-local">Your video</button></div><div id="youtube"></div><div id="local-video" hidden><label class="video-drop" for="video-file">＋ Open a choreography video<span>MP4, WebM, or a format your browser supports</span></label><input type="file" id="video-file" accept="video/*" hidden><video id="choreography" playsinline controls preload="metadata" hidden></video><p id="video-file-name" class="help"></p></div><p class="help youtube-note" id="youtube-note">Use YouTube on its own: video audio, playback, eight-counts, loops, and editable lyrics. Waveform, automatic beats, and transcription need accessible audio samples; YouTube’s embedded player does not provide them. A matching audio file is an optional way to add that analysis.</p><div class="video-adjustments"><label class="link-playback"><input type="checkbox" id="link-playback" checked> Link video and audio</label><label class="field-row"><span>Video offset</span><span><input id="video-offset" type="number" step="0.05" value="0"> s</span></label><p class="help">Video time = song time + offset. Use a positive value when the video has a longer intro.</p><div class="alignment-actions"><button class="button mini" id="align-video">Auto-align local video</button><button class="button mini" id="align-here">Align current frames</button></div><p id="alignment-status" class="help" role="status"></p><details id="audio-preview" hidden><summary>Preview uploaded audio for alignment</summary><p class="help">Unlink the tracks to choose matching moments independently. Select Uploaded audio above to hear this track, then use Align current frames.</p></details><label class="field-row mix-label" for="mix"><span>Audio balance</span><strong id="mix-value">100% song</strong></label><input type="range" id="mix" min="0" max="100" value="100"><div class="range-labels"><span>Video</span><span>Uploaded audio</span></div><p id="video-sync-state" class="help"></p></div></section><div class="tip-card"><span>↗</span><p>Find count 1 first.<br>Then check the middle and end.</p></div><details class="settings-card" id="ai-settings"><summary>AI & API connections</summary><p class="help">Start free with local processing. Connect your own backend when you want hosted transcription or shared YouTube search.</p><label>Transcription method<select id="transcription-method"><option value="local">On this device · no API cost</option><option value="backend">My backend · hosted Whisper</option></select></label><label>Backend URL<input id="backend-url" type="url" placeholder="https://your-app.onrender.com" autocomplete="off"></label><label>Backend access token<input id="backend-token" type="password" placeholder="App access token from your backend" autocomplete="off"></label><label>Personal OpenAI key (optional)<input id="personal-key" type="password" placeholder="Use my key instead of the server’s" autocomplete="off"></label><p class="key-notice">Keys stay in memory and are sent only to your chosen backend over HTTPS. That backend forwards your OpenAI key to OpenAI without saving it. Only connect a backend you trust. Hosted transcription uploads your audio; local mode keeps audio on this device.</p><button class="button mini" id="test-backend" type="button">Test connection</button><button class="button mini" id="clear-keys" type="button">Clear keys</button><p id="backend-status" role="status"></p><h3>Optional JEV review advisor</h3><p class="help">Ask JEV to suggest a review step from project metrics and your note. It receives no audio or lyrics and never edits timing. One request is made only when you click.</p><label>Personal TypeSafe key (optional)<input id="typesafe-key" type="password" placeholder="Or use TYPESAFE_API_KEY on the backend" autocomplete="off"></label><label>What feels wrong?<input id="review-note" type="text" maxlength="500" placeholder="e.g. counts fit at the start but drift later"></label><button id="jev-review" class="button mini" type="button">Ask JEV for a review step</button><p id="jev-status" class="help" role="status"></p><p class="help">YouTube search uses the backend when its URL is set and no Google key is entered above. A personal OpenAI key is never used for YouTube.</p></details></aside></div>
</main><div class="transport-wrap"><div class="transport"><button id="restart" class="icon-button" aria-label="Restart">↤</button><button id="play" class="play-button" aria-label="Play" disabled>▶</button><span class="clock"><strong id="current-time">0:00</strong> <span>/ <span id="duration">0:00</span></span></span><input id="seek" type="range" min="0" max="1" step="0.001" value="0" aria-label="Seek" disabled><span id="live-count" class="live-count">— / 8</span><label class="speed-label"><select id="speed" aria-label="Playback speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label><button id="loop" class="button mini" aria-pressed="false">Loop this eight</button></div></div><div id="notice" role="status" hidden></div>
<dialog id="review-dialog"><form method="dialog"><div class="section-heading"><div><h2>Review suggested lyrics</h2><p>Your current timing stays intact until you apply this suggestion.</p></div><button class="button" value="cancel" aria-label="Close lyric review">✕</button></div><p id="review-summary" class="help"></p><div class="review-columns"><div><h3>Current</h3><div id="review-current"></div></div><div><h3>Suggested</h3><div id="review-proposed"></div></div></div><p class="help">Recognition and syllable timing are estimates. Apply, listen, and use Undo or Edit syllables to correct mistakes.</p><div class="dialog-actions"><button class="button" value="cancel">Keep current</button><button class="button primary" type="button" id="apply-suggestion">Apply suggestion</button></div></form></dialog><dialog id="timing-dialog"><form method="dialog"><div class="section-heading"><div><h2>Edit every syllable</h2><p>Start and end times are in seconds. Each row is one highlight.</p></div><button class="button" value="cancel" aria-label="Close timing editor">✕</button></div><div class="editor-columns"><span>Start</span><span>End</span><span>Syllable</span><span></span></div><div id="timing-editor"></div><div class="dialog-actions"><button type="button" id="add-cue" class="button">＋ Add syllable</button><button type="button" id="save-cues" class="button primary">Save timing</button></div><p id="timing-error" role="alert"></p></form></dialog>`;
const localVideo = $('#choreography');
audio.controls=true;audio.setAttribute('aria-label','Uploaded audio alignment preview');$('#audio-preview').append(audio);
const youtube = mountYouTube($('#youtube'), {
  searchProvider: async (query, options) => {
    if(!$('#backend-url').value.trim())throw new Error('Add a YouTube Data API key above, connect your backend in AI & API connections, or search on YouTube and paste a link.');
    const result=await backendRequest($('#backend-url').value.trim(),`/api/youtube-search?q=${encodeURIComponent(query)}`,{token:$('#backend-token').value,signal:options.signal});return result.videos;
  },
  onSelect(video) {
    pause();mediaGeneration++;$('#upload').disabled=false;state.youtube=video;youtubeAnchor=null;state.videoMode='youtube';
    $('#video-offset').value=0;state.videoOffset=0;state.soundSource='video';
    showVideoTab('youtube');
    if(state.timeline!=='audio'||!state.song)resetVideoTimeline();
    refreshMediaUI();renderScore();syncVideo(true);updateTransport();
  },
  onError: message => notice(message, true),
  onStateChange(event) {
    if(state.timeline!=='video'||state.videoMode!=='youtube'||!state.youtube)return;
    youtubeAnchor=null;
    state.playing=youtube.player.isPlaying();
    refreshVideoDuration();
    if(event.data===0)onPrimaryEnded();
    else {syncVideo(true);updateTransport();}
  },
});
function notice(message, error = false) {
  $('#notice').textContent = message; $('#notice').hidden = false; $('#notice').classList.toggle('error', error);
  clearTimeout(notice.timer); notice.timer = setTimeout(() => $('#notice').hidden = true, error ? 14000 : 7500);
}
function hasVideo() { return state.videoMode === 'local' ? Boolean(state.video) : Boolean(state.youtube); }
function getVideoTime() { return state.videoMode === 'local' ? localVideo.currentTime : youtube.player.getCurrentTime(); }
function getVideoDuration() { return state.videoMode === 'local' ? localVideo.duration : youtube.player.getDuration(); }
function pauseVideo() { localVideo.pause(); youtube.player.pause(); }
function setVideoTime(time) { if (state.videoMode === 'local') localVideo.currentTime = time; else youtube.player.seek(time); }
function sourceMedia() {
  if(state.timeline==='video'&&state.videoMode==='local'&&state.video&&(state.video.buffer||!state.song))return {media:state.video,shift:0};
  if(state.song)return {media:state.song,shift:state.timeline==='video'?state.videoOffset:0};
  return null;
}
function primaryVideo(){return state.timeline==='video'&&hasVideo();}
function canPlay(){return state.timeline==='audio'?Boolean(state.song):hasVideo();}
function showVideoTab(mode){
  $('#youtube').hidden=mode!=='youtube';$('#local-video').hidden=mode!=='local';$('#youtube-note').hidden=mode!=='youtube';
  $('#tab-youtube').classList.toggle('active',mode==='youtube');$('#tab-local').classList.toggle('active',mode==='local');
}
function refreshVideoDuration(){
  if(!primaryVideo())return;
  const duration=getVideoDuration();
  if(Number.isFinite(duration)&&duration>0&&Math.abs(state.duration-duration)>.05){state.duration=duration;renderScore();refreshMediaUI();updateTransport();}
}
function resetVideoTimeline(){
  transcriptionController?.abort();state.timeline='video';state.duration=Number.isFinite(getVideoDuration())?getVideoDuration():0;
  state.time=0;state.playing=false;state.offset=0;state.bpm=120;state.loop=null;state.syllables=[];resetHistory();
  $('#bpm').value=120;$('#first-count').value=0;$('#lyrics-text').value='';$('#transcription-status').hidden=true;
}
function refreshMediaUI(){
  const videoName=state.videoMode==='local'?state.video?.file.name:state.youtube?.title;
  $('#track-name').textContent=(state.timeline==='video'?videoName:state.song?.file.name)||'Start with a video or audio';
  const source=sourceMedia(),analysis=source?.media.analysis;
  $('#track-detail').textContent=!canPlay()?'YouTube, your own video, an audio file — or both':`${format(state.duration)} · score follows ${state.timeline==='video'?'video':'uploaded audio'} · ${analysis?'waveform available':'set tempo by ear or tap'}`;
  $('#source-badge').textContent=!canPlay()?'CHOOSE A SOURCE':state.timeline==='video'?(state.videoMode==='youtube'?'YOUTUBE':'VIDEO SOUNDTRACK'):'LOCAL AUDIO';
  const both=Boolean(state.song&&hasVideo());
  $('#sound-source').querySelector('[value="audio"]').disabled=!state.song;
  $('#sound-source').querySelector('[value="video"]').disabled=!hasVideo();
  $('#sound-source').querySelector('[value="mix"]').disabled=!both;
  if(!both)state.soundSource=hasVideo()?'video':'audio';
  $('#sound-source').value=state.soundSource;$('#sound-source').disabled=!canPlay();
  $('#remove-audio').hidden=!state.song;$('#audio-preview').hidden=!both;
  $('#source-status').textContent=both?'Both sources loaded':hasVideo()?'Video only · no audio upload needed':state.song?'Audio only':'No media loaded';
  $('#source-help').textContent=state.videoMode==='youtube'&&hasVideo()&&!state.song?'YouTube audio drives playback and your counts. Set tempo and add lyrics manually; upload matching audio only if you want waveform analysis or transcription.':state.videoMode==='local'&&hasVideo()&&!state.song?'The video’s own soundtrack is used. No separate audio file is required.':both?'Choose the video soundtrack, uploaded audio, or a blend. Adding audio keeps your existing score timing. Align the tracks if their intros differ.':'Start with a video or an audio file. You can add the other later.';
  $('#video-offset').disabled=!both;$('#link-playback').disabled=!both;
  applyMix();
}
function applyMix() {
  const gains=sourceGains({hasAudio:!!state.song,hasVideo:hasVideo(),source:state.soundSource,mix:state.mix});
  audio.volume=gains.audio;localVideo.volume=gains.video;youtube.player.setVolume(gains.video);
  $('#mix-value').textContent=!state.song?'Video soundtrack':!hasVideo()?'Uploaded audio':`${Math.round(gains.audio*100)}% uploaded audio`;
  $('#mix').value=Math.round(gains.audio*100);$('#mix').disabled=!state.song||!hasVideo();
}
function playVideo(){
  if(state.videoMode==='local'){localVideo.playbackRate=state.speed;return localVideo.play();}
  youtube.player.setPlaybackRate(state.speed);youtube.player.play();return Promise.resolve();
}
// Sync only the companion. The first media loaded owns the project clock.
function syncVideo(force = false) {
  if(!state.song||!hasVideo()||!$('#link-playback').checked||(!force&&!state.playing))return;
  const videoMaster=state.timeline==='video';
  const target=companionTime(state.time,state.timeline,state.videoOffset);
  const duration=videoMaster?state.song.buffer.duration:getVideoDuration();
  if(target<0||(Number.isFinite(duration)&&duration>0&&target>=duration)){
    if(videoMaster)audio.pause();else pauseVideo();
    $('#video-sync-state').textContent=`${videoMaster?'Uploaded audio':'Video'} ${target<0?'starts later.':'has ended.'}`;return;
  }
  $('#video-sync-state').textContent='';
  if(videoMaster){
    if(force||Math.abs(audio.currentTime-target)>.18)audio.currentTime=target;
    audio.playbackRate=state.speed;
    if(state.playing&&audio.paused)audio.play().catch(()=>{$('#video-sync-state').textContent='Uploaded audio playback was blocked. Press Play again.';});
    if(!state.playing&&!audio.paused)audio.pause();
  }else{
    if(force||Math.abs(getVideoTime()-target)>(state.videoMode==='local'?.18:.65))setVideoTime(target);
    if(state.playing){
      if(state.videoMode==='local'&&localVideo.paused)playVideo().catch(()=>{$('#video-sync-state').textContent='Press play in the video once to allow playback.';});
      else if(state.videoMode==='youtube'&&!youtube.player.isPlaying())playVideo();
    }else if(state.videoMode==='local'?!localVideo.paused:youtube.player.isPlaying())pauseVideo();
  }
}
function pause(){transportGeneration++;audio.pause();state.playing=false;pauseVideo();youtubeAnchor=null;updateTransport();}
async function play(){
  if(!canPlay())return;
  const generation=++transportGeneration;
  if(state.duration&&state.time>=state.duration-.02)seek(0);
  try{
    if(state.timeline==='audio')await audio.play();else await playVideo();
    if(generation!==transportGeneration)return;
    state.playing=state.timeline==='video'&&state.videoMode==='youtube'?youtube.player.isPlaying():true;
    syncVideo(true);updateTransport();
  }catch(error){if(generation===transportGeneration){state.playing=false;notice(`Playback could not start: ${error.message}`,true);updateTransport();}}
}
function seek(time){
  state.time=clamp(time,0,state.duration||0);youtubeAnchor=null;
  if(state.timeline==='audio')audio.currentTime=state.time;else if(hasVideo())setVideoTime(state.time);
  syncVideo(true);updatePlayhead();updateTransport();
}
function updateTransport(){
  $('#play').disabled=!canPlay();$('#seek').disabled=!state.duration;
  $('#play').textContent=state.playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',state.playing?'Pause':'Play');
  $('#duration').textContent=format(state.duration);$('#seek').max=state.duration||1;$('#current-time').textContent=format(state.time);$('#seek').value=state.time;
  $('#loop').classList.toggle('active',state.loop!==null);$('#loop').setAttribute('aria-pressed',String(state.loop!==null));$('#loop').textContent=state.loop===null?'Loop this eight':state.loop<0?'Looping intro':`Looping eight ${state.loop+1}`;
  const source=sourceMedia();
  $('#transcribe').disabled=!source||( !source.media.buffer && $('#transcription-method').value==='local')||Boolean(transcriptionController);
  $('#transcribe').title=source?'Transcribe the soundtrack used for the score':'YouTube does not expose its audio samples. Paste lyrics or optionally add matching audio for transcription.';
  $('#align-video').disabled=!state.song||!state.video||state.videoMode!=='local';$('#align-here').disabled=!state.song||!hasVideo();
}

function firstPhraseIndex(){return -Math.ceil(state.offset/(480/state.bpm));}
function currentPhraseIndex(time){return Math.max(firstPhraseIndex(),Math.min(phraseCount(state.duration,state.bpm,state.offset)-1,Math.floor((time-state.offset+1e-7)/(480/state.bpm))));}
function renderScore() {
  if (!state.duration) {if(canPlay())$('#score').innerHTML='<div class="empty-score"><h2>Your video is ready.</h2><p>Press Play to load its duration and start your eight-count score. No audio upload is required.</p></div>';return;}
  const pickups=state.syllables.filter(cue=>cue.start<state.offset);
  $('#pickup-note').hidden=!pickups.length;$('#pickup-note').textContent=pickups.length?`${pickups.length} pickup syllables appear in the intro rows before your chosen count 1.`:'';
  const count = phraseCount(state.duration, state.bpm, state.offset), first=firstPhraseIndex();
  const cuesByPhrase = new Map(Array.from({length:count-first},(_,i)=>[i+first,[]]));
  state.syllables.forEach((cue, index) => { const phrase = currentPhraseIndex(cue.start); cuesByPhrase.get(phrase)?.push({cue,index}); });
  $('#score').innerHTML = Array.from({length:count-first}, (_, rowIndex) => {
    const index=rowIndex+first;
    const {start,end} = phraseBounds(index,state.bpm,state.offset), duration = end - start;
    const source=sourceMedia(),analysis=source?.media.analysis;
    const waveform=analysis?waveformPath(analysis.peaks,analysis.peakRate,start-source.shift,duration,source.media.buffer.duration):'';
    const laneEnds = [-Infinity,-Infinity,-Infinity];
    const cues = cuesByPhrase.get(index).map(({cue,index:cueIndex}) => {
      const position = (cue.start-start)/duration*100;
      let lane = laneEnds.findIndex(end => end < position);
      if (lane < 0) lane = laneEnds.indexOf(Math.min(...laneEnds));
      laneEnds[lane] = position + Math.max(3, cue.text.length * .95);
      return `<button class="syllable" data-cue="${cueIndex}" style="left:${position}%;top:${145+lane*25}px" title="${escape(cue.text)} · ${cue.start.toFixed(2)}–${cue.end.toFixed(2)}s. Drag to move; double-click to edit." aria-label="${escape(cue.text)} at ${cue.start.toFixed(2)} seconds">${escape(cue.text)}</button>`;
    }).join('');
    const tail = clamp((state.duration - start)/duration * 100,0,100);
    return `<section class="phrase" data-phrase="${index}" aria-label="${index<0?'Intro':'Eight '+(index+1)}"><div class="phrase-heading"><span class="phrase-number">${index<0?'IN':String(index+1).padStart(2,'0')}</span><span>${format(start)} <span class="time-dash">—</span> ${format(Math.min(end,state.duration))}</span><button class="phrase-loop" data-loop="${index}" aria-label="Loop ${index<0?'intro':'eight '+(index+1)}">↻</button></div><div class="phrase-axis" data-axis="${index}"><svg class="waveform" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-label="${waveform?'Audio waveform':'No audio waveform available'}"><path d="${waveform}"/></svg>${!waveform?'<span class="waveform-unavailable">Video-only timing · waveform requires accessible audio</span>':''}<div class="count-axis"></div>${Array.from({length:8},(_,beat)=>`<button class="count-tick" data-time="${start+beat*60/state.bpm}" style="left:${beat*12.5}%" aria-label="Eight ${index<0?'intro':index+1}, count ${beat+1}"><span class="tick"></span>${beat+1}</button><span class="offbeat" style="left:${beat*12.5+6.25}%">&</span>`).join('')}<div class="syllable-layer">${cues}</div>${!cues&&state.syllables.length===0?'<span class="no-syllables">Lyrics will sit here, on the same axis</span>':''}${tail<100?`<div class="track-ended" style="left:${tail}%"></div>`:''}<div class="playhead" hidden><span class="seeking-dot"></span></div></div></section>`;
  }).join('');
  $('#phrase-total').textContent = `${count} eights${state.offset > 0 ? ` · ${state.offset.toFixed(2)}s before count 1` : ''}`;
  $('#score').querySelectorAll('[data-time]').forEach(button => button.onclick = event => { event.stopPropagation(); seek(+button.dataset.time); });
  $('#score').querySelectorAll('[data-axis]').forEach(axis => axis.onclick = event => {
    if (event.target.closest('.syllable,.count-tick')) return;
    const rect = axis.getBoundingClientRect(), {start,end}=phraseBounds(+axis.dataset.axis,state.bpm,state.offset);
    seek(start+clamp((event.clientX-rect.left)/rect.width,0,1)*(end-start));
  });
  $('#score').querySelectorAll('[data-loop]').forEach(button => button.onclick = () => toggleLoop(+button.dataset.loop));
  $('#score').querySelectorAll('[data-cue]').forEach(setupCueDrag);
  state.activePhrase = null; currentCue = -1; updatePlayhead(false); updateTransport();
}
function setupCueDrag(button) {
  button.ondblclick = () => openTimingEditor(+button.dataset.cue);
  button.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') {event.preventDefault();seek(state.syllables[+button.dataset.cue].start);}
  };
  button.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const index=+button.dataset.cue, cue=state.syllables[index], originalStart=cue.start, originalEnd=cue.end, before=snapshot();
    const axis=button.closest('.phrase-axis'), rect=axis.getBoundingClientRect();
    const bounds=phraseBounds(+axis.dataset.axis,state.bpm,state.offset), initialX=event.clientX;
    let moved=false;
    button.setPointerCapture(event.pointerId);
    button.onpointermove = move => {
      if (Math.abs(move.clientX-initialX)>3) moved=true;
      if (!moved) return;
      let start=originalStart+(move.clientX-initialX)/rect.width*(bounds.end-bounds.start);
      if ($('#snap').checked) start=state.offset+Math.round((start-state.offset)/(60/state.bpm/4))*(60/state.bpm/4);
      cue.start=clamp(start,0,Math.max(0,state.duration-(originalEnd-originalStart)));
      cue.end=cue.start+(originalEnd-originalStart);
      button.style.left=`${(cue.start-bounds.start)/(bounds.end-bounds.start)*100}%`;
    };
    const finish = () => {
      button.onpointermove=null;button.onpointerup=null;button.onpointercancel=null;
      if (!moved) seek(cue.start);
      else {remember(before);state.syllables.sort((a,b)=>a.start-b.start);renderScore();}
    };
    button.onpointerup=finish;button.onpointercancel=()=>{cue.start=originalStart;cue.end=originalEnd;button.onpointermove=null;renderScore();};
  };
}
function updatePlayhead(follow = true) {
  if (!state.duration) return;
  const phrase = currentPhraseIndex(state.time);
  if (state.activePhrase !== phrase) {
    const previous = $(`.phrase[data-phrase="${state.activePhrase}"]`);
    if (previous) {previous.classList.remove('active');previous.querySelector('.playhead').hidden=true;previous.querySelectorAll('.count-tick.active').forEach(el=>el.classList.remove('active'));previous.nextElementSibling?.classList.remove('upcoming');}
    state.activePhrase=phrase;
    const row=$(`.phrase[data-phrase="${phrase}"]`);row?.classList.add('active');row?.nextElementSibling?.classList.add('upcoming');
    if (follow && state.playing && $('#follow').checked && row) {
      const rect=row.getBoundingClientRect();if(rect.top<110||rect.bottom>innerHeight-115)row.scrollIntoView({behavior:'smooth',block:'center'});
    }
  }
  const row=$(`.phrase[data-phrase="${phrase}"]`); if(!row)return;
  const {start,end}=phraseBounds(phrase,state.bpm,state.offset);
  const head=row.querySelector('.playhead');head.hidden=false;head.style.left=`${clamp((state.time-start)/(end-start),0,1)*100}%`;
  const beat=Math.floor((state.time-start)/(60/state.bpm));
  row.querySelectorAll('.count-tick').forEach((el,index)=>el.classList.toggle('active',index===beat));
  $('#live-count').textContent=phrase<0?'Intro':`${clamp(beat+1,1,8)} / 8`;
  const cue=state.syllables.findIndex(cue=>state.time>=cue.start&&state.time<cue.end);
  if(cue!==currentCue){$(`.syllable[data-cue="${currentCue}"]`)?.classList.remove('singing');$(`.syllable[data-cue="${cue}"]`)?.classList.add('singing');currentCue=cue;}
}
function toggleLoop(index) {
  state.loop=state.loop===index?null:index;
  if(state.loop!==null)seek(phraseBounds(index,state.bpm,state.offset).start);
  document.querySelectorAll('[data-loop]').forEach(button=>button.classList.toggle('active',+button.dataset.loop===state.loop));updateTransport();
}
async function loadAudio(file,bufferOverride=null){
  const keepVideoTimeline=state.timeline==='video'&&hasVideo();
  if(state.song&&!keepVideoTimeline&&lyricRevision!==savedRevision&&!confirm('Replace the audio track? Export your current timing first if you need it.'))return;
  if(file.size>250*1024*1024){notice('Choose an audio file under 250 MB.',true);return;}
  const generation=++mediaGeneration,videoIdentity=state.videoMode==='youtube'?state.youtube:state.video;
  pause();transcriptionController?.abort();$('#upload').disabled=true;$('#track-detail').textContent='Decoding audio and finding the pulse…';
  try{
    audioContext??=new AudioContext();const buffer=bufferOverride||await audioContext.decodeAudioData(await file.arrayBuffer());
    if(generation!==mediaGeneration)return;
    if(buffer.duration>1800)throw new Error('Choose a track shorter than 30 minutes.');
    await new Promise(resolve=>setTimeout(resolve,20));if(generation!==mediaGeneration)return;
    if(keepVideoTimeline&&videoIdentity!==(state.videoMode==='youtube'?state.youtube:state.video))throw new Error('The video changed during audio loading. Choose the audio again.');
    const analysis=analyzeAudio(buffer),url=URL.createObjectURL(file);
    if(state.song?.url)URL.revokeObjectURL(state.song.url);
    state.song={file,buffer,analysis,url};audio.src=url;audio.playbackRate=state.speed;
    if(!keepVideoTimeline){
      state.timeline='audio';state.duration=buffer.duration;state.bpm=analysis.bpm||120;state.offset=clamp(analysis.offset||0,0,Math.max(0,buffer.duration-.1));state.time=0;state.syllables=[];state.loop=null;resetHistory();$('#lyrics-text').value='';
      state.videoOffset=0;$('#video-offset').value=0;state.soundSource='audio';$('#bpm').value=state.bpm;$('#first-count').value=state.offset.toFixed(3);
    }
    $('#alignment-status').textContent='';$('#transcription-status').hidden=true;
    refreshMediaUI();renderScore();seek(state.time);
    notice(keepVideoTimeline?'Optional audio added. Video playback and your timing are preserved; align the tracks if needed.':'Audio loaded. Use it alone or add a video.');
  }catch(error){if(generation===mediaGeneration){notice(`Could not analyze this audio. ${error.message} Try MP3 or WAV.`,true);refreshMediaUI();}}
  finally{if(generation===mediaGeneration)$('#upload').disabled=false;updateTransport();}
}
async function loadVideo(file){
  if(file.size>500*1024*1024){notice('Choose a video under 500 MB.',true);return;}
  const generation=++videoGeneration,previousMode=state.videoMode;mediaGeneration++;$('#upload').disabled=false;pause();transcriptionController?.abort();
  const previous=state.video,url=URL.createObjectURL(file),video={file,url,buffer:null,analysis:null};
  state.video=video;state.videoMode='local';showVideoTab('local');localVideo.hidden=false;$('#video-file-name').textContent=file.name;
  try{
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);localVideo.removeEventListener('loadedmetadata',ready);localVideo.removeEventListener('error',fail);};
      const ready=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('This video format is not supported by your browser.'));};
      const timer=setTimeout(()=>{cleanup();reject(new Error('Video metadata could not load. Try MP4 or WebM.'));},15000);
      localVideo.addEventListener('loadedmetadata',ready,{once:true});localVideo.addEventListener('error',fail,{once:true});localVideo.src=url;
    });
    if(generation!==videoGeneration)return;
    if(!Number.isFinite(localVideo.duration)||localVideo.duration<=0||localVideo.duration>1800)throw new Error('Choose a video with a duration under 30 minutes.');
    if(previous?.url)URL.revokeObjectURL(previous.url);
    state.videoOffset=0;$('#video-offset').value=0;state.soundSource='video';
    if(state.timeline!=='audio'||!state.song)resetVideoTimeline();
    refreshMediaUI();renderScore();syncVideo(true);updateTransport();
    $('#video-file-name').textContent=`${file.name} · ready to play; analyzing its soundtrack…`;
    const revision=lyricRevision;
    try{
      audioContext??=new AudioContext();video.buffer=await audioContext.decodeAudioData(await file.arrayBuffer());
      if(generation!==videoGeneration)return;
      video.analysis=analyzeAudio(video.buffer);
      if(state.timeline==='video'&&state.videoMode==='local'&&lyricRevision===revision){state.bpm=video.analysis.bpm;state.offset=clamp(video.analysis.offset||0,0,Math.max(0,state.duration-.1));$('#bpm').value=state.bpm;$('#first-count').value=state.offset.toFixed(3);}
      $('#video-file-name').textContent=`${file.name} · soundtrack analyzed; no separate audio needed`;
      refreshMediaUI();renderScore();updateTransport();
    }catch(error){if(generation===videoGeneration){$('#video-file-name').textContent=`${file.name} · video playback works, but its audio could not be decoded for analysis. Tap tempo and paste lyrics, or add optional audio.`;updateTransport();}}
  }catch(error){if(generation!==videoGeneration)return;URL.revokeObjectURL(url);state.video=previous||null;state.videoMode=previousMode;if(previous)localVideo.src=previous.url;showVideoTab(previousMode);notice(error.message,true);refreshMediaUI();updateTransport();}
}
function setVideoMode(mode){
  showVideoTab(mode);
  if(mode===state.videoMode||!(mode==='local'?state.video:state.youtube))return;
  pause();state.videoMode=mode;state.videoOffset=0;$('#video-offset').value=0;
  if(state.timeline==='video')resetVideoTimeline();
  refreshMediaUI();renderScore();updateTransport();
}

function updateTempo(){
 const bpm=clamp(Number($('#bpm').value)||120,40,240);
 const offset=clamp(Number($('#first-count').value)||0,0,Math.max(0,state.duration-.05));
 $('#bpm').value=bpm;$('#first-count').value=offset.toFixed(3);
 if(Math.abs(bpm-state.bpm)<.0001&&Math.abs(offset-state.offset)<.0001)return;
 remember();state.bpm=bpm;state.offset=offset;state.loop=null;renderScore();
}
function cueRow(cue,index){return `<div class="cue-row" data-index="${index}"><input type="number" step="0.01" min="0" aria-label="Syllable ${index+1} start" value="${cue.start.toFixed(3)}"><input type="number" step="0.01" min="0" aria-label="Syllable ${index+1} end" value="${cue.end.toFixed(3)}"><input type="text" maxlength="200" aria-label="Syllable ${index+1} text" value="${escape(cue.text)}"><button type="button" class="delete-cue" aria-label="Delete syllable ${index+1}">×</button></div>`;}
function openTimingEditor(index){
  $('#timing-error').textContent='';$('#timing-editor').innerHTML=state.syllables.map(cueRow).join('');$('#timing-dialog').showModal();
  if(index!==undefined)$('#timing-editor').children[index]?.scrollIntoView({block:'center'});
}
$('#timing-editor').onclick=event=>{if(event.target.closest('.delete-cue'))event.target.closest('.cue-row').remove();};
$('#add-cue').onclick=()=>{if(!state.duration){$('#timing-error').textContent='Load audio or a video first.';return;}const start=Math.min(state.time,state.duration-.05);$('#timing-editor').insertAdjacentHTML('beforeend',cueRow({start,end:Math.min(state.duration,start+.3),text:''},$('#timing-editor').children.length));};
$('#save-cues').onclick=()=>{
  try{
    const syllables=Array.from($('#timing-editor').children).map(row=>({start:Number(row.children[0].value),end:Number(row.children[1].value),text:row.children[2].value.trim()}));
    const validated=validateProject({version:1,bpm:state.bpm,offset:state.offset,syllables},state.duration).syllables;remember();state.syllables=validated;
    $('#timing-dialog').close();renderScore();notice('Syllable timing saved. Export timing to keep a copy.');
  }catch(error){$('#timing-error').textContent=error.message;}
};
$('#choose-video').onclick=()=>{$('.video-card').scrollIntoView({behavior:'smooth',block:'start'});if(!$('#youtube').hidden)$('[aria-label="YouTube video link"]').focus({preventScroll:true});};
$('#sound-source').onchange=event=>{state.soundSource=event.target.value;if(state.soundSource==='mix'&&(state.mix===0||state.mix===100))state.mix=50;applyMix();};
$('#remove-audio').onclick=()=>removeAudio();
$('#transcription-method').onchange=updateTransport;
$('#upload').onclick=()=>$('#audio-file').click();$('#audio-file').onchange=event=>{if(event.target.files[0])loadAudio(event.target.files[0]);event.target.value='';};
$('#video-file').onchange=event=>{if(event.target.files[0])loadVideo(event.target.files[0]);event.target.value='';};
$('#play').onclick=()=>state.playing?pause():play();$('#restart').onclick=()=>seek(0);$('#seek').oninput=event=>seek(Number(event.target.value));
$('#bpm').onchange=updateTempo;$('#first-count').onchange=updateTempo;$('#set-first').onclick=()=>{$('#first-count').value=state.time.toFixed(3);updateTempo();};
$('#half-tempo').onclick=()=>{$('#bpm').value=state.bpm/2;updateTempo();};$('#double-tempo').onclick=()=>{$('#bpm').value=state.bpm*2;updateTempo();};
$('#tap-tempo').onclick=()=>{const now=performance.now();if(taps.length&&now-taps.at(-1)>2000)taps=[];taps.push(now);taps=taps.slice(-8);if(taps.length>2){$('#bpm').value=(60000/((taps.at(-1)-taps[0])/(taps.length-1))).toFixed(1);updateTempo();}else notice('Keep tapping with the beat…');};
$('#speed').onchange=event=>{state.speed=Number(event.target.value);audio.playbackRate=state.speed;localVideo.playbackRate=state.speed;youtube.player.setPlaybackRate(state.speed);youtubeAnchor=null;syncVideo(true);};
$('#loop').onclick=()=>{if(state.duration)toggleLoop(currentPhraseIndex(state.time));};
$('#tab-youtube').onclick=()=>setVideoMode('youtube');$('#tab-local').onclick=()=>setVideoMode('local');
$('#video-offset').onchange=event=>{remember();state.videoOffset=clamp(Number(event.target.value)||0,-3600,3600);event.target.value=state.videoOffset;renderScore();syncVideo(true);};
$('#mix').oninput=event=>{state.mix=Number(event.target.value);state.soundSource='mix';$('#sound-source').value='mix';applyMix();};
$('#align-here').onclick=()=>{remember();state.videoOffset=getVideoTime()-audio.currentTime;$('#video-offset').value=state.videoOffset.toFixed(3);renderScore();syncVideo(true);notice('Current video frame aligned with the song playhead.');};
$('#align-video').onclick=async()=>{
  if(!state.song||!state.video)return;
  const song=state.song, video=state.video;
  $('#align-video').disabled=true;$('#alignment-status').textContent='Comparing the two audio tracks…';
  try{
    audioContext??=new AudioContext();
    if(!video.analysis)video.analysis=analyzeAudio(await audioContext.decodeAudioData(await video.file.arrayBuffer()));
    await new Promise(resolve=>setTimeout(resolve,20));
    const result=alignAudio(song.analysis,video.analysis);
    if(song!==state.song||video!==state.video)return;
    if(result.confidence<.3){$('#alignment-status').textContent='No confident audio match. Adjust the offset manually or align the current frames.';return;}
    remember();state.videoOffset=result.offset;$('#video-offset').value=result.offset.toFixed(3);renderScore();syncVideo(true);
    $('#alignment-status').textContent=`Aligned at ${result.offset.toFixed(2)}s (estimated from the audio). Listen and fine-tune if needed.`;
  }catch(error){$('#alignment-status').textContent='Could not decode this video’s audio. Use manual offset or convert the video to MP4 with AAC audio.';}
  finally{updateTransport();}
};
$('#place-lyrics').onclick=()=>{
  if(!state.duration){notice('Open a song or load a YouTube video first.',true);return;}
  try{const cues=wordsToSyllables(parseTimedLyrics($('#lyrics-text').value,state.duration));if(!cues.length)throw new Error('Paste some lyrics first.');proposeLyrics(cues,'Pasted lyrics');}catch(error){notice(error.message,true);}
};
$('#lyrics-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;if(file.size>1024*1024){notice('Choose a lyric file smaller than 1 MB.',true);return;}$('#lyrics-text').value=await file.text();$('#place-lyrics').click();event.target.value='';};
$('#edit-timing').onclick=()=>openTimingEditor();
$('#transcribe').onclick=async()=>{
  const transcriptionSource=sourceMedia();if(!transcriptionSource||transcriptionController)return;
  const song=transcriptionSource.media, timeShift=transcriptionSource.shift, controller=new AbortController();transcriptionController=controller;$('#cancel-transcription').hidden=false;$('#transcription-status').hidden=false;$('#transcription-status').textContent='Preparing audio for local transcription…';updateTransport();
  try{
    let words;
    if($('#transcription-method').value==='backend'){
      if(song.file.size>25000000)throw new Error('Hosted transcription accepts files up to 25 MB. Choose a shorter/compressed file or use local mode.');
      $('#transcription-status').textContent='Uploading audio to your backend for hosted transcription…';
      const result=await backendRequest($('#backend-url').value.trim(),'/api/transcribe',{method:'POST',token:$('#backend-token').value,key:$('#personal-key').value,body:song.file,signal:controller.signal,headers:{'Content-Type':song.file.type||'application/octet-stream','X-File-Name':encodeURIComponent(song.file.name)}});words=result.words;
      if(!Array.isArray(words))throw new Error('Backend did not return timed words.');
    }else{
      words=await transcribeAudio(resampleMono(song.buffer,16000),{signal:controller.signal,onProgress:progress=>{if(song===sourceMedia()?.media)$('#transcription-status').textContent=progress.message||`Transcribing… ${progress.progress?Math.round(progress.progress)+'%':''}`;}});
    }
    if(song!==sourceMedia()?.media||timeShift!==sourceMedia()?.shift)return;
    const cues=shiftCues(wordsToSyllables(words),timeShift,state.duration);
    if(cues.length)proposeLyrics(cues,'Automatic transcription');
    $('#transcription-status').textContent=cues.length?'Transcription complete. Review the suggestion before applying it.':'No words detected. Try pasting lyrics manually or use a clearer vocal track.';
  }catch(error){if(song===sourceMedia()?.media)$('#transcription-status').textContent=controller.signal.aborted?'Transcription cancelled.':`Transcription unavailable: ${error.message} You can still paste and time lyrics manually.`;}
  finally{if(transcriptionController===controller){transcriptionController=null;$('#cancel-transcription').hidden=true;}updateTransport();}
};
$('#cancel-transcription').onclick=()=>transcriptionController?.abort();
$('#export').onclick=()=>{
  if(!state.duration){notice('Load media and add timing first.',true);return;}
  const project={version:1,track:state.timeline==='audio'?state.song?.file.name:state.videoMode==='local'?state.video?.file.name:state.youtube?.title,duration:state.duration,bpm:state.bpm,offset:state.offset,syllables:state.syllables,videoOffset:state.videoOffset,mix:state.mix,timeline:state.timeline,soundSource:state.soundSource,youtubeId:state.youtube?.id||null};
  const url=URL.createObjectURL(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='musicality-timing.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);savedRevision=lyricRevision;refreshHistory();notice('Timing exported. Media files and API keys are not included.');
};
$('#import').onclick=()=>$('#project-file').click();$('#project-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
    if(!state.duration)throw new Error('Open the matching audio or video first, then import its timing.');
    if(file.size>5*1024*1024)throw new Error('Timing files must be smaller than 5 MB.');
    const project=JSON.parse(await file.text());if(project.timeline&&project.timeline!==state.timeline)throw new Error('This timing file follows a different source. Open its video or audio first, then add the optional companion and import again.');const data=validateProject(project,state.duration);
    remember();Object.assign(state,data);state.videoOffset=Number.isFinite(project.videoOffset)?clamp(project.videoOffset,-3600,3600):0;state.mix=Number.isFinite(project.mix)?clamp(project.mix,0,100):100;state.soundSource=['video','audio','mix'].includes(project.soundSource)?project.soundSource:'mix';state.loop=null;
    $('#bpm').value=state.bpm;$('#first-count').value=state.offset;$('#video-offset').value=state.videoOffset;$('#mix').value=state.mix;renderScore();refreshMediaUI();syncVideo(true);notice('Timing imported for the current media.');
  }catch(error){notice(`Could not import timing: ${error.message}`,true);}event.target.value='';
};
$('#try-example').onclick=async()=>{
  audioContext??=new AudioContext();const rate=22050,duration=24, samples=new Float32Array(rate*duration);
  for(let beat=0;beat<48;beat++){const start=Math.round(beat*.5*rate);for(let i=0;i<rate*.12;i++){const time=i/rate;samples[start+i]+=.65*Math.exp(-time*38)*Math.sin(2*Math.PI*(beat%8===0?110:220)*time);}}
  const data=new ArrayBuffer(44+samples.length*2),view=new DataView(data);const text=(offset,value)=>[...value].forEach((char,i)=>view.setUint8(offset+i,char.charCodeAt(0)));
  text(0,'RIFF');view.setUint32(4,data.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);samples.forEach((sample,index)=>view.setInt16(44+index*2,clamp(sample,-1,1)*32767,true));
  await loadAudio(new File([data],'Practice rhythm.wav',{type:'audio/wav'}));
};
function onPrimaryEnded(){
  if(state.loop!==null){seek(phraseBounds(state.loop,state.bpm,state.offset).start);play();}
  else{state.playing=false;state.time=state.duration;audio.pause();pauseVideo();updateTransport();}
}
audio.onended=()=>{if(state.timeline==='audio')onPrimaryEnded();};
for(const event of ['play','pause','waiting','playing','seeked'])audio.addEventListener(event,()=>{
  if(state.timeline!=='audio')return;state.playing=event!=='waiting'&&!audio.paused&&!audio.ended;state.time=audio.currentTime||0;syncVideo(true);updateTransport();
});
audio.onerror=()=>{if(state.song)notice('Uploaded audio playback failed. You can still use the video soundtrack.',true);};
for(const event of ['play','pause','waiting','playing','seeked'])localVideo.addEventListener(event,()=>{
  if(!primaryVideo()||state.videoMode!=='local')return;
  state.playing=event!=='waiting'&&!localVideo.paused&&!localVideo.ended;state.time=localVideo.currentTime||0;syncVideo(true);updateTransport();
});
localVideo.addEventListener('ended',()=>{if(primaryVideo()&&state.videoMode==='local')onPrimaryEnded();});
document.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)&&!$('dialog[open]')){event.preventDefault();state.playing?pause():play();}});
function tick(now){
  if(state.timeline==='audio'&&state.song)state.time=audio.currentTime||0;
  else if(primaryVideo()){
    if(state.videoMode==='local')state.time=localVideo.currentTime||0;
    else{
      // Interpolate between IFrame API samples for a smooth dot, but only
      // while YouTube confirms playback. Buffering/pausing never free-runs.
      if(now-lastYoutubePoll>100||!youtubeAnchor){youtubeAnchor={time:youtube.player.getCurrentTime()||0,at:now};lastYoutubePoll=now;refreshVideoDuration();}
      state.time=Math.min(state.duration||Infinity,youtubeAnchor.time+(state.playing?(now-youtubeAnchor.at)/1000*state.speed:0));
    }
  }
  if(state.playing&&state.loop!==null){const bounds=phraseBounds(state.loop,state.bpm,state.offset);if(state.time>=Math.min(bounds.end,state.duration)-.025||state.time<bounds.start-.1)seek(bounds.start);}
  if(state.duration){updatePlayhead();$('#seek').value=state.time;$('#current-time').textContent=format(state.time);}
  if(now-lastVideoSync>700){syncVideo();lastVideoSync=now;}
  requestAnimationFrame(tick);
}
function removeAudio(){
  if(!state.song)return;
  if(!hasVideo()&&lyricRevision!==savedRevision&&!confirm('Remove the only media source? Export timing first to keep it.'))return;
  pause();mediaGeneration++;transcriptionController?.abort();
  const previous=state.song;state.song=null;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(previous.url);
  if(hasVideo()){
    if(state.timeline==='audio'){
      const shift=state.videoOffset;state.timeline='video';state.duration=getVideoDuration()||0;state.time=clamp(state.time+shift,0,state.duration);
      state.syllables=shiftCues(state.syllables,shift,state.duration);state.offset=clamp(state.offset+shift,0,Math.max(0,state.duration-.05));$('#first-count').value=state.offset;state.loop=null;resetHistory();lyricRevision++;refreshHistory();
    }
    state.soundSource='video';state.videoOffset=0;$('#video-offset').value=0;refreshMediaUI();renderScore();seek(state.time);
  }else{state.timeline=null;state.duration=0;state.time=0;state.syllables=[];state.loop=null;resetHistory();$('#score').innerHTML='<div class="empty-score"><h2>Choose a video or audio to begin.</h2><p>Use the buttons above. A separate audio file is optional.</p></div>';refreshMediaUI();}
  updateTransport();notice(hasVideo()?'Uploaded audio removed. The video soundtrack is active.':'Audio removed. Choose a video or another audio file.');
}

document.body.classList.add('mode-correct');
updateTransport();refreshMediaUI();requestAnimationFrame(tick);

function snapshot(){return {bpm:state.bpm,offset:state.offset,videoOffset:state.videoOffset,syllables:state.syllables.map(cue=>({...cue}))};}
function refreshHistory(){ $('#undo').disabled=!undoStack.length;$('#redo').disabled=!redoStack.length;$('#edit-state').textContent=lyricRevision===savedRevision?'Timing saved or unchanged':'Changes can be undone · export to save'; }
function remember(before=snapshot()){undoStack.push(before);if(undoStack.length>30)undoStack.shift();redoStack.length=0;lyricRevision++;refreshHistory();}
function resetHistory(){undoStack.length=0;redoStack.length=0;pendingLyrics=null;lyricRevision++;savedRevision=lyricRevision;refreshHistory();}
function restore(data){Object.assign(state,data);state.loop=null;$('#bpm').value=state.bpm;$('#first-count').value=state.offset;$('#video-offset').value=state.videoOffset;lyricRevision++;renderScore();syncVideo(true);refreshHistory();}
$('#undo').onclick=()=>{if(!undoStack.length)return;redoStack.push(snapshot());restore(undoStack.pop());};
$('#redo').onclick=()=>{if(!redoStack.length)return;undoStack.push(snapshot());restore(redoStack.pop());};
$('#phase-back').onclick=()=>{$('#first-count').value=Math.max(0,state.offset-60/state.bpm);updateTempo();};
$('#phase-forward').onclick=()=>{$('#first-count').value=state.offset+60/state.bpm;updateTempo();};
$('#link-playback').onchange=()=>syncVideo(true);
function proposeLyrics(cues,source){
 const validated=validateProject({version:1,bpm:state.bpm,offset:state.offset,syllables:cues},state.duration).syllables;
 pendingLyrics={cues:validated,source,song:state.song,video:state.video,youtube:state.youtube,revision:lyricRevision};
 $('#review-summary').textContent=`${source}: ${validated.length} suggested syllables. ${state.syllables.length} current syllables will be replaced if you apply.`;
 const list=items=>items.length?items.map(cue=>`<div class="review-cue"><span>${cue.start.toFixed(2)}s</span> ${escape(cue.text)}</div>`).join(''):'<p class="help">No lyrics yet</p>';
 $('#review-current').innerHTML=list(state.syllables);$('#review-proposed').innerHTML=list(validated);$('#review-dialog').showModal();
}
$('#apply-suggestion').onclick=()=>{
 if(!pendingLyrics)return;
 if(pendingLyrics.song!==state.song||pendingLyrics.video!==state.video||pendingLyrics.youtube!==state.youtube||pendingLyrics.revision!==lyricRevision){$('#review-dialog').close();notice('The project changed while this suggestion was open. Generate or place it again to review against your latest edits.',true);return;}
 remember();state.syllables=pendingLyrics.cues;pendingLyrics=null;$('#review-dialog').close();renderScore();notice('Suggestion applied. Listen and adjust; Undo restores your previous timing.');
};
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{
 const mode=button.dataset.mode;document.body.classList.remove('mode-learn','mode-align','mode-correct');document.body.classList.add(`mode-${mode}`);
 document.querySelectorAll('[data-mode]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));});
 $('#mode-description').textContent={learn:'Focus on the next eight. Repeat until it feels right.',align:'Match the music to the movement.',correct:'See the detail. Fix what you hear.'}[mode];
 if(mode==='align')notice('Pause and turn off Link video and audio to choose matching frames, then Align current frames.');
});
$('#test-backend').onclick=async()=>{try{const result=await backendRequest($('#backend-url').value.trim(),'/api/health');if(!result.ok)throw new Error('Unexpected health response.');$('#backend-status').textContent='Backend reachable. Transcription/search will verify your keys when used.';}catch(error){$('#backend-status').textContent=error.message;}};
$('#clear-keys').onclick=()=>{$('#backend-token').value='';$('#personal-key').value='';$('#typesafe-key').value='';const google=$('[aria-label="YouTube Data API key"]');if(google)google.value='';$('#backend-status').textContent='Keys cleared from this page.';};
window.addEventListener('beforeunload',event=>{if(state.duration && lyricRevision!==savedRevision){event.preventDefault();event.returnValue='';}});

$('#jump-lyrics').onclick=()=>{document.querySelector('[data-mode="correct"]').click();$('.lyrics-tools').scrollIntoView({behavior:'smooth',block:'center'});$('#lyrics-text').focus({preventScroll:true});};
$('#jev-review').onclick=async()=>{
 if(!state.duration){$('#jev-status').textContent='Load your audio or video first.';return;}
 $('#jev-review').disabled=true;$('#jev-status').textContent='Requesting one review suggestion…';
 try{
  const metrics={hasAudio:!!sourceMedia()?.media.buffer,hasVideo:hasVideo(),bpm:state.bpm,syllableCount:state.syllables.length,beatConfidence:sourceMedia()?.media.analysis?.confidence||0,note:$('#review-note').value};
  const result=await backendRequest($('#backend-url').value.trim(),'/api/review',{method:'POST',token:$('#backend-token').value,key:$('#typesafe-key').value,body:JSON.stringify(metrics),headers:{'Content-Type':'application/json'}});
  $('#jev-status').textContent=`Suggestion: ${result.suggestion} This is guidance from metadata, not an assessment of the audio.`;
 }catch(error){$('#jev-status').textContent=error.message;}
 finally{$('#jev-review').disabled=false;}
};
