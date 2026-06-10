// ai_radar/expr_track.js
// ESTAGIO 5 — conversor: (dicionario minerado + roteiro do video) -> rigTrack densa.
// A saida entra no avatar.js via opts.rigTrack: sobrepoe SO os canais de EXPRESSAO
// minerados (sobrancelha/olho/canto-da-boca/pupila). Cabeca, gestos, blink, gaze e
// o lip-sync continuam vindo das heuristicas/viseme do renderer (camadas separadas).
// Node puro, sem dependencias. Espelha a logica de tag.py do expression-lab.

// canais que o dicionario minera (centroides do cluster.py)
const EXPR_DIMS = ['brow_raise_L', 'brow_raise_R', 'brow_angle_L', 'brow_angle_R',
  'eye_smile', 'eye_squint', 'mouth_corner', 'pupil_dilate'];

const HOOK_KW = ['stop', 'wait', 'nobody', 'secret', 'truth', 'warning', 'never', 'most people',
  'did you know', 'the truth', "you won't believe", "here's why"];
const REVEAL_KW = ['actually', 'turns out', 'the real', 'in fact', "that's because", 'the reason',
  'what really', 'the catch'];
const PAYOFF_KW = ['so', "that's why", 'now you', 'next time', 'remember', 'follow', 'try it'];
const SUSPENSE_KW = ['but', 'however', 'until', 'then suddenly', 'what happened', 'dark', 'hidden'];
const NUM_RE = /\d/;

const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const lerp = (a, b, p) => a + (b - a) * p;

// quebra as palavras (WhisperX) em beats (frases) por pausa > gap
function beatsFromWords(words, gap) {
  gap = gap == null ? 0.35 : gap;
  const ws = (words || []).filter(w => w && w.start != null).slice().sort((a, b) => a.start - b.start);
  const beats = []; let cur = [], prevEnd = null;
  for (const w of ws) {
    if (prevEnd != null && (w.start - prevEnd) > gap && cur.length) { beats.push(cur); cur = []; }
    cur.push(w);
    prevEnd = (w.end != null ? w.end : w.start);
  }
  if (cur.length) beats.push(cur);
  return beats;
}

function classify(text, tStart, dur) {
  const low = ' ' + text.toLowerCase() + ' ';
  const pos = dur ? (tStart / dur) : 0;
  const has = arr => arr.some(k => low.indexOf(k) >= 0);
  if (pos < 0.15 && (has(HOOK_KW) || text.indexOf('?') >= 0)) return 'hook';
  if (pos < 0.12) return 'hook';
  if (NUM_RE.test(text)) return 'stat';
  if (has(REVEAL_KW)) return 'reveal';
  if (has(SUSPENSE_KW)) return 'suspense';
  if (pos > 0.82 || has(PAYOFF_KW)) return 'payoff';
  return 'default';
}

// roteiro -> [{t_start, t_end, cue, text}]
function tagBeats(words, dur) {
  const beats = beatsFromWords(words);
  if (dur == null) dur = beats.length ? (beats[beats.length - 1].slice(-1)[0].end || beats[beats.length - 1].slice(-1)[0].start) : 1;
  return beats.map(b => {
    const text = b.map(w => (w.word || '').trim()).join(' ').trim();
    const t0 = b[0].start, t1 = (b[b.length - 1].end != null ? b[b.length - 1].end : b[b.length - 1].start);
    return { t_start: t0, t_end: t1, cue: classify(text, t0, dur), text: text };
  });
}

// dict: expression_dict/<canal>.json (saida do build_dict.py).
// Retorna rigTrack densa (nf frames) com SO os canais minerados; null se sem dict.
function buildRigTrack(opts) {
  const dict = opts.dict, fps = opts.fps || 25, dur = opts.dur;
  if (!dict || !dict.by_cue) return null;
  const XF = opts.crossfade || 0.4; // suaviza a troca de cue (slow-in/out)
  const def = (dict.by_cue.default && dict.by_cue.default.target) || {};

  const beats = tagBeats(opts.words, dur);
  const kf = [{ t: 0, tgt: def }];
  for (const b of beats) {
    const entry = dict.by_cue[b.cue] || dict.by_cue.default;
    kf.push({ t: b.t_start, tgt: (entry && entry.target) ? entry.target : def });
  }

  const nf = Math.max(1, Math.round(dur * fps));
  const track = new Array(nf);
  for (let i = 0; i < nf; i++) {
    const t = i / fps;
    let idx = 0; for (let k = 0; k < kf.length; k++) if (kf[k].t <= t) idx = k;
    const cur = kf[idx].tgt, prev = kf[Math.max(0, idx - 1)].tgt;
    const p = ease(Math.max(0, Math.min(1, (t - kf[idx].t) / XF)));
    const o = {};
    for (const ch of EXPR_DIMS) {
      if (cur[ch] == null) continue;            // canal nao minerado -> deixa a heuristica do renderer
      const pv = (prev[ch] != null ? prev[ch] : cur[ch]);
      o[ch] = lerp(pv, cur[ch], p);
    }
    track[i] = o;
  }
  return track;
}

// helper: carrega o dict do canal por cor_legenda ('#00C2FF' -> expression_dict/00C2FF.json)
function loadDictForChannel(corLegenda, dir) {
  const fs = require('fs'); const path = require('path');
  if (!corLegenda) return null;
  const key = corLegenda.replace('#', '').toUpperCase();
  const fp = path.join(dir || path.join(__dirname, 'expression_dict'), key + '.json');
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return null; }
}

module.exports = { buildRigTrack, tagBeats, loadDictForChannel, EXPR_DIMS };
