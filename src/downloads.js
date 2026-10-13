import { backendRequest } from './backend.js';
import { parseYouTubeId } from './youtube.js';

export function mountDownloads(container, { initialURL, settings, openSettings, useFile }) {
  container.innerHTML = `<details class="download-tools tool-disclosure"><summary>download <span>MP3 / MP4</span></summary>
    <div class="disclosure-body"><p class="help">Save a video or its audio, then use the file in your session. Download only media you own or have permission to save.</p>
    <label class="download-label">YouTube link<input type="url" id="download-url" aria-label="YouTube download link"></label>
    <label class="download-label">Format<select id="download-format"><option value="mp3">MP3 · audio</option><option value="mp4">MP4 · video, up to 720p</option></select></label>
    <div class="download-actions"><button type="button" class="button primary" id="download-start">Prepare download</button><button type="button" class="button" id="download-cancel" hidden>Cancel</button></div>
    <div id="download-ready" hidden><a class="button primary" id="download-save">Save file ↓</a><button type="button" class="button" id="download-use">Use in session</button></div>
    <p class="help" id="download-status" role="status">Requires a connected backend with yt-dlp + FFmpeg. No AI key needed.</p>
    <button type="button" class="text-button" id="download-settings">Connect backend ↗</button></div></details>`;
  const $ = selector => container.querySelector(selector);
  $('#download-url').value = initialURL;
  let controller, file, objectURL;
  const clearFile = () => { if(objectURL)URL.revokeObjectURL(objectURL); objectURL=null;file=null;$('#download-ready').hidden=true; };
  $('#download-url').oninput=clearFile;$('#download-format').onchange=clearFile;
  $('#download-settings').onclick = openSettings;
  $('#download-cancel').onclick = () => controller?.abort();
  $('#download-start').onclick = async () => {
    const id = parseYouTubeId($('#download-url').value), format = $('#download-format').value;
    if(!id){$('#download-status').textContent='Paste a valid YouTube video link.';$('#download-url').focus();return;}
    const config=settings();
    if(!config.token.trim()) { $('#download-status').textContent='Connect your backend and enter its app access token in Connections first.';openSettings();return; }
    clearFile();const request=new AbortController();controller=request;
    $('#download-start').disabled=true;$('#download-cancel').hidden=false;$('#download-url').disabled=true;$('#download-format').disabled=true;
    $('#download-status').textContent='Downloading and converting on your backend… This can take a few minutes. Keep this page open.';
    try {
      const blob=await backendRequest(config.base,'/api/youtube-download',{method:'POST',token:config.token,signal:request.signal,responseType:'blob',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,format})});
      if(!blob.size||!blob.type.startsWith(format==='mp3'?'audio/':'video/'))throw new Error('The backend did not return a media file. Check its URL and downloader setup.');
      file=new File([blob],`youtube-${id}.${format}`,{type:format==='mp3'?'audio/mpeg':'video/mp4'});
      objectURL=URL.createObjectURL(file);$('#download-save').href=objectURL;$('#download-save').download=file.name;
      $('#download-ready').hidden=false;$('#download-status').textContent=`Ready · ${(file.size/1024/1024).toFixed(1)} MB. Save the file or use it in this session.`;
    } catch(error) {$('#download-status').textContent=request.signal.aborted?'Download cancelled.':error.message;}
    finally {controller=null;$('#download-start').disabled=false;$('#download-cancel').hidden=true;$('#download-url').disabled=false;$('#download-format').disabled=false;}
  };
  $('#download-use').onclick = async () => {
    if(!file)return;const current=file;$('#download-use').disabled=true;
    try {await useFile(current);} finally {$('#download-use').disabled=false;}
  };
  window.addEventListener('pagehide',()=>{controller?.abort();clearFile();});
  return {setVideo(id){if(!controller){clearFile();$('#download-url').value=`https://www.youtube.com/watch?v=${id}`;}}};
}
