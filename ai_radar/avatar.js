const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---- paleta / constantes do desenho (inalteradas) ----
const C = '#00C2FF', EYE = '#EAF6FF', PUP = '#06182A', WHT = '#FFFFFF';
const VB = '-20 0 260 224';
const rad = d => d * Math.PI / 180;
const f1 = n => n.toFixed(1);
const f2 = n => n.toFixed(2);
const lerp = (a, b, p) => a + (b - a) * p;
const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const FR = 40;
const THETA_MAX = rad(8);

// ============================================================
// RIG: a camada de controle. Cada canal = um "botao" continuo.
// O DESENHO le estes valores; os DRIVERS (schedule, audio, springs)
// escrevem neles. Contrato completo em avatar_rig.schema.json.
// ============================================================
const REST = {
  mouth_open: 0, mouth_round: 0, mouth_width: 0.5, mouth_corner: 0,
  eye_open_L: 1, eye_open_R: 1, eye_smile: 0, eye_squint: 0, pupil_dilate: 0.5, gaze_x: 0, gaze_y: 0,
  brow_raise_L: 0.25, brow_raise_R: 0.25, brow_angle_L: 0, brow_angle_R: 0, brow_micro: 0,
  head_yaw: 0, head_pitch: 0, head_roll: 0,
  body_bob: 0, body_squash: 0,
  armR_raise: 0, armR_extend: 0, armL_raise: 0, armL_extend: 0, hand_open_R: 0.5, hand_open_L: 0.5,
  radar_sweep: 0, dish_tilt: 0
};
function rigRest() { return Object.assign({}, REST); }

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

// ---------- braco parametrico ----------
const UP_LEN = 24, FORE_LEN = 22;
function armChain(sx, sy, shAng, elAng, handOpen) {
  const sa = rad(shAng), ea = rad(elAng);
  const ex = sx + UP_LEN * Math.cos(sa), ey = sy + UP_LEN * Math.sin(sa);
  const wx = ex + FORE_LEN * Math.cos(ea), wy = ey + FORE_LEN * Math.sin(ea);
  const arm = '<path d="M' + f1(sx) + ',' + f1(sy) + ' Q' + f1(ex) + ',' + f1(ey) + ' ' + f1(wx) + ',' + f1(wy) + '" fill="none" stroke="' + C + '" stroke-width="3.2" stroke-linecap="round"/>';
  const spread = lerp(10, 58, clamp(handOpen, 0, 1));
  return arm + hand(wx, wy, elAng, 20, spread);
}
const R_SH = [166, 150], L_SH = [54, 150];

// raise/extend normalizados (0..1) -> angulos (idle -> elevado), faixas das poses originais.
// Mascote no canto esq.: braco direito gesticula pra direita; esquerdo descansa recolhido.
function armsSvg(r) {
  const shR = lerp(84, -24, clamp(r.armR_raise, 0, 1));
  const elR = lerp(96, -28, clamp(r.armR_extend, 0, 1));
  const shL = lerp(96, 250, clamp(r.armL_raise, 0, 1));
  const elL = lerp(84, 258, clamp(r.armL_extend, 0, 1));
  return armChain(R_SH[0], R_SH[1], shR, elR, r.hand_open_R)
    + armChain(L_SH[0], L_SH[1], shL, elL, r.hand_open_L);
}

// ---------- defs (gradientes 3D) ----------
function defs() {
  return '<defs>'
    + '<radialGradient id="dome" cx="85" cy="86" r="115" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1b4a66"/><stop offset="0.45" stop-color="#0e2d42"/><stop offset="1" stop-color="#061521"/></radialGradient>'
    + '<linearGradient id="rim" x1="110" y1="44" x2="110" y2="182" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7fe8ff"/><stop offset="0.5" stop-color="#16a6d8"/><stop offset="1" stop-color="#0b6f96"/></linearGradient>'
    + '<radialGradient id="eyeg" cx="0" cy="0" r="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#bfe2f2"/></radialGradient>'
    + '<filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>'
    + '</defs>';
}

// ---------- corpo / antena / radar ----------
function body(dishTilt) {
  const dishRot = -32 + clamp(dishTilt, -1, 1) * 16; // tilt da parabolica (follow-through)
  return '<ellipse cx="110" cy="184" rx="50" ry="11" fill="#000000" fill-opacity="0.42" filter="url(#soft)"/>'
    + '<line x1="110" y1="48" x2="110" y2="30" stroke="' + C + '" stroke-width="3" stroke-linecap="round"/>'
    + '<g transform="rotate(' + f1(dishRot) + ' 110 26)">'
    + '<ellipse cx="110" cy="26" rx="13" ry="5.5" fill="#0e2d42" stroke="url(#rim)" stroke-width="2.5"/>'
    + '<line x1="110" y1="26" x2="110" y2="14" stroke="' + C + '" stroke-width="1.8" stroke-linecap="round"/>'
    + '<circle cx="110" cy="13" r="2.6" fill="' + C + '"/>'
    + '</g>'
    + '<circle cx="110" cy="112" r="64" fill="url(#dome)" stroke="url(#rim)" stroke-width="5"/>'
    + '<circle cx="110" cy="112" r="50" fill="none" stroke="' + C + '" stroke-opacity=".22" stroke-width="1.5"/>'
    + '<circle cx="110" cy="112" r="37" fill="none" stroke="' + C + '" stroke-opacity=".18" stroke-width="1.3"/>'
    + '<circle cx="110" cy="112" r="21" fill="none" stroke="' + C + '" stroke-opacity=".16" stroke-width="1.2"/>'
    + '<path d="M168,128 A64,64 0 0 1 52,128" fill="none" stroke="#04101a" stroke-opacity="0.45" stroke-width="7" stroke-linecap="round"/>';
}
function sweep(ang) {
  const a = rad(ang), L = 46;
  const x = 110 + L * Math.sin(a), y = 112 - L * Math.cos(a);
  const x2 = 110 + L * Math.sin(a + 0.34), y2 = 112 - L * Math.cos(a + 0.34);
  return '<path d="M110,112 L' + f1(x) + ',' + f1(y) + ' L' + f1(x2) + ',' + f1(y2) + ' Z" fill="' + C + '" fill-opacity=".16"/>'
    + '<line x1="110" y1="112" x2="' + f1(x) + '" y2="' + f1(y) + '" stroke="' + C + '" stroke-opacity=".6" stroke-width="2"/>';
}

// ---------- feicoes (leem o rig) ----------
function brow(cx, byBase, arch, tilt, fx) {
  fx = fx || 1; const hw = 10 * fx;
  const d = 'M' + f1(cx - hw) + ',' + f1(byBase) + ' Q' + f1(cx) + ',' + f1(byBase - arch) + ' ' + f1(cx + hw) + ',' + f1(byBase);
  return '<g transform="rotate(' + tilt.toFixed(2) + ' ' + f1(cx) + ' ' + f1(byBase) + ')"><path d="' + d + '" fill="none" stroke="' + C + '" stroke-width="2.6" stroke-linecap="round"/></g>';
}
function eyeRound(cx, eyeOpen, es, fx, r) {
  fx = fx || 1;
  const ry = Math.max(0.6, 9 * eyeOpen * es), rx = 9 * es * fx;
  const cxs = f2(cx);
  const dil = lerp(0.8, 1.5, clamp(r.pupil_dilate, 0, 1));
  const gx = clamp(r.gaze_x, -1, 1) * 3.2 * fx, gy = clamp(r.gaze_y, -1, 1) * 2.6;
  let s = '<ellipse cx="' + cxs + '" cy="109" rx="' + f2(rx) + '" ry="' + f2(ry) + '" fill="url(#eyeg)"/>';
  s += '<ellipse cx="' + cxs + '" cy="109" rx="' + f2(rx) + '" ry="' + f2(ry) + '" fill="none" stroke="#8fd6f0" stroke-opacity="0.5" stroke-width="0.8"/>';
  const pry = Math.max(0, 4.5 * eyeOpen) * dil;
  if (pry > 0.2) {
    const prx = 4 * fx * dil;
    s += '<ellipse cx="' + f2(cx + gx) + '" cy="' + f2(109.5 + gy) + '" rx="' + f2(prx) + '" ry="' + f2(pry) + '" fill="' + PUP + '"/>';
  }
  if (eyeOpen > 0.5) s += '<circle cx="' + f2(cx - 3.5 * fx + gx) + '" cy="' + f2(105.5 + gy) + '" r="2.4" fill="' + WHT + '"/>';
  return s;
}
function eyeHappy(cx, eyeOpen, fx) {
  fx = fx || 1; const w = 8 * fx;
  const depth = 6 * Math.max(0.25, eyeOpen);
  const d = 'M' + (cx - w).toFixed(2) + ',108 Q' + cx.toFixed(2) + ',' + f1(108 + depth) + ' ' + (cx + w).toFixed(2) + ',108';
  return '<path d="' + d + '" fill="none" stroke="' + EYE + '" stroke-width="3.4" stroke-linecap="round"/>';
}
function mouth(r, cx, fx) {
  cx = (cx == null ? 110 : cx); fx = fx || 1;
  const opn = clamp(r.mouth_open, 0, 1), rnd = clamp(r.mouth_round, 0, 1), corner = clamp(r.mouth_corner, -1, 1);
  const w = (14 - 5 * rnd) * lerp(0.85, 1.05, clamp(r.mouth_width, 0, 1));
  const top = -4 * opn - 0.6 * rnd, up = top + 4, bot = 1 + 18 * opn - 3 * rnd;
  const cl = -corner * 5; // sorriso (+) sobe os cantos; desgosto (-) abaixa
  return '<g transform="translate(' + f2(cx) + ',140) scale(' + f2(fx) + ',1)"><path d="M' + f1(-w) + ',' + f1(top + cl) + ' Q0,' + f1(up) + ' ' + f1(w) + ',' + f1(top + cl) + ' Q0,' + f1(bot) + ' ' + f1(-w) + ',' + f1(top + cl) + ' Z" fill="' + C + '"/></g>';
}

function face(r) {
  const yaw = clamp(r.head_yaw, -1, 1);
  const theta = yaw * THETA_MAX;
  const proj = off => { const phi = Math.asin(off / FR); return { x: 110 + FR * Math.sin(phi + theta), s: Math.cos(phi + theta) / Math.cos(phi) }; };
  const le = proj(-18), re = proj(18), mo = proj(0);
  const bm = r.brow_micro;
  const byL = 93 - clamp(r.brow_raise_L, 0, 1) * 14 - bm;
  const byR = 93 - clamp(r.brow_raise_R, 0, 1) * 14 - bm;
  const archL = lerp(1.5, 3.8, clamp(r.brow_raise_L, 0, 1));
  const archR = lerp(1.5, 3.8, clamp(r.brow_raise_R, 0, 1));
  const tiltL = -clamp(r.brow_angle_L, -1, 1) * 8;
  const tiltR = clamp(r.brow_angle_R, -1, 1) * 8;
  let s = brow(le.x, byL, archL, tiltL, le.s) + brow(re.x, byR, archR, tiltR, re.s);
  const sq = clamp(r.eye_squint, 0, 1);
  const oL = clamp(r.eye_open_L, 0, 1) * (1 - 0.55 * sq);
  const oR = clamp(r.eye_open_R, 0, 1) * (1 - 0.55 * sq);
  const smile = clamp(r.eye_smile, 0, 1);
  if (smile < 0.98) s += '<g opacity="' + f2(1 - smile) + '">' + eyeRound(le.x, oL, 1.0, le.s, r) + eyeRound(re.x, oR, 1.0, re.s, r) + '</g>';
  if (smile > 0.02) s += '<g opacity="' + f2(smile) + '">' + eyeHappy(le.x, Math.max(oL, 0.3), le.s) + eyeHappy(re.x, Math.max(oR, 0.3), re.s) + '</g>';
  s += mouth(r, mo.x, mo.s);
  return s;
}

function frameSVG(r) {
  const bob = r.body_bob;
  const squash = clamp(r.body_squash, -1, 1);
  const sY = 1 + squash * 0.16, sX = 1 - squash * 0.10;
  const roll = clamp(r.head_roll, -1, 1) * 8;
  const pitch = clamp(r.head_pitch, -1, 1) * 6;
  const inner = body(r.dish_tilt) + sweep(r.radar_sweep) + armsSvg(r);
  const faceG = '<g transform="rotate(' + f2(roll) + ' 110 112) translate(0 ' + f2(pitch) + ')">' + face(r) + '</g>';
  const bodyG = '<g transform="translate(0 ' + f2(bob) + ') translate(110 176) scale(' + f2(sX) + ' ' + f2(sY) + ') translate(-110 -176)">' + inner + faceG + '</g>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + VB + '">' + defs() + bodyG + '</svg>';
}

// ============================================================
// DRIVERS
// ============================================================
// Presets de expressao em ESPACO DO RIG (alvos, nao "trocas de cara").
const EXPR_RIG = {
  neutral: { brow_raise_L: 0.25, brow_raise_R: 0.25, brow_angle_L: 0, brow_angle_R: 0, eye_smile: 0, eye_squint: 0, mouth_corner: 0, pupil_dilate: 0.5, head_roll: 0, body_squash: 0 },
  raised:  { brow_raise_L: 0.9, brow_raise_R: 0.9, brow_angle_L: 0.2, brow_angle_R: 0.2, eye_smile: 0, eye_squint: 0, mouth_corner: 0.1, pupil_dilate: 0.9, head_roll: 0, body_squash: -0.12 },
  happy:   { brow_raise_L: 0.4, brow_raise_R: 0.4, brow_angle_L: 0, brow_angle_R: 0, eye_smile: 0.9, eye_squint: 0.1, mouth_corner: 0.8, pupil_dilate: 0.5, head_roll: 0.05, body_squash: 0.05 },
  curious: { brow_raise_L: 0.35, brow_raise_R: 0.65, brow_angle_L: 0.1, brow_angle_R: 0.35, eye_smile: 0, eye_squint: 0.1, mouth_corner: 0.1, pupil_dilate: 0.55, head_roll: 0.3, body_squash: 0 },
  focused: { brow_raise_L: 0.1, brow_raise_R: 0.1, brow_angle_L: -0.45, brow_angle_R: -0.45, eye_smile: 0, eye_squint: 0.45, mouth_corner: -0.05, pupil_dilate: 0.45, head_roll: -0.05, body_squash: 0 }
};
const GEST_RIG = {
  idle:  { armR_raise: 0, armR_extend: 0, hand_open_R: 0.5 },
  wave:  { armR_raise: 0.95, armR_extend: 1.0, hand_open_R: 0.9 },
  point: { armR_raise: 0.98, armR_extend: 0.95, hand_open_R: 0.1 },
  open:  { armR_raise: 0.6, armR_extend: 0.72, hand_open_R: 1.0 }
};
const EXPR_KEYS = ['brow_raise_L', 'brow_raise_R', 'brow_angle_L', 'brow_angle_R', 'eye_smile', 'eye_squint', 'mouth_corner', 'pupil_dilate', 'head_roll', 'body_squash'];
// canais que um TRACK (viseme estagio 3 / dicionario minerado estagio 5) sobrepoe DIRETO no frame.
// canais com mola (head_pitch/yaw/roll, armR_*) sao tratados ajustando o ALVO antes da mola.
const DIRECT_TR = ['brow_raise_L', 'brow_raise_R', 'brow_angle_L', 'brow_angle_R', 'eye_smile', 'eye_squint', 'mouth_corner', 'pupil_dilate', 'gaze_x', 'gaze_y', 'mouth_open', 'mouth_round', 'mouth_width', 'hand_open_R'];
function blendExpr(a, b, p) {
  const o = {};
  for (const k of EXPR_KEYS) o[k] = lerp(a[k] != null ? a[k] : REST[k], b[k] != null ? b[k] : REST[k], p);
  return o;
}
function exprTargetAt(t, eKf) {
  let i = 0; for (let k = 0; k < eKf.length; k++) if (eKf[k].t <= t) i = k;
  const cur = EXPR_RIG[eKf[i].name] || EXPR_RIG.neutral;
  const prev = EXPR_RIG[eKf[Math.max(0, i - 1)].name] || EXPR_RIG.neutral;
  const pe = ease(clamp((t - eKf[i].t) / 0.5, 0, 1));
  return blendExpr(prev, cur, pe);
}
function gestTargetAt(t, gKf) {
  let i = 0; for (let k = 0; k < gKf.length; k++) if (gKf[k].t <= t) i = k;
  const cur = GEST_RIG[gKf[i].name] || GEST_RIG.idle;
  const prev = GEST_RIG[gKf[Math.max(0, i - 1)].name] || GEST_RIG.idle;
  const pe = ease(clamp((t - gKf[i].t) / 0.45, 0, 1));
  return {
    armR_raise: lerp(prev.armR_raise, cur.armR_raise, pe),
    armR_extend: lerp(prev.armR_extend, cur.armR_extend, pe),
    hand_open_R: lerp(prev.hand_open_R, cur.hand_open_R, pe)
  };
}

// Agenda dirigida pelo roteiro (tempos das palavras do WhisperX).
function buildSchedule(words, dur) {
  const GAP = 0.35, beats = []; let prevEnd = -99;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]; if (w.start == null) continue;
    if (i === 0 || (w.start - prevEnd) > GAP) beats.push(w.start);
    prevEnd = (w.end != null ? w.end : w.start);
  }
  const GSEQ = ['wave', 'point', 'open'], ESEQ = ['curious', 'focused', 'neutral', 'raised'];
  const eKf = [{ t: 0, name: 'neutral' }], gKf = [{ t: 0, name: 'idle' }]; let blinks = [];
  let gi = 0, lastG = -99;
  for (let b = 0; b < beats.length; b++) {
    const t = beats[b]; let name;
    if (b === 0) name = 'raised'; else if (t > dur * 0.80) name = 'happy'; else name = ESEQ[b % ESEQ.length];
    eKf.push({ t: t, name: name }); blinks.push(t);
    if (t - lastG > 2.3) {
      const g = (b === 0) ? 'wave' : GSEQ[gi % GSEQ.length]; gi++;
      gKf.push({ t: Math.max(0.01, t - 0.05), name: 'idle' });
      gKf.push({ t: t + 0.45, name: g });
      gKf.push({ t: t + 1.40, name: g });
      gKf.push({ t: t + 1.90, name: 'idle' });
      lastG = t;
    }
  }
  gKf.push({ t: dur + 1, name: 'idle' });
  const nods = []; let lastN = -99;
  for (const w of words) {
    if (w.start == null) continue;
    const len = (w.word || '').trim().length;
    const long = len >= 7 || ((w.end != null ? w.end : w.start) - w.start) >= 0.45;
    if (long && (w.start - lastN) > 1.6) { nods.push(w.start); lastN = w.start; }
  }
  for (let tb = 1.4; tb < dur; tb += 3.0) blinks.push(tb);
  blinks.sort((a, b) => a - b);
  const dedup = [];
  for (const tb of blinks) if (!dedup.length || tb - dedup[dedup.length - 1] > 0.45) dedup.push(tb);
  return { eKf: eKf, gKf: gKf, blinks: dedup, nods: nods };
}
function buildScheduleFallback(dur) {
  const eKf = [{ t: 0, name: 'neutral' }], gKf = [{ t: 0, name: 'idle' }]; let blinks = [];
  for (let tb = 1.4; tb < dur; tb += 3.0) blinks.push(tb);
  const ESEQ = ['neutral', 'curious', 'focused', 'raised']; let ei = 0;
  for (let k = 0; k < blinks.length; k++) if (k % 2 === 1) { eKf.push({ t: blinks[k], name: ESEQ[ei % ESEQ.length] }); ei++; }
  const GSEQ = ['wave', 'point', 'open']; let tt = 2.5, gi = 0;
  while (tt < dur) {
    gKf.push({ t: tt, name: 'idle' });
    gKf.push({ t: tt + 0.55, name: GSEQ[gi % GSEQ.length] });
    gKf.push({ t: tt + 1.7, name: GSEQ[gi % GSEQ.length] });
    gKf.push({ t: tt + 2.3, name: 'idle' });
    tt += 4.6; gi++;
  }
  gKf.push({ t: dur + 1, name: 'idle' });
  blinks.sort((a, b) => a - b);
  return { eKf: eKf, gKf: gKf, blinks: blinks, nods: [] };
}

// virada de cabeca ocasional (alvo p/ a mola)
function headYaw(t) {
  const PERIOD = 7.0, MAG = 0.6, START = 1.2, IN = 0.5, HOLD = 0.6, OUT = 0.7;
  const idx = Math.floor(t / PERIOD), local = t - idx * PERIOD, dir = (idx % 2 === 0) ? 1 : -1;
  let e = 0;
  if (local >= START && local < START + IN) e = ease((local - START) / IN);
  else if (local >= START + IN && local < START + IN + HOLD) e = 1;
  else if (local >= START + IN + HOLD && local < START + IN + HOLD + OUT) e = 1 - ease((local - START - IN - HOLD) / OUT);
  return dir * MAG * e;
}
// nod = alvo de pitch durante a palavra enfatizada; a mola gera o "balanco" com overshoot
function nodTarget(t, nods) {
  if (!nods) return 0;
  for (const tn of nods) if (t >= tn && t < tn + 0.22) return 0.7;
  return 0;
}
// micro-saccades + leve deriva do olhar (vida de fundo)
function gazeAt(t, eKf) {
  let gx = 0.10 * Math.sin(2 * Math.PI * t / 5.3), gy = 0.06 * Math.sin(2 * Math.PI * t / 6.7 + 1);
  for (let b = 0; b < eKf.length; b++) {
    const x = t - eKf[b].t;
    if (x >= 0 && x < 0.6) { const dir = ((b * 37) % 7 - 3) / 3; gx += dir * 0.22 * (1 - x / 0.6); }
  }
  return { x: clamp(gx, -1, 1), y: clamp(gy, -1, 1) };
}

// ---------- camada de PRINCIPIOS: mola amortecida (overshoot/lag) ----------
function springTrack(targets, fps, omega, zeta) {
  const dt = 1 / fps, n = targets.length, out = new Array(n);
  let x = targets[0] || 0, v = 0;
  for (let i = 0; i < n; i++) {
    const a = omega * omega * (targets[i] - x) - 2 * zeta * omega * v;
    v += a * dt; x += v * dt; out[i] = x;
  }
  return out;
}

// ---------- audio -> envelope (boca por amplitude; viseme entra no estagio 3) ----------
function envelopeFromWav(wavPath, fps) {
  const buf = fs.readFileSync(wavPath);
  let off = 12, sr = buf.readUInt32LE(24), dataOff = 44, dataLen = buf.length - 44;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(off + 12);
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  const nSamp = Math.floor(dataLen / 2), total = nSamp / sr;
  const nf = Math.max(1, Math.round(total * fps)), win = Math.floor(sr / fps);
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
  const fps = opts.fps || 25, width = opts.width || 720, outDir = opts.outDir;
  fs.mkdirSync(outDir, { recursive: true });
  const env = envelopeFromWav(opts.wavPath, fps);
  const nf = env.length, dur = nf / fps;

  // boca por amplitude
  const opn = new Array(nf); let prev = 0;
  for (let i = 0; i < nf; i++) { const tgt = env[i], k = tgt > prev ? 0.55 : 0.28; prev = prev + k * (tgt - prev); opn[i] = prev; }
  const rndArr = opn.map(o => o > 0.2 ? clamp((0.55 - o) * 1.3, 0, 1) : 0);

  const sch = (opts.words && opts.words.length) ? buildSchedule(opts.words, dur) : buildScheduleFallback(dur);
  const eKf = sch.eKf, gKf = sch.gKf, blinks = sch.blinks, nods = sch.nods;

  // PORTA DE TRACK (opt-in, retrocompativel):
  // - opts.visemes: cues de fonema (estagio 3) -> track densa de boca (substitui amplitude).
  // - opts.rigTrack: track densa por frame de canais de rig (estagio 5, dicionario minerado).
  let visTrack = null;
  if (opts.visemes && opts.visemes.length) {
    try { visTrack = require('./visemes').buildVisemeTrack(opts.visemes, fps, dur); } catch (e) { visTrack = null; }
  }
  const rigTrack = (opts.rigTrack && opts.rigTrack.length) ? opts.rigTrack : null;
  const eyeAt = t => { let e = 1; for (const tb of blinks) e = Math.min(e, 1 - Math.exp(-Math.pow((t - tb) / 0.07, 2))); return Math.max(0, e); };

  // passo 1: amostra os ALVOS por frame
  const Tp = new Array(nf), Ty = new Array(nf), Tr = new Array(nf), TaR = new Array(nf), TeR = new Array(nf);
  const frameRig = new Array(nf);
  for (let i = 0; i < nf; i++) {
    const t = i / fps;
    const ex = exprTargetAt(t, eKf), ge = gestTargetAt(t, gKf), gz = gazeAt(t, eKf), eo = eyeAt(t);
    const r = rigRest();
    r.brow_raise_L = ex.brow_raise_L; r.brow_raise_R = ex.brow_raise_R;
    r.brow_angle_L = ex.brow_angle_L; r.brow_angle_R = ex.brow_angle_R;
    r.eye_smile = ex.eye_smile; r.eye_squint = ex.eye_squint;
    r.mouth_corner = ex.mouth_corner; r.pupil_dilate = ex.pupil_dilate; r.body_squash = ex.body_squash;
    r.mouth_open = opn[i]; r.mouth_round = rndArr[i];
    r.eye_open_L = eo; r.eye_open_R = eo;
    r.gaze_x = gz.x; r.gaze_y = gz.y;
    r.brow_micro = 1.2 * opn[i] + 0.5 * Math.sin(2 * Math.PI * t / 4 + 1);
    r.body_bob = 1.6 * Math.sin(2 * Math.PI * t / 3);
    r.radar_sweep = (t * 72) % 360;
    r.hand_open_R = ge.hand_open_R;
    Tp[i] = nodTarget(t, nods); Ty[i] = headYaw(t); Tr[i] = ex.head_roll;
    TaR[i] = ge.armR_raise; TeR[i] = ge.armR_extend;
    // sobreposicao por TRACK (se houver): boca por viseme + canais minerados
    if (visTrack && visTrack[i]) { r.mouth_open = visTrack[i].mouth_open; r.mouth_round = visTrack[i].mouth_round; r.mouth_width = visTrack[i].mouth_width; }
    if (rigTrack && rigTrack[i]) {
      const k = rigTrack[i];
      for (let d = 0; d < DIRECT_TR.length; d++) { const ch = DIRECT_TR[d]; if (k[ch] != null) r[ch] = k[ch]; }
      if (k.head_pitch != null) Tp[i] = k.head_pitch;
      if (k.head_yaw != null) Ty[i] = k.head_yaw;
      if (k.head_roll != null) Tr[i] = k.head_roll;
      if (k.armR_raise != null) TaR[i] = k.armR_raise;
      if (k.armR_extend != null) TeR[i] = k.armR_extend;
    }
    frameRig[i] = r;
  }
  // passo 2: aplica molas (overshoot na cabeca/bracos; antena segue a cabeca com atraso)
  const spP = springTrack(Tp, fps, 16, 0.45);
  const spY = springTrack(Ty, fps, 12, 0.50);
  const spR = springTrack(Tr, fps, 14, 0.55);
  const spAR = springTrack(TaR, fps, 13, 0.50);
  const spER = springTrack(TeR, fps, 13, 0.50);
  const spDish = springTrack(spY, fps, 9, 0.70);
  for (let i = 0; i < nf; i++) {
    const r = frameRig[i];
    r.head_pitch = spP[i]; r.head_yaw = spY[i]; r.head_roll = spR[i];
    r.armR_raise = spAR[i]; r.armR_extend = spER[i]; r.dish_tilt = spDish[i];
  }
  // passo 3: render
  for (let i = 0; i < nf; i++) {
    const svg = frameSVG(frameRig[i]);
    const sp = path.join(outDir, 's_' + String(i).padStart(5, '0') + '.svg');
    const pp = path.join(outDir, 'av_' + String(i).padStart(5, '0') + '.png');
    fs.writeFileSync(sp, svg);
    execSync('rsvg-convert -w ' + width + ' ' + sp + ' -o ' + pp, { timeout: 30000 });
  }
  return nf;
}

module.exports = { renderFrames };
