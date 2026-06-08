const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

const WORK_DIR = '/opt/video-pipeline/temp';
const OUTPUT_DIR = '/opt/video-pipeline/output';

// ============================================================
// END CARD POR CANAL (feature flag)
// ------------------------------------------------------------
// Nos ultimos ~1,5s o video escurece e aparece o nome do canal +
// CTA neutro (sem "follow"/"subscribe", funciona nas 3 plataformas).
// Trocar END_CARD para false desliga em todos os canais (reversao
// total em uma linha). O canal e identificado pela cor da legenda,
// entao nao depende de mudancas nos workflows do n8n.
// ============================================================
const END_CARD = true;

// Fonte de display do end card (instalada na VPS). Independe da fonte
// das legendas — usada so no card final.
const END_CARD_FONT = '/usr/share/fonts/truetype/custom/Anton-Regular.ttf';
const END_CARD_DUR = 1.5; // segundos de exibicao no fim

// Cor em formato ffmpeg (0xRRGGBB). Chave = cor_legenda (igual a planilha).
const END_CARDS = {
  '#00C2FF': { nome: 'AI Radar',     cta: 'More AI tools daily', cor: '0x00C2FF' },
  '#FFD400': { nome: 'Hidden Facts', cta: 'More facts daily',    cor: '0xFFD400' }
};

function getEndCard(corLegenda) {
  if (!END_CARD) return null;
  const key = (corLegenda || '').toUpperCase().trim();
  return END_CARDS[key] || null;
}

// Monta os filtros de end card para o -vf. Retorna '' se nao aplicavel.
function buildEndCardVf(corLegenda, dur) {
  const ec = getEndCard(corLegenda);
  if (!ec) return '';
  if (!dur || isNaN(dur)) return '';
  const start = Math.max(0, dur - END_CARD_DUR).toFixed(2);
  const en = "enable='gte(t," + start + ")'";
  return ',drawbox=x=0:y=0:w=iw:h=ih:color=black@0.65:t=fill:' + en +
         ',drawbox=x=(w-160)/2:y=720:w=160:h=8:color=' + ec.cor + ':t=fill:' + en +
         ',drawtext=fontfile=' + END_CARD_FONT + ":text='" + ec.nome + "':fontcolor=white:fontsize=110:x=(w-text_w)/2:y=800:" + en +
         ',drawtext=fontfile=' + END_CARD_FONT + ":text='" + ec.cta + "':fontcolor=" + ec.cor + ':fontsize=46:x=(w-text_w)/2:y=965:' + en;
}

// ============================================================
// BRAND BUG (feature flag)
// ------------------------------------------------------------
// Nome do canal, pequeno, no canto superior esquerdo, nos primeiros
// segundos — pra quem sai cedo ja ter visto a marca, sem atrasar o
// hook. Reaproveita nome/cor de END_CARDS. false desliga.
// ============================================================
const BRAND_BUG = true;
const BRAND_BUG_DUR = 3.0;       // segundos no inicio (janela total do pisca)
const BRAND_BUG_PISCA = true;    // true = piscando | false = estatico
const BRAND_BUG_CICLO = 0.8;     // duracao de cada ciclo de pisca (segundos)
const BRAND_BUG_ACESO = 0.4;     // quanto do ciclo fica aceso (segundos)

function buildBrandBugVf(corLegenda) {
  if (!BRAND_BUG) return '';
  const key = (corLegenda || '').toUpperCase().trim();
  const ec = END_CARDS[key];
  if (!ec) return '';
  const janela = 'lte(t,' + BRAND_BUG_DUR.toFixed(1) + ')';
  const en = BRAND_BUG_PISCA
    ? "enable='" + janela + '*lt(mod(t,' + BRAND_BUG_CICLO.toFixed(2) + '),' + BRAND_BUG_ACESO.toFixed(2) + ")'"
    : "enable='" + janela + "'";
  return ',drawtext=fontfile=' + END_CARD_FONT + ":text='" + ec.nome + "':fontcolor=" + ec.cor + ':fontsize=44:box=1:boxcolor=black@0.5:boxborderw=18:x=48:y=90:' + en;
}

// ============================================================
// AVATAR / MASCOTE (feature flag)
// ------------------------------------------------------------
// Mascote do canal narrando com lip-sync no canto inferior esquerdo.
// Camadas (PNG transparente, mesmo canvas 220x224) ficam em AVATAR_DIR,
// FORA do repo, para sobreviverem ao "git reset --hard". So o AI Radar
// (#00C2FF) tem assets por enquanto. AVATAR=false desliga em todos os
// canais (reversao total). A boca vem do Rhubarb Lip Sync; a pose
// alterna em janelas de tempo. Se o Rhubarb falhar, o render cai no
// caminho normal (sem avatar) e nao quebra.
// ============================================================
const AVATAR = true;
const AVATAR_DIR = path.join(__dirname, 'assets'); // base dos assets, no repo (/opt/video-pipeline/assets)
const RHUBARB = '/opt/rhubarb/rhubarb';        // binario do Rhubarb
const AVATAR_W = 360;                          // largura do mascote no video (~1/3 de 1080)
const AVATAR_X = 44;                           // margem esquerda (px)
const AVATAR_MARGIN_BOTTOM = 60;               // margem inferior (px)
const AVATAR_POSE_ROT = ['02_apresentando_dir', '01_ambos_baixo', '03_apontar_cima_dir', '09_comemorando'];
const AVATAR_POSE_INTERVAL = 2.8;              // segundos por pose antes de trocar
// Rhubarb (A-H, X) -> nossos 7 visemas
const RHUBARB_MAP = { A: 'rest', B: 'suave', C: 'e', D: 'aberto_a', E: 'o', F: 'u', G: 'suave', H: 'medio', X: 'rest' };
// cor_legenda -> pasta de assets dentro de AVATAR_DIR
const AVATAR_CHANNELS = { '#00C2FF': 'ai_radar' };

function getAvatar(corLegenda) {
  if (!AVATAR) return null;
  const key = (corLegenda || '').toUpperCase().trim();
  const slug = AVATAR_CHANNELS[key];
  if (!slug) return null;
  const dir = path.join(AVATAR_DIR, slug);
  if (!fs.existsSync(path.join(dir, 'base.png'))) return null;
  return { dir: dir, slug: slug };
}

// Roda o Rhubarb no audio e devolve { visema: [[start,end],...] }.
function buildVisemeWindows(audioPath, jobDir, dur) {
  const wav = path.join(jobDir, 'rhubarb.wav');
  const json = path.join(jobDir, 'visemes.json');
  execSync('ffmpeg -y -i ' + audioPath + ' -ac 1 -ar 16000 -sample_fmt s16 ' + wav, { timeout: 60000 });
  execSync(RHUBARB + ' -f json -r phonetic ' + wav + ' -o ' + json, { timeout: 120000 });
  const data = JSON.parse(fs.readFileSync(json, 'utf8'));
  const wins = {};
  for (const c of (data.mouthCues || [])) {
    const v = RHUBARB_MAP[c.value] || 'rest';
    const s = Math.max(0, parseFloat(c.start));
    const e = Math.min(dur, parseFloat(c.end));
    if (!(e > s)) continue;
    (wins[v] = wins[v] || []).push([s, e]);
  }
  return wins;
}

// Janelas de enable por pose, rotacionando ao longo do video.
function buildPoseWindows(dur) {
  const wins = {};
  let t = 0, i = 0;
  while (t < dur) {
    const p = AVATAR_POSE_ROT[i % AVATAR_POSE_ROT.length];
    const e = Math.min(t + AVATAR_POSE_INTERVAL, dur);
    (wins[p] = wins[p] || []).push([t, e]);
    t += AVATAR_POSE_INTERVAL; i++;
  }
  return wins;
}

// Converte [[s,e],...] no enable do ffmpeg.
function enableStr(ws) {
  return "enable='" + ws.map(function (w) {
    return 'between(t,' + w[0].toFixed(2) + ',' + w[1].toFixed(2) + ')';
  }).join('+') + "'";
}

async function downloadFile(url, dest) {
  const response = await axios({ url, responseType: 'stream' });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Converte cor hex (#RRGGBB) para formato ASS (&H00BBGGRR&)
function hexToAss(hex) {
  if (!hex || typeof hex !== 'string') return '&H0000CCFF&'; // fallback laranja
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return '&H0000CCFF&';
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  return '&H00' + b.toUpperCase() + g.toUpperCase() + r.toUpperCase() + '&';
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/render', async (req, res) => {
  const jobId = Date.now().toString();
  const jobDir = path.join(WORK_DIR, jobId);

  try {
    await fs.ensureDir(jobDir);
    const { audio_url, video_clips, language, cor_legenda } = req.body;
    const assColor = hexToAss(cor_legenda);
    console.log('[render] jobId:', jobId, '| cor_legenda recebida:', cor_legenda, '| ASS:', assColor, '| end card:', getEndCard(cor_legenda) ? getEndCard(cor_legenda).nome : '(nenhum)');

    // Define idioma para o WhisperX — default pt
    const whisperLang = language ? language.substring(0, 2).toLowerCase() : 'pt';

    // 1. Baixa o audio
    const audioPath = path.join(jobDir, 'audio.mp3');
    await downloadFile(audio_url, audioPath);

    // Duracao do audio (= duracao final do video por causa do -shortest).
    // Usada pelo end card e para esconder a legenda na janela do card.
    let audioDur = 0;
    try {
      audioDur = parseFloat(execSync('ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 ' + audioPath).toString().trim());
    } catch (e) { audioDur = 0; }
    const ecAtivo = !!getEndCard(cor_legenda) && audioDur > 0;
    // Acima desse tempo a legenda nao e desenhada (so quando ha end card).
    const legendaCutoff = ecAtivo ? (audioDur - END_CARD_DUR) : Infinity;

    // 2. Roda WhisperX com idioma dinamico
    const whisperCmd = '/opt/whisperx-env/bin/whisperx ' + audioPath + ' --model small --language ' + whisperLang + ' --output_format json --output_dir ' + jobDir;
    execSync(whisperCmd, { timeout: 120000 });

    // 3. Le o JSON do WhisperX
    const whisperOutput = JSON.parse(fs.readFileSync(path.join(jobDir, 'audio.json'), 'utf8'));

    // 4. Usa segmentos naturais do WhisperX
    const MAX_WORDS = 5;
    const phrases = [];

    if (whisperOutput.segments) {
      for (const seg of whisperOutput.segments) {
        if (!seg.words || seg.words.length === 0) continue;

        if (seg.words.length <= MAX_WORDS) {
          phrases.push(seg.words);
        } else {
          for (let i = 0; i < seg.words.length; i += MAX_WORDS) {
            phrases.push(seg.words.slice(i, i + MAX_WORDS));
          }
        }
      }
    }

    // 5. Funcao de formato de tempo ASS
    function ft(s) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sc = Math.floor(s % 60);
      const cs = Math.round((s % 1) * 100);
      return h + ':' + String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
    }

    // 6. Gera ASS estilo viral
    let assContent = '[Script Info]\n';
    assContent += 'ScriptType: v4.00+\n';
    assContent += 'PlayResX: 1080\n';
    assContent += 'PlayResY: 1920\n\n';
    assContent += '[V4+ Styles]\n';
    assContent += 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    assContent += 'Style: Default,Arial,98,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,2,2,60,60,615,1\n\n';
    assContent += '[Events]\n';
    assContent += 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

    for (const phraseWords of phrases) {
      const phraseStart = phraseWords[0].start;
      const phraseEnd = phraseWords[phraseWords.length - 1].end;

      // Esconde a legenda durante o end card (evita CTA duplicado/fantasma).
      if (phraseEnd > legendaCutoff) continue;

      for (let wi = 0; wi < phraseWords.length; wi++) {
        const activeWord = phraseWords[wi];
        const lineStart = ft(wi === 0 ? phraseStart : phraseWords[wi].start);
        const lineEnd = ft(wi === phraseWords.length - 1 ? phraseEnd : phraseWords[wi + 1].start);

        let lineText = '';
        for (let wj = 0; wj < phraseWords.length; wj++) {
          const word = phraseWords[wj].word.trim();
          if (wj === wi) {
            lineText += '{\\c' + assColor + '\\b1}' + word + '{\\c&H00FFFFFF&\\b1}';
          } else {
            lineText += '{\\c&H00FFFFFF&\\b1}' + word + '{\\r}';
          }
          if (wj === 1 && phraseWords.length > 2) {
            lineText += '\\N';
          } else if (wj < phraseWords.length - 1) {
            lineText += ' ';
          }
        }
        assContent += 'Dialogue: 0,' + lineStart + ',' + lineEnd + ',Default,,0,0,0,,' + lineText + '\n';
      }
    }

    const assPath = path.join(jobDir, 'subtitles.ass');
    fs.writeFileSync(assPath, assContent);

    // 7. Baixa e corta videos na duracao exata
    // FIX: trim gera clipes SO-VIDEO (-map 0:v -an) para o concat -c copy nao quebrar
    // quando o Pexels devolve clipes com layouts de stream heterogeneos (audio / data / nenhum).
    // O audio da narracao e adicionado depois, no passo 9.
    const listPath = path.join(jobDir, 'videos.txt');
    let listContent = '';
    for (let i = 0; i < video_clips.length; i++) {
      const clipPath = path.join(jobDir, 'clip_' + i + '.mp4');
      const trimmedPath = path.join(jobDir, 'trimmed_' + i + '.mp4');
      await downloadFile(video_clips[i].url, clipPath);
      execSync('ffmpeg -i ' + clipPath + ' -t ' + video_clips[i].duration + ' -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,fps=30" -map 0:v -an -c:v libx264 ' + trimmedPath, { timeout: 60000 });
      listContent += "file '" + trimmedPath + "'\n";
    }
    fs.writeFileSync(listPath, listContent);

    // 8. Concatena videos
    const concatPath = path.join(jobDir, 'concat.mp4');
    execSync('ffmpeg -f concat -safe 0 -i ' + listPath + ' -c copy ' + concatPath, { timeout: 120000 });

    // 9. Aplica audio + legenda karaoke (+ avatar/mascote, se ativo)
    const outputPath = path.join(OUTPUT_DIR, jobId + '.mp4');
    const endCardVf = buildEndCardVf(cor_legenda, audioDur);
    const brandBugVf = buildBrandBugVf(cor_legenda);
    const baseChain = 'ass=' + assPath + endCardVf + brandBugVf;

    let av = getAvatar(cor_legenda);
    let avData = null;
    if (av && audioDur > 0) {
      try {
        avData = { mwins: buildVisemeWindows(audioPath, jobDir, audioDur), pwins: buildPoseWindows(audioDur) };
      } catch (e) {
        console.log('[avatar] desativado neste render (rhubarb/conversao falhou):', e.message);
        av = null;
      }
    }

    if (av && avData) {
      const pos = 'x=' + AVATAR_X + ':y=H-h-' + AVATAR_MARGIN_BOTTOM;
      // ordem dos assets (= ordem dos inputs a partir do indice 2):
      // base -> bracos (poses com janela) -> boca rest -> bocas abertas (com janela)
      const assets = [path.join(av.dir, 'base.png')];
      const posesUsed = AVATAR_POSE_ROT.filter(function (p) {
        return avData.pwins[p] && fs.existsSync(path.join(av.dir, 'arm_' + p + '.png'));
      });
      posesUsed.forEach(function (p) { assets.push(path.join(av.dir, 'arm_' + p + '.png')); });
      const MOUTH_ORDER = ['suave', 'e', 'medio', 'aberto_a', 'o', 'u'];
      const mouthsUsed = ['rest'].concat(MOUTH_ORDER.filter(function (m) {
        return avData.mwins[m] && fs.existsSync(path.join(av.dir, 'mouth_' + m + '.png'));
      }));
      mouthsUsed.forEach(function (m) { assets.push(path.join(av.dir, 'mouth_' + m + '.png')); });

      let inputs = '-stream_loop -1 -i ' + concatPath + ' -i ' + audioPath;
      assets.forEach(function (a) { inputs += ' -i ' + a; });

      // base video (legenda + end card + brand bug) -> [vb]; escala cada camada -> [Lk]
      let fc = '[0:v]' + baseChain + '[vb]';
      assets.forEach(function (a, j) { fc += ';[' + (2 + j) + ':v]scale=' + AVATAR_W + ':-1[L' + j + ']'; });
      fc += ';[vb][L0]overlay=' + pos + '[v0]';   // corpo + feixe + expressao (sempre)
      let prev = 'v0', li = 1, vi = 1;
      posesUsed.forEach(function (p) {            // braco: troca de pose por janelas
        fc += ';[' + prev + '][L' + li + ']overlay=' + pos + ':' + enableStr(avData.pwins[p]) + '[v' + vi + ']';
        prev = 'v' + vi; li++; vi++;
      });
      fc += ';[' + prev + '][L' + li + ']overlay=' + pos + '[v' + vi + ']';  // boca rest sempre
      prev = 'v' + vi; li++; vi++;
      mouthsUsed.slice(1).forEach(function (m) {  // bocas abertas por cima, nas janelas do rhubarb
        fc += ';[' + prev + '][L' + li + ']overlay=' + pos + ':' + enableStr(avData.mwins[m]) + '[v' + vi + ']';
        prev = 'v' + vi; li++; vi++;
      });

      execSync('ffmpeg ' + inputs + ' -filter_complex "' + fc + '" -map "[' + prev + ']" -map 1:a -c:v libx264 -c:a aac -shortest ' + outputPath, { timeout: 300000 });
    } else {
      execSync('ffmpeg -stream_loop -1 -i ' + concatPath + ' -i ' + audioPath + ' -map 0:v -map 1:a -vf "' + baseChain + '" -c:v libx264 -c:a aac -shortest ' + outputPath, { timeout: 300000 });
    }

    // 10. Limpa temporarios
    await fs.remove(jobDir);

    res.json({ success: true, output_url: 'http://178.104.143.185:3000/output/' + jobId + '.mp4' });

  } catch (error) {
    await fs.remove(jobDir).catch(() => {});
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rota de download forcado (Content-Disposition: attachment)
// Forca o navegador a baixar o video em vez de abrir o player
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  // Seguranca: bloqueia path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(OUTPUT_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath, filename);
});

app.use('/output', express.static(OUTPUT_DIR));

app.listen(3000, () => {
  console.log('API rodando na porta 3000');
});
