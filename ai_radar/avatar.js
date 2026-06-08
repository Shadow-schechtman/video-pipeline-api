// ============================================================
// ai_radar/avatar.js — gerador parametrico do mascote AI Radar
// ------------------------------------------------------------
// Desenha o mascote QUADRO A QUADRO (PNG transparente) a partir de
// numeros que variam suavemente: abertura da boca (vinda da amplitude
// da narracao), piscar dos olhos, sobrancelha, "respiracao" (bob), giro
// do feixe do radar e gestos de braco com transicao (crossfade). Isso
// substitui a troca seca de PNGs (que ficava robotica).
//
// Uso (no index.js):
//   const avatar = require('./ai_radar/avatar');
//   const nf = avatar.renderFrames({ wavPath, fps, width, outDir });
//   // depois sobrepoe outDir/av_%05d.png no ffmpeg (image2, framerate=fps)
// ============================================================
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const C = '#00C2FF', DARK = '#0B2233', SCR = '#06182A', EYE = '#EAF6FF', PUP = '#06182A', WHT = '#FFFFFF';
const VB = '0 0 220 224';
const rad = d => d * Math.PI / 180;
const f1 = n => n.toFixed(1);

// ---- maos / dedos (traco fino) ----
function fingers(wx, wy, base, spread, count, length) {
  let s = '';
  for (let i = 0; i < count; i++) {
    const a = count < 2 ? base : (base - spread / 2 + spread * (i / (count - 1)));
    const ar = rad(a);
    const ex = wx + length * Math.cos(ar), ey = wy + length * Math.sin(ar);
    const mx = wx + length * 0.55 * Math.cos(ar), my = wy + length * 0.55 * Math.sin(ar);
    const px = mx + length * 0.12 * Math.cos(ar + 1.5708), py = my + length * 0.12 * Math.sin(ar + 1.5708);
    s += '<path d="M' + f1(wx) + ',' + f1(wy) + ' Q' + f1(px) + ',' + f1(py) + ' ' + f1(ex) + ',' + f1(ey) + '" fill="none" stroke="' + C + '" stroke-width="2.2" stroke-linecap="round"/>';
  }
  return s;
}
function hand(wx, wy, base, length, spread) { length = length || 22; spread = spread || 46; return fingers(wx, wy, base, spread, 4, length) + fingers(wx, wy, base - 60, 0, 1, length * 0.7); }
function pointHand(wx, wy, base) { return fingers(wx, wy, base, 0, 1, 22) + fingers(wx, wy, base + 90, 38, 3, 7) + fingers(wx, wy, base - 58, 0, 1, 8); }
function thumbUp(wx, wy) { return fingers(wx, wy, -90, 0, 1, 16) + fingers(wx, wy, 15, 55, 3, 7); }
function armP(d) { return '<path d="' + d + '" fill="none" stroke="' + C + '" stroke-width="3.2" stroke-linecap="round"/>'; }

const downR = armP('M166,150 C174,166 178,180 176,196') + hand(176, 196, 90);
const downL = armP('M54,150 C46,166 42,180 44,196') + hand(44, 196, 90);

// poses de braco usadas (idle = base; o resto sao gestos ocasionais)
const POSES = {
  idle:      armP('M166,148 C180,143 190,142 198,146') + hand(198, 146, 5, 20, 52) + downL,
  apontar:   armP('M166,150 C182,144 192,137 197,131') + pointHand(197, 131, -30) + downL,
  joinha:    armP('M166,150 C182,151 190,158 190,168') + thumbUp(190, 166) + downL,
  comemorar: armP('M166,150 C180,138 190,124 196,112') + hand(196, 112, -40, 20, 50) + armP('M54,150 C40,138 30,124 24,112') + hand(24, 112, 220, 20, 50),
  abertos:   armP('M166,150 C182,151 192,155 200,160') + hand(200, 160, 25, 18, 50) + armP('M54,150 C38,151 28,155 20,160') + hand(20, 160, 155, 18, 50)
};
const GESTURES = ['comemorar', 'apontar', 'abertos', 'joinha'];

function body() {
  return '<line x1="110" y1="48" x2="110" y2="30" stroke="' + C + '" stroke-width="3" stroke-linecap="round"/>'
    + '<circle cx="110" cy="25" r="5" fill="' + C + '"/>'
    + '<circle cx="110" cy="112" r="64" fill="' + DARK + '" stroke="' + C + '" stroke-width="4"/>'
    + '<circle cx="110" cy="112" r="50" fill="' + SCR + '" stroke="' + C + '" stroke-opacity=".5" stroke-width="2"/>'
    + '<circle cx="110" cy="112" r="37" fill="none" stroke="' + C + '" stroke-opacity=".3" stroke-width="1.5"/>'
    + '<circle cx="110" cy="112" r="21" fill="none" stroke="' + C + '" stroke-opacity=".3" stroke-width="1.5"/>'
    + '<rect x="98" y="176" width="24" height="15" rx="4" fill="' + DARK + '" stroke="' + C + '" stroke-width="3"/>'
    + '<rect x="84" y="189" width="52" height="10" rx="5" fill="' + DARK + '" stroke="' + C + '" stroke-width="3"/>';
}
function sweep(ang) {
  const a = rad(ang), L = 46;
  const x = 110 + L * Math.sin(a), y = 112 - L * Math.cos(a);
  const x2 = 110 + L * Math.sin(a + 0.34), y2 = 112 - L * Math.cos(a + 0.34);
  return '<path d="M110,112 L' + f1(x) + ',' + f1(y) + ' L' + f1(x2) + ',' + f1(y2) + ' Z" fill="' + C + '" fill-opacity=".16"/>'
    + '<line x1="110" y1="112" x2="' + f1(x) + '" y2="' + f1(y) + '" stroke="' + C + '" stroke-opacity=".6" stroke-width="2"/>';
}
function face(eyeOpen, brow) {
  const by = 93 - brow;
  let s = '<path d="M85,' + f1(by) + ' Q98,' + f1(by - 4) + ' 111,' + f1(by) + '" fill="none" stroke="' + C + '" stroke-width="3" stroke-linecap="round"/>'
    + '<path d="M109,' + f1(by) + ' Q122,' + f1(by - 4) + ' 137,' + f1(by) + '" fill="none" stroke="' + C + '" stroke-width="3" stroke-linecap="round"/>';
  const ry = Math.max(0.6, 9 * eyeOpen), pry = Math.max(0, 4 * eyeOpen);
  s += '<ellipse cx="98" cy="109" rx="9" ry="' + ry.toFixed(2) + '" fill="' + EYE + '"/><ellipse cx="122" cy="109" rx="9" ry="' + ry.toFixed(2) + '" fill="' + EYE + '"/>';
  if (pry > 0.2) s += '<ellipse cx="98" cy="109" rx="4" ry="' + pry.toFixed(2) + '" fill="' + PUP + '"/><ellipse cx="122" cy="109" rx="4" ry="' + pry.toFixed(2) + '" fill="' + PUP + '"/>';
  if (eyeOpen > 0.5) s += '<circle cx="94" cy="105" r="2" fill="' + WHT + '"/><circle cx="118" cy="105" r="2" fill="' + WHT + '"/>';
  return s;
}
function mouth(opn, rnd) {
  const w = 14 - 5 * rnd, top = -4 * opn - 0.6 * rnd, up = top + 4, bot = 1 + 18 * opn - 3 * rnd;
  return '<g transform="translate(110,140)"><path d="M' + f1(-w) + ',' + f1(top) + ' Q0,' + f1(up) + ' ' + f1(w) + ',' + f1(top) + ' Q0,' + f1(bot) + ' ' + f1(-w) + ',' + f1(top) + ' Z" fill="' + C + '"/></g>';
}

// ---- agenda de gestos (idle -> gesto -> idle ...) com crossfade ----
function poseSegments(dur) {
  const segs = [{ t0: 0, pose: 'idle' }];
  const first = 3.0, period = 5.0, hold = 1.8;
  let gi = 0;
  for (let gt = first; gt < dur; gt += period) {
    segs.push({ t0: gt, pose: GESTURES[gi % GESTURES.length] });
    segs.push({ t0: gt + hold, pose: 'idle' });
    gi++;
  }
  return segs.sort((a, b) => a.t0 - b.t0);
}
function armAt(segs, t, xf) {
  let idx = 0;
  for (let i = 0; i < segs.length; i++) if (segs[i].t0 <= t) idx = i;
  const cur = segs[idx].pose;
  const prev = idx > 0 ? segs[idx - 1].pose : null;
  const p = Math.min(1, (t - segs[idx].t0) / xf);
  if (p >= 1 || !prev || prev === cur) return POSES[cur];
  return '<g opacity="' + (1 - p).toFixed(3) + '">' + POSES[prev] + '</g><g opacity="' + p.toFixed(3) + '">' + POSES[cur] + '</g>';
}

function frameSVG(arm, opn, rnd, eyeOpen, brow, bob, ang) {
  const inner = body() + sweep(ang) + arm + face(eyeOpen, brow) + mouth(opn, rnd);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + VB + '"><g transform="translate(0,' + bob.toFixed(2) + ')">' + inner + '</g></svg>';
}

// ---- envelope de amplitude (WAV PCM 16-bit mono) -> abertura suave ----
function envelopeFromWav(wavPath, fps) {
  const buf = fs.readFileSync(wavPath);
  // procura o chunk "data"
  let off = 12;
  let sr = buf.readUInt32LE(24);
  let dataOff = 44, dataLen = buf.length - 44;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(off + 12);
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  const nSamp = Math.floor(dataLen / 2);
  const total = nSamp / sr;
  const nf = Math.max(1, Math.round(total * fps));
  const win = Math.floor(sr / fps);
  const env = [];
  for (let i = 0; i < nf; i++) {
    let a = i * win, b = Math.min(nSamp, a + win), acc = 0, cnt = 0;
    for (let j = a; j < b; j++) { const v = buf.readInt16LE(dataOff + j * 2) / 32768; acc += v * v; cnt++; }
    env.push(cnt ? Math.sqrt(acc / cnt) : 0);
  }
  const mx = Math.max.apply(null, env) || 1;
  return env.map(e => Math.pow(e / mx, 0.6));
}

function renderFrames(opts) {
  const fps = opts.fps || 25;
  const width = opts.width || 720;
  const outDir = opts.outDir;
  const xf = 0.45;
  fs.mkdirSync(outDir, { recursive: true });
  const env = envelopeFromWav(opts.wavPath, fps);
  const nf = env.length;
  const dur = nf / fps;

  // suavizacao (ataque rapido, relaxamento lento) + arredondamento leve p/ O/U
  const opn = new Array(nf); let prev = 0;
  for (let i = 0; i < nf; i++) { const tgt = env[i]; const k = tgt > prev ? 0.55 : 0.28; prev = prev + k * (tgt - prev); opn[i] = prev; }
  const rnd = opn.map(o => o > 0.2 ? Math.max(0, Math.min(1, (0.55 - o) * 1.3)) : 0);

  const segs = poseSegments(dur);
  const blinks = []; for (let tb = 1.4; tb < dur; tb += 3.3) blinks.push(tb);
  const eyeAt = t => { let e = 1; for (const tb of blinks) e = Math.min(e, 1 - Math.exp(-Math.pow((t - tb) / 0.07, 2))); return Math.max(0, e); };

  for (let i = 0; i < nf; i++) {
    const t = i / fps;
    const eyeOpen = eyeAt(t);
    const brow = Math.max(0, Math.min(3, 1.3 * opn[i] + 0.7 * Math.sin(2 * Math.PI * t / 4 + 1) + 0.7));
    const bob = 1.6 * Math.sin(2 * Math.PI * t / 3);
    const ang = (t * 36) % 360;
    const arm = armAt(segs, t, xf);
    const svg = frameSVG(arm, opn[i], rnd[i], eyeOpen, brow, bob, ang);
    const sp = path.join(outDir, 's_' + String(i).padStart(5, '0') + '.svg');
    const pp = path.join(outDir, 'av_' + String(i).padStart(5, '0') + '.png');
    fs.writeFileSync(sp, svg);
    execSync('rsvg-convert -w ' + width + ' ' + sp + ' -o ' + pp, { timeout: 30000 });
  }
  return nf;
}

module.exports = { renderFrames };

