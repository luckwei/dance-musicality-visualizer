import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { downloadArguments, downloadYouTube } from '../server/download.mjs';

const id='v1t4MTqdfyI';
test('download inputs cannot introduce arbitrary URLs, paths, or command flags',()=>{
  for(const bad of ['https://localhost/','--exec touch','../evil',''])assert.throws(()=>downloadArguments(bad,'mp3','/tmp/job',100));
  assert.throws(()=>downloadArguments(id,'../../file','/tmp/job',100));
  for(const format of ['mp3','mp4']){
    const args=downloadArguments(id,format,'/tmp/job',100);
    assert.deepEqual(args.slice(-2),['--',`https://www.youtube.com/watch?v=${id}`]);
    assert.ok(args.includes('--ignore-config'));assert.ok(args.includes('--no-playlist'));
    assert.ok(args.includes('!is_live & duration > 0 & duration <= 1800'));
  }
});
function fixture(code,capture){return (_executable,args,options)=>{
 assert.equal(options.shell,false);const output=args[args.indexOf('--output')+1].replace('%(ext)s','mp3');capture.directory=dirname(output);
 return spawn(process.execPath,['--input-type=module','-e',`import {writeFileSync} from 'node:fs';const output=process.argv[1];${code}`,output],options);
};}
test('completed conversion returns binary file and cleans temporary storage',async()=>{
 const capture={};const result=await downloadYouTube({id,format:'mp3',spawnImpl:fixture("writeFileSync(output,'media fixture');",capture)});
 assert.equal(await readFile(result.path,'utf8'),'media fixture');assert.equal(result.size,13);
 await result.cleanup();await assert.rejects(access(capture.directory));
});
test('process failure, missing output, and oversized output all clean temporary storage',async()=>{
 for(const [code,status,maxBytes] of [["process.exit(1)",502,100],["",422,100],["writeFileSync(output,'too much data');",413,4]]){
  const capture={};await assert.rejects(downloadYouTube({id,format:'mp3',maxBytes,spawnImpl:fixture(code,capture)}),error=>error.status===status);
  await assert.rejects(access(capture.directory));
 }
});
test('cancellation and deadlines stop running jobs and delete partial media',async()=>{
 for(const cancelled of [false,true]){
  const capture={},controller=new AbortController();
  const work=downloadYouTube({id,format:'mp3',signal:controller.signal,timeoutMs:cancelled?10000:100,spawnImpl:fixture("writeFileSync(output,'partial');setInterval(()=>{},1000);",capture)});
  const timer=cancelled?setTimeout(()=>controller.abort(),100):null;
  try {await assert.rejects(work,error=>error.status===(cancelled?499:504));await assert.rejects(access(capture.directory));}
  finally {clearTimeout(timer);}
 }
});
