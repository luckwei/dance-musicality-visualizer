import { spawn } from 'node:child_process';
import { mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class DownloadError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function downloadArguments(id, format, directory, maxBytes) {
  if (!/^[\w-]{11}$/.test(id || '') || !['mp3', 'mp4'].includes(format)) throw new DownloadError(400, 'Choose a valid YouTube video and MP3 or MP4.');
  return ['--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--no-cache-dir',
    '--no-remote-components', '--js-runtimes', 'node', '--socket-timeout', '20', '--retries', '2',
    '--fragment-retries', '2', '--max-filesize', String(maxBytes),
    '--match-filters', '!is_live & duration > 0 & duration <= 1800',
    '--output', join(directory, 'media.%(ext)s'),
    ...(format === 'mp3' ? ['-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '192K']
      : ['-f', 'bestvideo[height<=720][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]', '--merge-output-format', 'mp4']),
    '--', `https://www.youtube.com/watch?v=${id}`];
}

// All subprocess arguments are server-controlled except a validated ID/format.
// No shell, user cookies, arbitrary URLs, config files, or executable flags.
export async function downloadYouTube({ id, format, signal, executable = 'yt-dlp', maxBytes = 250 * 1024 * 1024, timeoutMs = 300_000, spawnImpl = spawn }) {
  if (signal?.aborted) throw new DownloadError(499, 'Download cancelled.');
  const directory = await mkdtemp(join(tmpdir(), 'musicality-download-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const args = downloadArguments(id, format, directory, maxBytes);
    await new Promise((resolve, reject) => {
      let child, failure, checking = false;
      const stop = error => {
        failure ||= error;
        if (!child?.pid) return;
        // Terminate ffmpeg descendants as well as yt-dlp on Linux hosts.
        try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
      };
      const abort = () => stop(new DownloadError(499, 'Download cancelled.'));
      const timer = setTimeout(() => stop(new DownloadError(504, 'Download timed out. Try a shorter video or upload a local file.')), timeoutMs);
      const monitor = setInterval(async () => {
        if (checking) return; checking = true;
        try {
          const files = await readdir(directory);
          const sizes = await Promise.all(files.map(name => stat(join(directory, name)).then(info => info.size).catch(() => 0)));
          if (sizes.reduce((a, b) => a + b, 0) > maxBytes * 2) stop(new DownloadError(413, 'This download exceeds the temporary storage limit. Try a shorter video.'));
        } catch { /* Directory is removed when the job finishes. */ }
        finally { checking = false; }
      }, 500);
      const dispose = () => { clearTimeout(timer); clearInterval(monitor); signal?.removeEventListener('abort', abort); };
      try {
        child = spawnImpl(executable, args, { stdio: 'ignore', detached: process.platform !== 'win32', shell: false });
        child.once('error', () => { dispose(); reject(new DownloadError(503, 'Downloader is not installed. Install yt-dlp and FFmpeg on the backend.')); });
        child.once('close', code => { dispose(); if (failure) reject(failure); else if (code !== 0) reject(new DownloadError(502, 'YouTube could not provide this download. It may be restricted, unavailable, or blocked on this server. Try a local file or update yt-dlp.')); else resolve(); });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      } catch { dispose(); reject(new DownloadError(503, 'Downloader could not start. Check the backend installation.')); }
    });
    const path = join(directory, `media.${format}`);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || !info.size) throw new DownloadError(422, 'No downloadable file was produced. Use a non-live video under 30 minutes and 250 MB.');
    if (info.size > maxBytes) throw new DownloadError(413, 'The converted file exceeds 250 MB. Try a shorter video.');
    if (signal?.aborted) throw new DownloadError(499, 'Download cancelled.');
    return { path, size: info.size, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
