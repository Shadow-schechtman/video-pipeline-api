const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const C = '#00C2FF', DARK = '#0B2233', SCR = '#06182A', EYE = '#EAF6FF', PUP = '#06182A', WHT = '#FFFFFF';
const VB = '0 0 220 224';
const rad = d => d * Math.PI / 180;
const f1 = n => n.toFixed(1);
const lerp = (a, b, p) => a + (b - a) * p;
const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

// ---------- maos / dedos ----------
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
function hand(wx, wy, base, length, spread) {
  length = length || 20; spread = spread || 46;
  return fingers(wx, wy, base, spread, 4, length) + fingers(wx, wy, base - 60, 0, 1, length * 0.7);
}

// ---------- braco parametrico (ombro -> cotovelo -> punho) ----------
// Angulos em graus, coords SVG (x p/ direita, y p/ baixo): 0 = direita, 90 = baixo, -90 = cima, 180 = esquerda.
const UP_LEN = 24, FORE_LEN = 22;
function armChain(sx, sy, shAng, elAng) {
  const sa = rad(shAng), ea = rad(elAng);
  const ex = sx + UP_LEN * Math.cos(sa), ey = sy + UP_LEN * Math.sin(sa);
  const wx = ex + FORE_LEN * Math.cos(ea), wy = ey + FORE_LEN * Math.sin(ea);
  const arm = '<path d="M' + f1(sx) + ',' + f1(sy) + ' Q' + f1(ex) + ',' + f1(ey) + ' ' + f1(wx) + ',' + f1(wy) + '" fill="none" stroke="' + C + '" stroke-width="3.2" stroke-linecap="round"/>';
  return arm + hand(wx, wy, elAng, 20, 46);
}
const R_SH = [166, 150], L_SH = [54, 150];

// Poses por angulos: rs/re = ombro/cotovelo direito | ls/le = ombro/cotovelo esquerdo
const A = {
  idle:      { rs: 78,  re: 90,  ls: 102, le: 90 },
  wave:      { rs: -8,  re: -30, ls: 102, le: 90 },
  point:     { rs: -18, re: -26, ls: 102, le: 90 },
  celebrate: { rs: -62, re: -78, ls: 242, le: 258 },
  open:      { rs: 22,  re: 6,   ls: 158, le: 174 }
};
const GSEQ = [A.wave, A.point, A.celebrate, A.open];

function armKeyframes(dur) {
  const kf = [{ t: 0, p: A.idle }];
  let tt = 2.5, gi = 0;
  while (tt < dur) {
    kf.push({ t: tt,        p: A.idle });
    kf.push({ t: tt + 0.55, p: GSEQ[gi % GSEQ.length] });
    kf.push({ t: tt + 1.7,  p: GSEQ[gi % GSEQ.length] });
    kf.push({ t: tt + 2.3,  p: A.idle });
    tt += 4.6; gi++;
  }
  kf.push({ t: dur + 1, p: A.idle });
  return kf;
}
function armAnglesAt(t, kf) {
  let i = 0;
  for (let k = 0; k < kf.length - 1; k++) if (kf[k].t <= t) i = k;
  const a = kf[i], b = kf[Math.min(i + 1, kf.length - 1)];
  let p = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  p = ease(Math.max(0, Math.min(1, p)));
  return {
    rs: lerp(a.p.rs, b.p.rs, p), re: lerp(a.p.re, b.p.re, p),
    ls: lerp(a.p.ls, b.p.ls, p), le: lerp(a.p.le, b.p.le, p)
  };
}
function arms(t, kf) {
  const a = armAnglesAt(t, kf);
  // micro-sway continuo p/ nunca ficar "congelado"
  const sway1 = 2.2 * Math.sin(2 * Math.PI * t / 3.5);
  const sway2 = 2.4 * Math.sin(2 * Math.PI * t / 3.1 + 1);
  return armChain(R_SH[0], R_SH[1], a.rs + sway1, a.re + sway2)
    + armChain(L_SH[0], L_SH[1], a.ls - sway1, a.le - sway2);
}

// ---------- corpo / antena / radar ----------
function body() {
  return '<line x1="110" y1="48" x2="110" y2="30" stroke="' + C + '" stroke-width="3" stroke-linecap="round"/>'
    + '<g transform="rotate(-32 110 26)">'
    + '<ellipse cx="110" cy="26" rx="13" ry="5.5" fill="' + DARK + '" stroke="' + C + '" stroke-width="2.5"/>'
    + '<line x1="110" y1="26" x2="110" y2="14" stroke="' + C + '" stroke-width="1.8" stroke-linecap="round"/>'
    + '<circle cx="110" cy="13" r="2.6" fill="' + C + '"/>'
    + '</g>'
    + '<circle cx="110" cy="112" r="64" fill="' + DARK + '" stroke="' + C + '" stroke-width="4"/>'
    + '<circle cx="110" cy="112" r="50" fill="' + SCR + '" stroke="' + C + '" stroke-opacity=".5" stroke-width="2"/>'
    + '<circle cx="110" cy="112" r="37" fill="none" stroke="' + C + '" stroke-opacity=".3" stroke-width="1.5"/>'
    + '<circle cx="110" cy="112" r="21" fill="none" stroke="' + C + '" stroke-opacity=".3" stroke-width="1.5"/>';
}
function sweep(ang) {
  const a = rad(ang), L = 46;
  const x = 110 + L * Math.sin(a), y = 112 - L * Math.cos(a);
  const x2 = 110 + L * Math.sin(a + 0.34), y2 = 112 - L * Math.cos(a + 0.34);
  return '<path d="M110,112 L' + f1(x) + ',' + f1(y) + ' L' + f1(x2) + ',' + f1(y2) + ' Z" fill="' + C + '" fill-opacity=".16"/>'
    + '<line x1="110" y1="112" x2="' + f1(x) + '" y2="' + f1(y) + '" stroke="' + C + '" stroke-opacity=".6" stroke-width="2"/>';
}

// ---------- expressoes (sobrancelha + olho) ----------
// arch = curvatura | tilt = inclinacao (graus, ponta externa) | by = deslocamento vertical
// eye = estilo do olho ('round' | 'happy') | es = escala do olho | asym = levantar so a direita (px)
const EXPR = {
  neutral: { arch: 2.5, tilt: 0,  by: 0,  eye: 'round', es: 1.0,  asym: 0 },
  raised:  { arch: 3.4, tilt: 2,  by: 4,  eye: 'round', es: 1.06, asym: 0 },
  happy:   { arch: 2.2, tilt: 0,  by: 3,  eye: 'happy', es: 1.0,  asym: 0 },
  curious: { arch: 2.0, tilt: 6,  by: 2,  eye: 'round', es: 1.02, asym: 5 },
  focused: { arch: 1.6, tilt: -5, by: -1, eye: 'round', es: 0.96, asym: 0 }
};
const EXPR_LIST = ['raised', 'happy', 'curious', 'focused', 'neutral'];

function brow(cx, byBase, arch, tilt) {
  const d = 'M' + f1(cx - 10) + ',' + f1(byBase) + ' Q' + f1(cx) + ',' + f1(byBase - arch) + ' ' + f1(cx + 10) + ',' + f1(byBase);
  return '<g transform="rotate(' + tilt.toFixed(2) + ' ' + f1(cx) + ' ' + f1(byBase) + ')"><path d="' + d + '" fill="none" stroke="' + C + '" stroke-width="2.6" stroke-linecap="round"/></g>';
}
function eyeRound(cx, eyeOpen, es) {
  const ry = Math.max(0.6, 9 * eyeOpen * es), rx = 9 * es, pry = Math.max(0, 4 * eyeOpen);
  let s = '<ellipse cx="' + cx + '" cy="109" rx="' + rx.toFixed(2) + '" ry="' + ry.toFixed(2) + '" fill="' + EYE + '"/>';
  if (pry > 0.2) s += '<ellipse cx="' + cx + '" cy="109" rx="4" ry="' + pry.toFixed(2) + '" fill="' + PUP + '"/>';
  if (eyeOpen > 0.5) s += '<circle cx="' + (cx - 4) + '" cy="105" r="2" fill="' + WHT + '"/>';
  return s;
}
function eyeHappy(cx, eyeOpen) {
  const depth = 6 * Math.max(0.25, eyeOpen);
  const d = 'M' + (cx - 8) + ',108 Q' + cx + ',' + f1(108 + depth) + ' ' + (cx + 8) + ',108';
  return '<path d="' + d + '" fill="none" stroke="' + EYE + '" stroke-width="3.4" stroke-linecap="round"/>';
}
function face(p, eyeOpen, browMicro) {
  const byBase = 93 - p.by - browMicro;
  let s = brow(92, byBase, p.arch, -p.tilt) + brow(128, byBase - p.asym, p.arch, p.tilt);
  if (p.eye === 'happy') {
    s += eyeHappy(92, eyeOpen) + eyeHappy(128, eyeOpen);
  } else {
    s += eyeRound(92, eyeOpen, p.es) + eyeRound(128, eyeOpen, p.es);
  }
  return s;
}
function mouth(opn, rnd) {
  const w = 14 - 5 * rnd, top = -4 * opn - 0.6 * rnd, up = top + 4, bot = 1 + 18 * opn - 3 * rnd;
  return '<g transform="translate(110,140)"><path d="M' + f1(-w) + ',' + f1(top) + ' Q0,' + f1(up) + ' ' + f1(w) + ',' + f1(top) + ' Q0,' + f1(bot) + ' ' + f1(-w) + ',' + f1(top) + ' Z" fill="' + C + '"/></g>';
}

// agenda de expressoes: troca SEMPRE num instante de piscada (olho fechado),
// entao a mudanca de estilo do olho nao "pula". A sobrancelha desliza suave.
function exprKeyframes(blinks) {
  const kf = [{ t: 0, name: 'neutral' }];
  let ei = 0;
  for (let k = 0; k < blinks.length; k++) {
    if (k % 2 === 1) { kf.push({ t: blinks[k], name: EXPR_LIST[ei % EXPR_LIST.length] }); ei++; }
  }
  return kf;
}
function exprAt(t, kf) {
  let i = 0;
  for (let k = 0; k < kf.length; k++) if (kf[k].t <= t) i = k;
  const cur = EXPR[kf[i].name];
  const prev = EXPR[kf[Math.max(0, i - 1)].name];
  const local = t - kf[i].t;
  const pe = ease(Math.max(0, Math.min(1, local / 0.5)));   // sobrancelha desliza em ~0.5s
  return {
    arch: lerp(prev.arch, cur.arch, pe),
    tilt: lerp(prev.tilt, cur.tilt, pe),
    by:   lerp(prev.by,   cur.by,   pe),
    asym: lerp(prev.asym, cur.asym, pe),
    eye:  cur.eye,   // estilo do olho troca no instante (durante a piscada)
    es:   cur.es
  };
}

function frameSVG(armsSvg, facePr, opn, rnd, eyeOpen, browMicro, bob, ang) {
  const inner = body() + sweep(ang) + armsSvg + face(facePr, eyeOpen, browMicro) + mouth(opn, rnd);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + VB + '"><g transform="translate(0,' + bob.toFixed(2) + ')">' + inner + '</g></svg>';
}

function envelopeFromWav(wavPath, fps) {
  const buf = fs.readFileSync(wavPath);
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
  fs.mkdirSync(outDir, { recursive: true });
  const env = envelopeFromWav(opts.wavPath, fps);
  const nf = env.length;
  const dur = nf / fps;

  const opn = new Array(nf); let prev = 0;
  for (let i = 0; i < nf; i++) { const tgt = env[i]; const k = tgt > prev ? 0.55 : 0.28; prev = prev + k * (tgt - prev); opn[i] = prev; }
  const rnd = opn.map(o => o > 0.2 ? Math.max(0, Math.min(1, (0.55 - o) * 1.3)) : 0);

  const armKf = armKeyframes(dur);
  const blinks = []; for (let tb = 1.4; tb < dur; tb += 3.0) blinks.push(tb);
  const eyeAt = t => { let e = 1; for (const tb of blinks) e = Math.min(e, 1 - Math.exp(-Math.pow((t - tb) / 0.07, 2))); return Math.max(0, e); };
  const exprKf = exprKeyframes(blinks);

  for (let i = 0; i < nf; i++) {
    const t = i / fps;
    const eyeOpen = eyeAt(t);
    const browMicro = 1.2 * opn[i] + 0.5 * Math.sin(2 * Math.PI * t / 4 + 1);
    const bob = 1.6 * Math.sin(2 * Math.PI * t / 3);
    const ang = (t * 72) % 360;
    const armsSvg = arms(t, armKf);
    const facePr = exprAt(t, exprKf);
    const svg = frameSVG(armsSvg, facePr, opn[i], rnd[i], eyeOpen, browMicro, bob, ang);
    const sp = path.join(outDir, 's_' + String(i).padStart(5, '0') + '.svg');
    const pp = path.join(outDir, 'av_' + String(i).padStart(5, '0') + '.png');
    fs.writeFileSync(sp, svg);
    execSync('rsvg-convert -w ' + width + ' ' + sp + ' -o ' + pp, { timeout: 30000 });
  }
  return nf;
}

module.exports = { renderFrames };
