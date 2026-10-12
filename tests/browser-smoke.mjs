import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createApp } from '../server/server.mjs';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const artifacts=await mkdtemp(join(tmpdir(),'musicality-browser-'));
const rate=22050,seconds=12,samples=new Float32Array(rate*seconds);
let seed=42;
for(let beat=0;beat<24;beat++){
 seed=(1664525*seed+1013904223)>>>0;const amplitude=.3+seed/2**32*.6;
 for(let i=0;i<rate*.18;i++){const t=i/rate;samples[Math.round(beat*.5*rate)+i]=amplitude*Math.exp(-t*25)*Math.sin(2*Math.PI*(110+beat*10)*t);}
}
const wav=Buffer.alloc(44+samples.length*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples.length*2,40);samples.forEach((sample,i)=>wav.writeInt16LE(Math.round(sample*32767),44+i*2));
const song=join(artifacts,'test-song.wav');await writeFile(song,wav);
const server=createApp({env:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(`http://127.0.0.1:${server.address().port}/dance-musicality-visualizer/`);
 await page.locator('#audio-file').setInputFiles(song);await page.waitForSelector('.phrase');
 assert.equal(await page.locator('.phrase').count(),3);assert.ok(Math.abs(Number(await page.locator('#bpm').inputValue())-120)<1);
 const points=await page.locator('.phrase').first().locator('.count-tick').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().x));
 const spacing=points[1]-points[0];points.slice(1).forEach((point,i)=>assert.ok(Math.abs(point-points[i]-spacing)<.2));
 await page.locator('#play').click();await page.waitForTimeout(650);await page.locator('#play').click();assert.ok(Number(await page.locator('#seek').inputValue())>.3);
 await page.locator('#lyrics-text').fill('0.2-3.5 | you de-cide who\n4-7.5 | lights up the room\n8-11.8 | keep on dan-cing');
 await page.locator('#place-lyrics').click();await page.locator('#review-dialog').waitFor({state:'visible'});assert.equal(await page.locator('.syllable').count(),0);
 await page.locator('#apply-suggestion').click();assert.ok(await page.locator('.syllable').count()>10);const count=await page.locator('.syllable').count();
 await page.locator('#lyrics-text').fill('replacement words');await page.locator('#place-lyrics').click();await page.getByRole('button',{name:'Keep current',exact:true}).click();assert.equal(await page.locator('.syllable').count(),count);
 await page.locator('#undo').click();assert.equal(await page.locator('.syllable').count(),0);await page.locator('#redo').click();assert.equal(await page.locator('.syllable').count(),count);
 await page.locator('[data-mode="learn"]').click();assert.equal(await page.locator('#lyrics-text').isVisible(),false);assert.ok(await page.locator('.phrase:visible').count()<=2);
 await page.locator('[data-mode="align"]').click();assert.equal(await page.locator('.syllable').count(),count);await page.locator('[data-mode="correct"]').click();
 await page.locator('#edit-timing').click();await page.locator('.cue-row').first().locator('input').nth(2).fill('edited');await page.locator('#save-cues').click();assert.equal(await page.locator('.syllable').first().innerText(),'edited');await page.locator('#undo').click();assert.equal(await page.locator('.syllable').first().innerText(),'you');
 const cue=page.locator('.syllable').first();await cue.scrollIntoViewIfNeeded();const before=await cue.getAttribute('title'),bounds=await cue.boundingBox();
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+100,bounds.y+bounds.height/2,{steps:6});await page.mouse.up();assert.notEqual(await page.locator('.syllable').first().getAttribute('title'),before);await page.locator('#undo').click();assert.equal(await page.locator('.syllable').first().getAttribute('title'),before);
 await page.locator('#first-count').fill('0.5');await page.locator('#first-count').press('Tab');assert.equal(await page.locator('.syllable').count(),count);assert.equal(await page.locator('.phrase[data-phrase="-1"] .syllable').count(),1);await page.locator('#undo').click();
 await page.locator('#loop').click();await page.locator('#seek').evaluate(input=>{input.value='3.8';input.dispatchEvent(new Event('input',{bubbles:true}));});await page.locator('#play').click();await page.waitForTimeout(600);await page.locator('#play').click();assert.ok(Number(await page.locator('#seek').inputValue())<1.5, `loop=${await page.locator('#loop').innerText()} offset=${await page.locator('#first-count').inputValue()} time=${await page.locator('#seek').inputValue()}`);await page.locator('#loop').click();
 await page.locator('#ai-settings').evaluate(element=>element.open=true);await page.locator('#personal-key').fill('test-only-openai');await page.locator('#typesafe-key').fill('test-only-typesafe');await page.locator('#backend-token').fill('test-only-token');
 const downloadEvent=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadEvent;const exported=await readFile(await download.path(),'utf8');assert.ok(!exported.includes('test-only'));const project=JSON.parse(exported);assert.equal(project.syllables.length,count);
 await page.locator('#project-file').setInputFiles({name:'timing.json',mimeType:'application/json',buffer:Buffer.from(exported)});await page.waitForTimeout(100);assert.equal(await page.locator('.syllable').count(),count);
 const video=join(artifacts,'test-video.mp4');const ffmpeg=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=0x718060:s=320x180:r=15','-i',song,'-filter_complex','[1:a]adelay=2400[a]','-map','0:v','-map','[a]','-t','15','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
 if(ffmpeg.status===0){
  await page.locator('#video-file').setInputFiles(video);await page.waitForFunction(()=>document.querySelector('#choreography').readyState>=1);
  await page.locator('#link-playback').uncheck();await page.locator('#choreography').evaluate(video=>video.currentTime=5);await page.waitForTimeout(850);assert.ok(Math.abs(await page.locator('#choreography').evaluate(video=>video.currentTime)-5)<.1);
  await page.locator('#align-here').click();await page.locator('#link-playback').check();
  await page.locator('#align-video').click();await page.waitForFunction(()=>document.querySelector('#alignment-status').textContent.includes('Aligned')||document.querySelector('#alignment-status').textContent.includes('No confident')||document.querySelector('#alignment-status').textContent.includes('Could not'));
  const message=await page.locator('#alignment-status').innerText();assert.match(message,/Aligned/,message);assert.ok(Math.abs(Number(await page.locator('#video-offset').inputValue())-2.4)<.15);
  await page.locator('#mix').fill('25');await page.locator('#mix').dispatchEvent('input');assert.ok(Math.abs(await page.locator('#choreography').evaluate(video=>video.volume)-.75)<.01);
  console.log('PASS: real MP4 decode, manual alignment holds while unlinked, automatic audio offset, and audio mix.');
 }else console.log('SKIPPED: local MP4 smoke test requires ffmpeg with libx264 and AAC.');
 // Provider APIs are simulated here; these checks validate client request paths and review behavior, not provider availability.
 await page.route('**/api/transcribe',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({words:[{start:.3,end:.8,text:'hosted'},{start:1,end:1.5,text:'lyrics'}]})}));
 await page.locator('#transcription-method').selectOption('backend');await page.locator('#transcribe').click();await page.locator('#review-dialog').waitFor({state:'visible'});assert.equal(await page.locator('.syllable').count(),count);await page.getByRole('button',{name:'Keep current',exact:true}).click();
 await page.locator('#clear-keys').click();assert.equal(await page.locator('#personal-key').inputValue(),'');assert.equal(await page.locator('#typesafe-key').inputValue(),'');
 await page.locator('[data-mode="learn"]').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(artifacts,'learn-desktop.png'),fullPage:true});await page.locator('[data-mode="align"]').click();await page.screenshot({path:join(artifacts,'align-desktop.png'),fullPage:true});await page.locator('[data-mode="correct"]').click();await page.screenshot({path:join(artifacts,'correct-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(artifacts,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile horizontal overflow');
 assert.deepEqual(errors,[]);console.log('PASS: real WAV decoding/playback, eight-axis spacing, phrase loop, lyric review/edit/drag/undo, mode switching, timing round trip, secrets excluded from export, hosted-response review (mocked), mobile width, no browser runtime errors.');console.log(`Screenshots: ${artifacts}`);
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
