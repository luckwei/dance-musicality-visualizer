import test from 'node:test';
import assert from 'node:assert/strict';
import {companionTime,sourceGains,shiftCues} from '../src/media-routing.js';

test('both timeline directions use the same positive video offset convention',()=>{
 assert.equal(companionTime(4,'audio',2.4),6.4);
 assert.equal(companionTime(6.4,'video',2.4),4);
 assert.equal(companionTime(1,'video',2.4),-1.4);
 assert.equal(companionTime(4,'video',-3),7);
});
test('a sole source stays audible regardless of stale mixing settings',()=>{
 assert.deepEqual(sourceGains({hasAudio:false,hasVideo:true,source:'audio',mix:100}),{audio:0,video:1});
 assert.deepEqual(sourceGains({hasAudio:true,hasVideo:false,source:'video',mix:0}),{audio:1,video:0});
 assert.deepEqual(sourceGains({hasAudio:false,hasVideo:false}),{audio:0,video:0});
});
test('both sources can be selected independently or mixed without duplicate full-volume output',()=>{
 assert.deepEqual(sourceGains({hasAudio:true,hasVideo:true,source:'video'}),{audio:0,video:1});
 assert.deepEqual(sourceGains({hasAudio:true,hasVideo:true,source:'audio'}),{audio:1,video:0});
 assert.deepEqual(sourceGains({hasAudio:true,hasVideo:true,source:'mix',mix:25}),{audio:.25,video:.75});
});
test('changing to the video timeline shifts, clips, and preserves original lyric records',()=>{
 const original=[{start:0,end:1,text:'a'},{start:2,end:4,text:'b'},{start:9,end:10,text:'c'}];
 assert.deepEqual(shiftCues(original,2.4,6),[{start:2.4,end:3.4,text:'a'},{start:4.4,end:6,text:'b'}]);
 assert.deepEqual(shiftCues(original,-2.5,6),[{start:0,end:1.5,text:'b'}]);
 assert.equal(original[1].start,2);
});
