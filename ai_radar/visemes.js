// ai_radar/visemes.js
// LIP-SYNC DE VISEME (estagio 3).
// Converte fonemas/visemes (de um aligner como o Rhubarb) numa TRACK densa por
// frame dos canais de boca do rig (mouth_open / mouth_round / mouth_width), com
// COARTICULACAO (suavizacao attack/release) p/ a boca nao "pular" entre formas.
// Entra no avatar.js pela porta de track (opts.visemes) e substitui a boca por
// amplitude quando presente. Sem dependencias externas.

// Rhubarb (Preston Blair) A-H, X -> canais de boca do rig
const SHAPES = {
  A: { mouth_open: 0.00, mouth_round: 0.00, mouth_width: 0.50 }, // M B P (fechada)
  B: { mouth_open: 0.25, mouth_round: 0.00, mouth_width: 0.80 }, // EE / consoantes
  C: { mouth_open: 0.55, mouth_round: 0.10, mouth_width: 0.70 }, // E / AE
  D: { mouth_open: 1.00, mouth_round: 0.10, mouth_width: 0.70 }, // AA (aberta)
  E: { mouth_open: 0.40, mouth_round: 0.60, mouth_width: 0.35 }, // AO / ER (arredondada)
  F: { mouth_open: 0.30, mouth_round: 1.00, mouth_width: 0.20 }, // UW / OW / W (bico)
  G: { mouth_open: 0.15, mouth_round: 0.00, mouth_width: 0.60 }, // F V (dentes)
  H: { mouth_open: 0.40, mouth_round: 0.10, mouth_width: 0.60 }, // L
  X: { mouth_open: 0.05, mouth_round: 0.00, mouth_width: 0.50 }  // descanso
};
// nomes do conjunto do schema tambem aceitos
const ALIASES = { A_closed_MBP: 'A', B_EE: 'B', C_AA: 'D', D_O: 'E', E_U_W: 'F', F_FV: 'G', G_L: 'H', H_rest: 'X' };
function shapeOf(v) { if (SHAPES[v]) return SHAPES[v]; const a = ALIASES[v]; return SHAPES[a] || SHAPES.X; }

// Rhubarb JSON: { mouthCues: [{ start, end, value }] } -> [{start,end,shape}]
function parseRhubarb(obj) {
  const cues = (obj && obj.mouthCues) ? obj.mouthCues : [];
  return cues.map(c => ({ start: +c.start, end: +c.end, shape: c.value }));
}

// cues: [{start,end,shape}] -> track densa de nf frames
function buildVisemeTrack(cues, fps, dur) {
  const nf = Math.max(1, Math.round(dur * fps));
  const to = new Array(nf), tr = new Array(nf), tw = new Array(nf);
  let ci = 0;
  for (let i = 0; i < nf; i++) {
    const t = i / fps;
    while (ci < cues.length - 1 && t >= cues[ci].end) ci++;
    let sh = SHAPES.X;
    if (cues.length) {
      const c = cues[ci];
      sh = (t >= c.start && t < c.end) ? shapeOf(c.shape) : (t < cues[0].start ? SHAPES.X : shapeOf(c.shape));
    }
    to[i] = sh.mouth_open; tr[i] = sh.mouth_round; tw[i] = sh.mouth_width;
  }
  // coarticulacao: attack/release (slow-in/out) p/ transicoes suaves
  const smooth = (arr, kUp, kDn) => { let p = arr[0] || 0; for (let i = 0; i < arr.length; i++) { const k = arr[i] > p ? kUp : kDn; p = p + k * (arr[i] - p); arr[i] = p; } return arr; };
  smooth(to, 0.55, 0.30); smooth(tr, 0.45, 0.30); smooth(tw, 0.45, 0.35);
  const track = new Array(nf);
  for (let i = 0; i < nf; i++) track[i] = { mouth_open: to[i], mouth_round: tr[i], mouth_width: tw[i] };
  return track;
}

module.exports = { buildVisemeTrack, parseRhubarb, shapeOf, SHAPES };
