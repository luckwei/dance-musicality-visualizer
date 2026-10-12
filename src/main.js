import './style.css';
const state = { time: 0, playing: false, bpm: 108, grouping: 8, layout: 'stacked', lyricStyle: 'bounce', video: true, mix: 75, duration: 48, tab: 'preview', zoom: 1 };
const lyrics = [
  {time:0,text:'Feel the rhythm in your heartbeat'},
  {time:6,text:'Let it carry you away'},
  {time:12,text:'Every step becomes a story'},
  {time:18,text:'Every move has something to say'},
  {time:24,text:'When the lights come down around us'},
  {time:30,text:'We can find our own way home'},
  {time:36,text:'Keep on dancing through the silence'},
  {time:42,text:'You will never dance alone'},
];
const icon = {play:'▶',pause:'Ⅱ',wave:'≋',video:'▻',music:'♫'};
const format = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2,'0')}`;
document.querySelector('#app').innerHTML = `
<aside class="sidebar"><a class="brand" href="#">m<span>•</span></a><button class="nav-icon selected" title="Studio">≋</button><button class="nav-icon" id="library" title="About this prototype">▦</button><div class="sidebar-bottom">M</div></aside>
<div class="shell"><header><div class="breadcrumb">Workspace <span>/</span> <strong>Untitled session</strong><span class="tag">PROTOTYPE</span></div><button class="button subtle" id="reset">↺ Reset design</button></header>
<main><div class="heading"><div><div class="eyebrow">MAKE THE MUSIC VISIBLE</div><h1>Find your rhythm<span>.</span></h1><p>A space to hear, see, and feel every moment.</p></div><button class="button primary" id="upload">＋ Add your music</button><input type="file" id="file" accept="audio/*" hidden></div>
<div class="workspace"><section class="studio"><div class="session-bar"><div class="album">♫</div><div><h2 id="song-title">Feel the rhythm</h2><p id="song-subtitle">Sample session · 108 BPM · 4/4</p></div><span class="demo-pill">Sample content</span></div>
<div class="canvas stacked" id="canvas"><section class="panel waveform-panel"><div class="panel-title"><span><i>01</i> Audio waveform</span><span class="small">CLICK TO SEEK</span></div><div class="wave-container" id="wave-container"><canvas id="wave"></canvas><div class="playhead" id="playhead"><span></span></div></div><div class="time-ruler"><span>0:00</span><span>0:12</span><span>0:24</span><span>0:36</span><span>0:48</span></div></section>
<section class="panel counts-panel"><div class="panel-title"><span><i>02</i> Dance counts</span><span class="small" id="phrase">PHRASE 01</span></div><div class="counts" id="counts"></div><div class="count-footer"><span id="bar">Bar 1 · Beat 1</span><span class="small">FOLLOW THE PULSE</span></div></section>
<section class="panel lyrics-panel"><div class="panel-title"><span><i>03</i> Lyrics</span><button class="text-button" id="edit-lyrics">Edit timing ↗</button></div><div class="lyric-stage" id="lyric-stage"></div><div class="lyric-hint">Sample lyrics and timing · tap a word to seek</div></section>
<section class="panel video-panel" id="video-panel"><div class="panel-title"><span><i>04</i> Choreography</span><span class="small">OPTIONAL</span></div><div class="video-placeholder"><div class="dance-grid"></div><div class="dancer">✧</div><div class="video-copy"><button class="round-button" id="add-video">＋</button><strong>Add a choreography video</strong><span>See your movement alongside the music</span></div><span class="video-label">VIDEO PLACEHOLDER</span></div><div class="video-bottom"><span>↔ Audio alignment</span><label><input id="offset" type="number" value="0" step="0.1"> s</label></div></section></div>
<div class="transport"><button class="transport-icon" id="restart" aria-label="Restart">↤</button><button class="play-button" id="play" aria-label="Play">▶</button><span class="clock" id="clock">0:00 <span>/ 0:48</span></span><input type="range" id="seek" min="0" max="48" step="0.01" value="0" aria-label="Seek"><select id="speed" aria-label="Playback speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select><button class="transport-icon" id="sound" aria-label="Toggle demo metronome" title="Toggle demo metronome">♪</button></div><p class="prototype-note">Interactive wireframe · playback animates sample data; audio is a demo metronome.</p></section>
<aside class="design-panel"><div class="design-header"><span class="design-icon">⌘</span><div><h2>Shape the experience</h2><p>Try a different way to feel it.</p></div></div><div class="config-section"><h3>Layout</h3><div class="layout-options"><button class="layout-choice active" data-layout="stacked"><div class="layout-sketch stacked-sketch"><i></i><i></i><i></i></div>Stacked</button><button class="layout-choice" data-layout="split"><div class="layout-sketch split-sketch"><i></i><i></i><i></i></div>Side by side</button></div><p class="helper">Keep everything in one flow, or give video its own space.</p></div>
<div class="config-section"><h3>Count in</h3><div class="segmented"><button data-group="4">4 counts</button><button data-group="8" class="active">8 counts</button></div><label class="field-label">Tempo <span><input id="bpm" type="number" min="40" max="240" value="108"> BPM</span></label><p class="helper">Adjust the estimate to match what you hear.</p></div>
<div class="config-section"><h3>Lyric highlighting</h3><div class="style-options"><button class="style-choice active" data-style="bounce"><span>●</span><div><strong>Bouncing dot</strong><small>A playful guide, word by word</small></div><span class="radio"></span></button><button class="style-choice" data-style="fill"><span>▰</span><div><strong>Karaoke fill</strong><small>Color follows each word</small></div><span class="radio"></span></button><button class="style-choice" data-style="line"><span>≡</span><div><strong>Whole line</strong><small>A calmer, simpler focus</small></div><span class="radio"></span></button></div></div>
<div class="config-section"><label class="toggle-label"><span><strong>Show choreography</strong><small>Make room for movement</small></span><input type="checkbox" id="video-toggle" checked><span class="toggle"></span></label><div id="mix-controls"><label class="field-label">Audio balance <span id="mix-value">75% music</span></label><input id="mix" type="range" min="0" max="100" value="75"><div class="range-labels"><span>Video audio</span><span>Song audio</span></div><p class="helper">Preview the control. No video audio is loaded.</p></div></div><div class="design-tip"><span>✧</span><p>Start with the feeling.<br>Fine-tune the details later.</p></div></aside></div>
</main><footer><span>MUSICALITY STUDIO</span><span>Made for the moments between the beats.</span></footer></div><div id="toast" role="status"></div>
<dialog id="lyric-dialog"><form method="dialog"><div class="dialog-header"><h2>Edit lyrics & timing</h2><button class="button" value="cancel">✕</button></div><p>Start time in seconds. Words are evenly spaced within each line for this prototype.</p><div id="lyric-editor"></div><div class="dialog-actions"><button class="button" value="cancel">Cancel</button><button type="button" class="button primary" id="save-lyrics">Save changes</button></div><p id="lyric-error" role="alert"></p></form></dialog>`;
let sound = false, audioContext, lastBeat = -1;
function toast(message) {const t=document.querySelector('#toast'); t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),4500);}
function renderCounts() {document.querySelector('#counts').innerHTML=Array.from({length:state.grouping},(_,i)=>`<button class="count" data-count="${i}" aria-label="Seek to count ${i+1}">${i+1}<span></span></button>`).join('');document.querySelectorAll('.count').forEach(el=>el.onclick=()=>{const phrase=Math.floor(state.time/(60/state.bpm*state.grouping));state.time=Math.min(state.duration, (phrase*state.grouping+Number(el.dataset.count))*60/state.bpm);update();});}
function renderLyrics() {
 const index=Math.min(lyrics.length-1,Math.max(0,lyrics.findLastIndex(l=>state.time>=l.time)));
 const line=lyrics[index], end=lyrics[index+1]?.time??state.duration;
 const words=line.text.split(/\s+/), active=Math.min(words.length-1,Math.floor((state.time-line.time)/Math.max(.01,end-line.time)*words.length));
 const stage=document.querySelector('#lyric-stage');stage.className=`lyric-stage ${state.lyricStyle}`;
 stage.innerHTML=`<div class="previous-line">${escapeHTML(lyrics[index-1]?.text||'Let the music lead you')}</div><div class="current-line">${words.map((word,i)=>`<button class="word ${i===active?'current':''} ${i<=active?'past':''}" data-word="${i}">${escapeHTML(word)}<span class="bouncing-dot"></span></button>`).join(' ')}</div><div class="next-line">${escapeHTML(lyrics[index+1]?.text||'Feel it. Make it yours.')}</div>`;
 stage.querySelectorAll('.word').forEach(el=>el.onclick=()=>{state.time=line.time+Number(el.dataset.word)*(end-line.time)/words.length;update();});
}
function escapeHTML(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function drawWave() {
 const canvas=document.querySelector('#wave'),rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;
 canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);
 for(let x=0;x<rect.width;x+=5){const seed=Math.sin(x*1.73)*.5+.5;const shape=.22+.6*Math.abs(Math.sin(x*.014))+.2*Math.sin(x*.08);const h=8+seed*shape*(rect.height-20);c.fillStyle=x/rect.width<=state.time/state.duration?'#c5603e':'#d6cabe';c.beginPath();c.roundRect(x,(rect.height-h)/2,3,h,2);c.fill();}
 document.querySelector('#playhead').style.left=`${state.time/state.duration*100}%`;
}
function update(){
 const beat=Math.floor(state.time*state.bpm/60), count=beat%state.grouping;
 document.querySelectorAll('.count').forEach((el,i)=>{el.classList.toggle('active',i===count);el.classList.toggle('passed',i<count);});
 document.querySelector('#phrase').textContent=`PHRASE ${String(Math.floor(beat/state.grouping)+1).padStart(2,'0')}`;
 document.querySelector('#bar').textContent=`Bar ${Math.floor(beat/4)+1} · Beat ${beat%4+1}`;
 document.querySelector('#clock').innerHTML=`${format(state.time)} <span>/ ${format(state.duration)}</span>`;
 document.querySelector('#seek').value=state.time;document.querySelector('#play').textContent=state.playing?icon.pause:icon.play;document.querySelector('#play').setAttribute('aria-label',state.playing?'Pause':'Play');
 renderLyrics();drawWave();
 if(sound&&state.playing&&beat!==lastBeat){lastBeat=beat;audioContext??=new AudioContext();const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.frequency.value=count===0?880:580;gain.gain.setValueAtTime(.05,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.07);osc.connect(gain).connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.08);}
}
renderCounts();update();
document.querySelector('#play').onclick=()=>{if(state.time>=state.duration)state.time=0;state.playing=!state.playing;update();};
document.querySelector('#restart').onclick=()=>{state.time=0;update();};
document.querySelector('#seek').oninput=e=>{state.time=+e.target.value;update();};
document.querySelector('#wave-container').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();state.time=Math.max(0,Math.min(state.duration,(e.clientX-r.left)/r.width*state.duration));update();};
document.querySelectorAll('[data-layout]').forEach(el=>el.onclick=()=>{state.layout=el.dataset.layout;document.querySelector('#canvas').className=`canvas ${state.layout}`;document.querySelectorAll('[data-layout]').forEach(b=>b.classList.toggle('active',b===el));drawWave();});
document.querySelectorAll('[data-group]').forEach(el=>el.onclick=()=>{state.grouping=+el.dataset.group;document.querySelectorAll('[data-group]').forEach(b=>b.classList.toggle('active',b===el));renderCounts();update();});
document.querySelectorAll('[data-style]').forEach(el=>el.onclick=()=>{state.lyricStyle=el.dataset.style;document.querySelectorAll('[data-style]').forEach(b=>b.classList.toggle('active',b===el));renderLyrics();});
document.querySelector('#bpm').onchange=e=>{state.bpm=Math.max(40,Math.min(240,+e.target.value||108));e.target.value=state.bpm;document.querySelector('#song-subtitle').textContent=`Sample session · ${state.bpm} BPM · 4/4`;update();};
document.querySelector('#video-toggle').onchange=e=>{state.video=e.target.checked;document.querySelector('#video-panel').hidden=!state.video;document.querySelector('#mix-controls').hidden=!state.video;document.querySelector('#canvas').classList.toggle('no-video',!state.video);drawWave();};
document.querySelector('#mix').oninput=e=>{state.mix=+e.target.value;document.querySelector('#mix-value').textContent=`${state.mix}% music`;};
document.querySelector('#sound').onclick=e=>{sound=!sound;e.currentTarget.classList.toggle('enabled',sound);e.currentTarget.setAttribute('aria-pressed',String(sound));if(sound){audioContext??=new AudioContext();audioContext.resume();}toast(sound?'Demo metronome on':'Demo metronome off');};
document.querySelector('#add-video').onclick=()=>toast('Video upload & automatic alignment are planned. This frame previews where choreography will appear.');
document.querySelector('#offset').onchange=e=>toast(`Alignment control preview: ${e.target.value} seconds. No video is loaded.`);
document.querySelector('#upload').onclick=()=>document.querySelector('#file').click();
document.querySelector('#file').onchange=e=>{const file=e.target.files[0];if(!file)return;document.querySelector('#song-title').textContent=file.name.replace(/\.[^.]+$/,'');toast('Title updated for your mockup. Waveform, counts, and lyrics still use sample data; this prototype does not analyze or play the file.');};
document.querySelector('#library').onclick=()=>toast('Musicality concept: waveform + counts + lyrics + optional choreography. Use the design panel to explore.');
document.querySelector('#reset').onclick=()=>location.reload();
document.querySelector('#edit-lyrics').onclick=()=>{document.querySelector('#lyric-error').textContent='';document.querySelector('#lyric-editor').innerHTML=lyrics.map((l,i)=>`<label class="lyric-edit-row"><input aria-label="Line ${i+1} start time" type="number" min="0" max="47.99" step="0.1" value="${l.time}"><input aria-label="Line ${i+1} lyric" type="text" value="${escapeHTML(l.text)}"></label>`).join('');document.querySelector('#lyric-dialog').showModal();};
document.querySelector('#save-lyrics').onclick=()=>{const edited=Array.from(document.querySelectorAll('.lyric-edit-row')).map(row=>({time:+row.children[0].value,text:row.children[1].value.trim()}));if(edited.some((l,i)=>!l.text||!Number.isFinite(l.time)||l.time<0||l.time>=state.duration||(i&&l.time<=edited[i-1].time))){document.querySelector('#lyric-error').textContent='Use nonempty lyrics and increasing start times between 0 and 48 seconds.';return;}lyrics.splice(0,lyrics.length,...edited);document.querySelector('#lyric-dialog').close();update();toast('Lyrics and timing updated for this session.');};
let previous=performance.now();let elapsed=0;
function tick(now){const delta=(now-previous)/1000;previous=now;if(state.playing){state.time=Math.min(state.duration,state.time+delta*Number(document.querySelector('#speed').value));elapsed+=delta;if(elapsed>.05){update();elapsed=0;}if(state.time>=state.duration){state.playing=false;update();}}requestAnimationFrame(tick);}requestAnimationFrame(tick);
new ResizeObserver(()=>drawWave()).observe(document.querySelector('#wave-container'));
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();document.querySelector('#play').click();}});
