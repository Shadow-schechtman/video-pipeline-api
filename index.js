const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const avatar = require('./ai_radar/avatar');

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
// Mascote do canal renderizado QUADRO A QUADRO pelo modulo
// ./ai_radar/avatar.js: a boca acompanha a amplitude da narracao,
// e as EXPRESSOES, GESTOS e acenos de cabeca sao sincronizados com
// o roteiro (tempos das palavras do WhisperX, passados em 'words').
// So o AI Radar (#00C2FF) esta ligado. AVATAR=false desliga tudo.
// Se o render do avatar falhar (ex.: rsvg-convert ausente), o video
// sai no caminho normal, sem mascote. Instalar uma vez na VPS:
// apt-get install -y librsvg2-bin
// ------------------------------------------------------------
// [TEMP] Mascote DESLIGADO (AVATAR=false) para gerar e postar videos sem avatar.
// Todo o pipeline (rig, springs, viseme, expr_track, wiring) fica intacto.
// Para RETOMAR: voltar para true.
// ============================================================
const AVATAR = false;
const AVATAR_W = 780;             // largura do mascote (~35% da altura: PNG 672 = 35% de 1920)
const AVATAR_X = -130;            // negativo: cola o mascote no canto inferior-esquerdo (o padding lateral do viewBox sai da tela)
const AVATAR_MARGIN_BOTTOM = 60;  // margem inferior (px)
const AVATAR_FPS = 25;            // fps do avatar (baixar p/ 20 acelera o render)
const AVATAR_CHANNELS = { '#00C2FF': true };

function avatarOn(corLegenda) {
  if (!AVATAR) return false;
  const key = (corLegenda || '').toUpperCase().trim();
  return !!AVATAR_CHANNELS[key];
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

    // 4. Agrupa as palavras (legenda estilo amigo_dicas: 1 linha, poucas palavras)
    // Legenda estilo amigo_dicas: UMA linha, agrupando quantas palavras couberem
    // na coluna ao lado do mascote (palavra longa fica sozinha; 2-3 curtas juntas).
    // O agrupamento respeita as pausas naturais (nao junta palavras de segmentos diferentes).
    // CHARS_BUDGET reduzido de 12 -> 10: a linha cheia nasce mais estreita p/ nao
    // tocar a coluna de UI da plataforma na direita (ver MarginR no estilo abaixo).
    const WORDS_MAX = 3;        // teto de palavras por tela
    const CHARS_BUDGET = 10;    // ~ largura da coluna lateral (caracteres); 10 evita a linha cheia sob a UI da direita
    const phrases = [];

    if (whisperOutput.segments) {
      for (const seg of whisperOutput.segments) {
        if (!seg.words || seg.words.length === 0) continue;
        let group = [];
        let chars = 0;
        for (const w of seg.words) {
          const wl = (w.word || '').trim().length;
          const projected = group.length ? (chars + 1 + wl) : wl;
          if (group.length && (group.length >= WORDS_MAX || projected > CHARS_BUDGET)) {
            phrases.push(group);
            group = [];
            chars = 0;
          }
          chars = group.length ? (chars + 1 + wl) : wl;
          group.push(w);
        }
        if (group.length) phrases.push(group);
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
    // Legenda numa LINHA so, na coluna a direita do mascote (MarginL alto desloca o
    // texto centralizado pra direita, liberando o canto onde fica o mascote). Karaoke
    // mantido (palavra ativa na cor do canal, resto branco).
    // MarginR 160 (era 100): puxa o texto centralizado ~40px p/ a esquerda, afastando
    // a linha cheia da coluna de UI da plataforma (icones curtir/comentar/salvar).
    // Janela horizontal segura resultante: ~[466, 920].
    let assContent = '[Script Info]\n';
    assContent += 'ScriptType: v4.00+\n';
    assContent += 'PlayResX: 1080\n';
    assContent += 'PlayResY: 1920\n\n';
    assContent += '[V4+ Styles]\n';
    assContent += 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    assContent += 'Style: Default,Arial,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,2,466,160,430,1\n\n';
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
          if (wj < phraseWords.length - 1) {
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

    // Gera os frames do avatar (PNG transparente) a partir da narracao.
    // A boca segue a amplitude do audio; olhos/sobrancelha/bracos/expressoes sao
    // animados dentro do modulo avatar.js. Se falhar, segue sem mascote (nao quebra).
    let avFrames = null;
    if (avatarOn(cor_legenda) && audioDur > 0) {
      try {
        const wavPath = path.join(jobDir, 'av.wav');
        execSync('ffmpeg -y -i ' + audioPath + ' -ac 1 -ar 16000 -sample_fmt s16 ' + wavPath, { timeout: 60000 });
        const avDir = path.join(jobDir, 'avframes');
        // Passa os tempos das palavras (WhisperX) p/ o avatar reagir ao roteiro:
        // expressoes, gestos e acenos de cabeca sincronizam com a fala.
        const avatarWords = [];
        if (whisperOutput.segments) {
          for (const seg of whisperOutput.segments) {
            if (!seg.words) continue;
            for (const w of seg.words) {
              if (w && w.start != null && w.end != null) {
                avatarWords.push({ word: (w.word || '').trim(), start: w.start, end: w.end });
              }
            }
          }
        }
        // ESTAGIO 5 (plug-and-play): se houver dicionario minerado do canal, monta a
        // rigTrack de expressao. Inerte se o dict nao existir (sem dict -> heuristicas).
        let rigTrack = null;
        try {
          const ET = require('./ai_radar/expr_track');
          const exprDict = ET.loadDictForChannel(cor_legenda);
          if (exprDict) rigTrack = ET.buildRigTrack({ words: avatarWords, dur: audioDur, fps: AVATAR_FPS, dict: exprDict });
        } catch (e) { rigTrack = null; }
        const nf = avatar.renderFrames({ wavPath: wavPath, fps: AVATAR_FPS, width: AVATAR_W, outDir: avDir, words: avatarWords, rigTrack: rigTrack });
        if (nf > 0) avFrames = path.join(avDir, 'av_%05d.png');
      } catch (e) {
        console.log('[avatar] desativado neste render (geracao de frames falhou):', e.message);
        avFrames = null;
      }
    }

    if (avFrames) {
      // input 0 = video concatenado | 1 = audio | 2 = sequencia de frames do avatar
      const pos = 'x=' + AVATAR_X + ':y=H-h-' + AVATAR_MARGIN_BOTTOM;
      const inputs = '-stream_loop -1 -i ' + concatPath + ' -i ' + audioPath + ' -framerate ' + AVATAR_FPS + ' -i ' + avFrames;
      const fc = '[0:v]' + baseChain + '[vb];[vb][2:v]overlay=' + pos + ':shortest=1[vout]';
      execSync('ffmpeg ' + inputs + ' -filter_complex "' + fc + '" -map "[vout]" -map 1:a -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest ' + outputPath, { timeout: 360000 });
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
