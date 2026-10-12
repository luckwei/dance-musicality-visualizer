// A project keeps the timeline of the first source. Adding a fallback track
// changes available sound, not the timestamps a user already corrected.
export function companionTime(time, timeline, videoOffset) {
  return timeline === 'video' ? time - videoOffset : time + videoOffset;
}
export function sourceGains({hasAudio,hasVideo,source='video',mix=50}) {
  if(!hasVideo)return {audio:hasAudio?1:0,video:0};
  if(!hasAudio)return {audio:0,video:1};
  if(source==='audio')return {audio:1,video:0};
  if(source==='video')return {audio:0,video:1};
  const audio=Math.max(0,Math.min(100,Number(mix)||0))/100;
  return {audio,video:1-audio};
}
export function shiftCues(cues,delta,duration) {
  return cues.map(cue=>({...cue,start:Math.max(0,cue.start+delta),end:Math.min(duration,cue.end+delta)})).filter(cue=>cue.start<duration&&cue.end>cue.start);
}
