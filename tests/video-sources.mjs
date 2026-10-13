import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createApp} from '../server/server.mjs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'musicality-sources-'));
const rate=22050,seconds=12,wav=Buffer.alloc(44+rate*seconds*2);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let sample=0;sample<rate*seconds;sample++){const t=sample/rate%0.5;wav.writeInt16LE(Math.round(Math.exp(-t*30)*Math.sin(2*Math.PI*180*t)*20000),44+sample*2);}
const song=join(dir,'fallback.wav');await writeFile(song,wav);
const server=createApp({env:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/dance-musicality-visualizer/`;
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 // Simulate the official IFrame API, including metadata that is unavailable
 // until first playback. This verifies app integration, not live YouTube access.
 await page.addInitScript(()=>{
  window.YT={Player:class{
   constructor(host,options){this.events=options.events;this.state=5;this.time=0;this.at=performance.now();this.duration=0;this.rate=1;this.volume=100;window.testYoutube=this;queueMicrotask(()=>this.events.onReady());}
   emit(state){this.time=this.getCurrentTime();this.at=performance.now();this.state=state;this.events.onStateChange({data:state});}
   cueVideoById(){this.time=0;this.duration=0;this.emit(5);}
   getPlayerState(){return this.state;}
   getCurrentTime(){return this.time+(this.state===1?(performance.now()-this.at)/1000*this.rate:0);}
   getDuration(){return this.duration;}
   getAvailablePlaybackRates(){return [.5,.75,1,1.25,1.5];}
   setPlaybackRate(rate){this.time=this.getCurrentTime();this.at=performance.now();this.rate=rate;}
   setVolume(volume){this.volume=volume;}
   seekTo(time){this.time=time;this.at=performance.now();}
   playVideo(){this.duration=12;this.emit(1);}
   pauseVideo(){this.emit(2);}
   destroy(){}
  }};
 });
 await page.goto(base);await page.locator('[aria-label="YouTube video link"]').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');await page.getByRole('button',{name:'Load video',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('#play').disabled);assert.equal(await page.locator('#duration').innerText(),'0:00');
 await page.locator('#play').click();await page.waitForSelector('.phrase');await page.waitForTimeout(650);await page.locator('#play').click();
 assert.equal(await page.locator('#duration').innerText(),'0:12');assert.ok(Number(await page.locator('#seek').inputValue())>.3);assert.equal(await page.locator('#sound-source').inputValue(),'video');assert.equal(await page.evaluate(()=>testYoutube.volume),100);assert.equal(await page.locator('#transcribe').isDisabled(),true);
 await page.locator('#jump-lyrics').click();await page.locator('#lyrics-text').fill('0.2-3.5 | video on its own\n4-7.5 | keep on moving');await page.locator('#place-lyrics').click();await page.locator('#apply-suggestion').click();const cueCount=await page.locator('.syllable').count();assert.ok(cueCount>3);
 await page.locator('#loop').click();await page.locator('#seek').evaluate(input=>{input.value='3.8';input.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#play').click();await page.waitForTimeout(600);await page.locator('#play').click();assert.ok(Number(await page.locator('#seek').inputValue())<1);await page.locator('#loop').click();
 await page.locator('#speed').selectOption('0.5');assert.equal(await page.evaluate(()=>testYoutube.rate),.5);await page.locator('#speed').selectOption('1');
 await page.locator('#play').click();await page.waitForTimeout(150);await page.evaluate(()=>testYoutube.emit(3));const frozen=Number(await page.locator('#seek').inputValue());await page.waitForTimeout(350);assert.ok(Math.abs(Number(await page.locator('#seek').inputValue())-frozen)<.15,'Buffering must not run the timeline ahead');
 await page.locator('#audio-file').setInputFiles(song);await page.waitForFunction(()=>!document.querySelector('#remove-audio').hidden);
 assert.equal(await page.locator('.syllable').count(),cueCount);assert.match(await page.locator('#track-detail').innerText(),/follows video/);assert.equal(await page.locator('#sound-source').inputValue(),'video');assert.equal(await page.evaluate(()=>testYoutube.volume),100);assert.equal(await page.locator('#transcribe').isEnabled(),true);
 assert.ok((await page.locator('.waveform path').first().getAttribute('d')).length>20);
 await page.locator('#sound-source').selectOption('audio');assert.equal(await page.evaluate(()=>testYoutube.volume),0);
 await page.locator('#sound-source').selectOption('mix');assert.equal(await page.evaluate(()=>testYoutube.volume),50);
 await page.locator('#remove-audio').click();assert.equal(await page.locator('.syllable').count(),cueCount);assert.equal(await page.evaluate(()=>testYoutube.volume),100);assert.equal(await page.locator('#transcribe').isDisabled(),true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 console.log('PASS: YouTube-only transport with late metadata, native soundtrack, manual lyrics, looping, buffering, speed, optional audio attachment/removal without losing edits, source selection, and mobile width (mock IFrame API).');
 const video=join(dir,'soundtrack.mp4');const encoded=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x718060:s=320x180:r=15','-i',song,'-map','0:v','-map','1:a','-t','12','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
 if(encoded.status===0){
  const local=await browser.newPage();local.on('pageerror',error=>errors.push(error.message));local.on('dialog',dialog=>dialog.accept());await local.goto(base);await local.locator('#video-file').setInputFiles(video);
  await local.waitForFunction(()=>document.querySelector('#video-file-name').textContent.includes('soundtrack analyzed'));
  assert.equal(await local.locator('#remove-audio').isVisible(),false);assert.equal(await local.locator('#sound-source').inputValue(),'video');assert.equal(await local.locator('#transcribe').isEnabled(),true);assert.match(await local.locator('#track-detail').innerText(),/follows video/);
  await local.locator('#play').click();await local.waitForTimeout(650);await local.locator('#play').click();assert.ok(Number(await local.locator('#seek').inputValue())>.3);assert.equal(await local.locator('#choreography').evaluate(video=>video.volume),1);
  await local.locator('#choreography').evaluate(video=>video.currentTime=3);await local.waitForTimeout(100);assert.ok(Math.abs(Number(await local.locator('#seek').inputValue())-3)<.15);
  await local.locator('#audio-file').setInputFiles(song);await local.waitForFunction(()=>!document.querySelector('#remove-audio').hidden);assert.match(await local.locator('#track-detail').innerText(),/follows video/);assert.equal(await local.locator('#sound-source').inputValue(),'video');
  await local.locator('#alignment-tools > summary').click();await local.locator('#link-playback').uncheck();await local.locator('#audio-preview audio').evaluate(audio=>audio.currentTime=1);await local.locator('#choreography').evaluate(video=>video.currentTime=3);await local.waitForTimeout(200);await local.locator('#align-here').click();assert.ok(Math.abs(Number(await local.locator('#video-offset').inputValue())-2)<.1);await local.locator('#link-playback').check();
  await local.locator('#sound-source').selectOption('audio');assert.equal(await local.locator('#choreography').evaluate(video=>video.volume),0);await local.locator('#remove-audio').click();assert.equal(await local.locator('#choreography').evaluate(video=>video.volume),1);assert.equal(await local.locator('#transcribe').isEnabled(),true);
  console.log('PASS: local MP4 alone with real soundtrack analysis, waveform, transport, native seeking, optional separate audio, and source switching without duplicate audio.');
 }else console.log('SKIPPED: real local-video test needs ffmpeg/libx264.');
 assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
