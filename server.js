const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const TEMP_DIR = path.join(__dirname, 'temp');
const FONTS_DIR = path.join(__dirname, 'fonts');
const CLEANUP_MAX_AGE_MS = (parseFloat(process.env.CLEANUP_MAX_AGE_DAYS) || 3) * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
[UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR, FONTS_DIR].forEach((dir) => {
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
const upload = multer({ dest: UPLOAD_DIR });
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(OUTPUT_DIR));
app.use('/fonts', express.static(FONTS_DIR));
const FONT_CANDIDATES = [
{ file: 'font.woff2', format: 'woff2' },
{ file: 'font.woff', format: 'woff' },
{ file: 'font.ttf', format: 'truetype' },
{ file: 'font.otf', format: 'opentype' },
];
app.get('/api/check-font', (req, res) => {
for (const candidate of FONT_CANDIDATES) {
if (fs.existsSync(path.join(FONTS_DIR, candidate.file))) {
return res.json({ available: true, url: `/fonts/${candidate.file}`, format: candidate.format });
}
}
res.json({ available: false });
});
const jobs = {};
const subscribers = {};
const lastBroadcastAt = {};
function checkBinary(bin, args) {
return new Promise((resolve) => {
const p = spawn(bin, args);
p.on('error', () => resolve(false));
p.on('close', (code) => resolve(code === 0));
});
}
const checkFfmpeg = () => checkBinary('ffmpeg', ['-version']);
const checkFfprobe = () => checkBinary('ffprobe', ['-version']);
app.get('/api/check-ffmpeg', async (req, res) => {
const [ffmpegOk, ffprobeOk] = await Promise.all([checkFfmpeg(), checkFfprobe()]);
res.json({ ok: ffmpegOk, ffprobeOk });
});
function cleanupOldOutputs() {
fs.readdir(OUTPUT_DIR, (err, files) => {
if (err) return;
const now = Date.now();
files.forEach((file) => {
if (file.startsWith('.')) return;
const filePath = path.join(OUTPUT_DIR, file);
fs.stat(filePath, (statErr, stats) => {
if (statErr || !stats.isFile()) return;
if (now - stats.mtimeMs > CLEANUP_MAX_AGE_MS) {
fs.unlink(filePath, (unlinkErr) => {
if (!unlinkErr) console.log(`[cleanup] Đã xóa file cũ: ${file}`);
});
}
});
});
});
}
cleanupOldOutputs();
setInterval(cleanupOldOutputs, CLEANUP_INTERVAL_MS);
function getDuration(filePath) {
return new Promise((resolve) => {
const args = [
'-v', 'error',
'-show_entries', 'format=duration',
'-of', 'default=noprint_wrappers=1:nokey=1',
filePath,
];
const proc = spawn('ffprobe', args);
let out = '';
proc.stdout.on('data', (d) => { out += d.toString(); });
proc.on('error', () => resolve(null));
proc.on('close', () => {
const val = parseFloat(out.trim());
resolve(Number.isFinite(val) && val > 0 ? val : null);
});
});
}
function getVideoInfo(filePath) {
return new Promise((resolve) => {
const args = [
'-v', 'error',
'-select_streams', 'v:0',
'-show_entries', 'stream=width,height,r_frame_rate:format=duration',
'-of', 'json',
filePath,
];
const proc = spawn('ffprobe', args);
let out = '';
proc.stdout.on('data', (d) => { out += d.toString(); });
proc.on('error', () => resolve(null));
proc.on('close', () => {
try {
const data = JSON.parse(out);
const stream = (data.streams && data.streams[0]) || {};
const format = data.format || {};
let fps = null;
if (stream.r_frame_rate) {
const [num, den] = stream.r_frame_rate.split('/').map(Number);
if (den) fps = Math.round((num / den) * 100) / 100;
}
resolve({
width: stream.width || null,
height: stream.height || null,
fps,
duration: format.duration ? parseFloat(format.duration) : null,
});
} catch (_) {
resolve(null);
}
});
});
}
function formatBytes(bytes) {
if (!bytes && bytes !== 0) return null;
const mb = bytes / (1024 * 1024);
return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}
function broadcast(jobId, force = false) {
const job = jobs[jobId];
const subs = subscribers[jobId];
if (!job || !subs || subs.size === 0) return;
const now = Date.now();
if (!force && lastBroadcastAt[jobId] && now - lastBroadcastAt[jobId] < 150) return;
lastBroadcastAt[jobId] = now;
const payload = JSON.stringify(job);
for (const ws of subs) {
if (ws.readyState === WebSocket.OPEN) ws.send(payload);
}
}
app.post('/api/compress', upload.single('video'), (req, res) => {
if (!req.file) {
return res.status(400).json({ error: 'Không có file được tải lên.' });
}
let passes = parseInt(req.body.passes, 10);
if (Number.isNaN(passes)) passes = 1;
passes = Math.max(1, Math.min(100, passes));
const jobId = crypto.randomUUID();
const originalExt = path.extname(req.file.originalname) || '.mp4';
const originalName = path
.basename(req.file.originalname, originalExt)
.replace(/[^a-zA-Z0-9_\-]/g, '_');
jobs[jobId] = {
status: 'running',
log: [`Đã nhận file "${req.file.originalname}". Bắt đầu nén ${passes} lần...`],
passes,
currentPass: 0,
currentPassProgress: 0,
outputFile: null,
originalSize: req.file.size,
finalSize: null,
savedPercent: null,
videoInfo: null,
error: null,
};
subscribers[jobId] = new Set();
runCompression(jobId, req.file.path, originalName, originalExt, passes);
res.json({ jobId });
});
async function runCompression(jobId, inputPath, originalName, ext, passes) {
const job = jobs[jobId];
let currentInput = inputPath;
let prevTemp = null;
try {
const ffmpegOk = await checkFfmpeg();
if (!ffmpegOk) {
throw new Error(
'Không tìm thấy FFmpeg. Hãy cài FFmpeg và thêm vào PATH, hoặc đặt ffmpeg.exe cùng thư mục server.js.'
);
}
const ffprobeOk = await checkFfprobe();
for (let i = 1; i <= passes; i++) {
job.currentPass = i;
job.currentPassProgress = 0;
job.log.push(`[${i}/${passes}] Đang xử lý lượt nén ${i}...`);
broadcast(jobId, true);
const isLast = i === passes;
const stepOutput = isLast
? path.join(OUTPUT_DIR, `compressed_x${passes}_${originalName}${ext}`)
: path.join(TEMP_DIR, `temp_${jobId}_pass_${i}.mp4`);
const durationSec = ffprobeOk ? await getDuration(currentInput) : null;
await runFfmpegPass(
  currentInput,
  stepOutput,
  durationSec,
  (frac) => {
    job.currentPassProgress = frac;
    broadcast(jobId);
  },
  i === 1
);
job.currentPassProgress = 1;
broadcast(jobId, true);
if (prevTemp && fs.existsSync(prevTemp)) {
fs.unlinkSync(prevTemp);
}
if (!isLast) {
prevTemp = stepOutput;
currentInput = stepOutput;
} else {
job.outputFile = path.basename(stepOutput);
try {
const stat = fs.statSync(stepOutput);
job.finalSize = stat.size;
if (job.originalSize) {
job.savedPercent = Math.max(
0,
Math.round((1 - stat.size / job.originalSize) * 100)
);
}
} catch (_) {                                      }
if (ffprobeOk) {
job.videoInfo = await getVideoInfo(stepOutput);
}
}
}
if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
job.status = 'done';
job.log.push('✅ Hoàn tất! Video đã sẵn sàng để tải xuống.');
broadcast(jobId, true);
} catch (err) {
job.status = 'error';
job.error = err.message;
job.log.push(`[Lỗi] ${err.message}`);
broadcast(jobId, true);
}
}
function runFfmpegPass(input, output, durationSec, onProgress, applyDenoise = false) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', input,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '35',
      '-profile:v', 'high',
      '-level', '4.1',
      '-pix_fmt', 'yuv420p',
    ];

    if (applyDenoise) {
      args.push('-vf', 'hqdn3d=1.2:0.6:1.8:0.6');
    }

    args.push(
      '-x264-params',
      'deblock=1:1:' +
      'subme=8:' +
      'me=umh:' +
      'merange=24:' +
      'aq-mode=3:' +
      'aq-strength=1.0:' +
      'psy-rd=1.0:0.15:' +
      'chroma-qp-offset=-3:' +
      'keyint=450:' +
      'min-keyint=45:' +
      'no-fast-pskip=1:' +
      'no-dct-decimate=1:' +
      'bframes=3:' +
      'b-adapt=2',
      '-c:a', 'copy',
      '-progress', 'pipe:1',
      '-nostats',
      output
    );

    const proc = spawn('ffmpeg', args);
    let stderr = '';
    let buffer = '';
    if (durationSec) {
      proc.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const m = line.match(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
          if (m) {
            const sec = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
            onProgress(Math.min(1, sec / durationSec));
          }
        }
      });
    }
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('error', () => {
      reject(new Error('Không thể chạy FFmpeg. Kiểm tra lại PATH hoặc quyền thực thi.'));
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg lỗi (mã ${code}): ${stderr.slice(-500) || 'không rõ nguyên nhân'}`));
    });
  });
}
wss.on('connection', (ws, req) => {
let jobId;
try {
jobId = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('jobId');
} catch (_) {
ws.close();
return;
}
if (!jobId || !jobs[jobId]) {
ws.send(JSON.stringify({ error: 'Job không tồn tại.' }));
ws.close();
return;
}
if (!subscribers[jobId]) subscribers[jobId] = new Set();
subscribers[jobId].add(ws);
ws.send(JSON.stringify(jobs[jobId]));
ws.on('close', () => {
if (subscribers[jobId]) subscribers[jobId].delete(ws);
});
});
app.get('/api/status/:jobId', (req, res) => {
const job = jobs[req.params.jobId];
if (!job) return res.status(404).json({ error: 'Không tìm thấy job.' });
res.json(job);
});
server.listen(PORT, () => {
console.log(`\n🎬 Video Compressor đang chạy tại: http://localhost:${PORT}\n`);
});
