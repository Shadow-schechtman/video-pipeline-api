const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

const WORK_DIR = '/opt/video-pipeline/temp';
const OUTPUT_DIR = '/opt/video-pipeline/output';

async function downloadFile(url, dest) {
  const response = await axios({ url, responseType: 'stream' });
  const writer = fs.createWriteStream(dest);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/render', async (req, res) => {
  const jobId = Date.now().toString();
  const jobDir = path.join(WORK_DIR, jobId);

  try {
    await fs.ensureDir(jobDir);
    const { audio_url, video_clips } = req.body;

    // 1. Baixa o audio
    const audioPath = path.join(jobDir, 'audio.mp3');
    await downloadFile(audio_url, audioPath);

    // 2. Roda WhisperX
    const whisperCmd = '/opt/whisperx-env/bin/whisperx ' + audioPath + ' --model small --language pt --output_format json --output_dir ' + jobDir;
    execSync(whisperCmd, { timeout: 120000 });

    // 3. Le o JSON do WhisperX
    const whisperOutput = JSON.parse(fs.readFileSync(path.join(jobDir, 'audio.json'), 'utf8'));

    // 4. Extrai palavras com timestamps
    const words = [];
    if (whisperOutput.segments) {
      for (const seg of whisperOutput.segments) {
        if (seg.words) {
          for (const w of seg.words) {
            words.push(w);
          }
        }
      }
    }

    // 5. Agrupa palavras em frases de ate 4 palavras (2 linhas de 2)
    const WORDS_PER_PHRASE = 4;
    const phrases = [];
    for (let i = 0; i < words.length; i += WORDS_PER_PHRASE) {
      phrases.push(words.slice(i, i + WORDS_PER_PHRASE));
    }

    // 6. Funcao de formato de tempo ASS
    function ft(s) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sc = Math.floor(s % 60);
      const cs = Math.round((s % 1) * 100);
      return h + ':' + String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
    }

    // 7. Gera ASS estilo viral - fonte grande, outline forte, palavra ativa amarela
    let assContent = '[Script Info]\n';
    assContent += 'ScriptType: v4.00+\n';
    assContent += 'PlayResX: 1080\n';
    assContent += 'PlayResY: 1920\n\n';
    assContent += '[V4+ Styles]\n';
    assContent += 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    // Fonte 75px, branca, outline preta espessa (5), bold, alinhamento centralizado embaixo
    assContent += 'Style: Default,Arial,75,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,2,2,60,60,180,1\n\n';
    assContent += '[Events]\n';
    assContent += 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

    for (const phraseWords of phrases) {
      const phraseStart = phraseWords[0].start;
      const phraseEnd = phraseWords[phraseWords.length - 1].end;

      for (let wi = 0; wi < phraseWords.length; wi++) {
        const activeWord = phraseWords[wi];
        const lineStart = ft(wi === 0 ? phraseStart : phraseWords[wi].start);
        const lineEnd = ft(wi === phraseWords.length - 1 ? phraseEnd : phraseWords[wi + 1].start);

        // Monta linha com quebra apos 2 palavras para ficar em 2 linhas
        let lineText = '';
        for (let wj = 0; wj < phraseWords.length; wj++) {
          const word = phraseWords[wj].word.trim();
          if (wj === wi) {
            // Palavra ativa: amarelo + bold
            lineText += '{\\c&H0000E5FF&\\b1}' + word + '{\\c&H00FFFFFF&\\b1}';
          } else {
            lineText += '{\\c&H00FFFFFF&\\b1}' + word + '{\\r}';
          }
          // Quebra de linha apos a 2a palavra
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

    // 8. Baixa e corta videos na duracao exata
    const listPath = path.join(jobDir, 'videos.txt');
    let listContent = '';
    for (let i = 0; i < video_clips.length; i++) {
      const clipPath = path.join(jobDir, 'clip_' + i + '.mp4');
      const trimmedPath = path.join(jobDir, 'trimmed_' + i + '.mp4');
      await downloadFile(video_clips[i].url, clipPath);
      execSync('ffmpeg -i ' + clipPath + ' -t ' + video_clips[i].duration + ' -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -c:v libx264 -c:a aac ' + trimmedPath, { timeout: 60000 });
      listContent += "file '" + trimmedPath + "'\n";
    }
    fs.writeFileSync(listPath, listContent);

    // 9. Concatena videos
    const concatPath = path.join(jobDir, 'concat.mp4');
    execSync('ffmpeg -f concat -safe 0 -i ' + listPath + ' -c copy ' + concatPath, { timeout: 120000 });

    // 10. Aplica audio + legenda karaoke
    const outputPath = path.join(OUTPUT_DIR, jobId + '.mp4');
    execSync('ffmpeg -stream_loop -1 -i ' + concatPath + ' -i ' + audioPath + ' -map 0:v -map 1:a -vf ass=' + assPath + ' -c:v libx264 -c:a aac -shortest ' + outputPath, { timeout: 300000 });

    // 11. Limpa temporarios
    await fs.remove(jobDir);

    res.json({ success: true, output_url: 'http://178.104.143.185:3000/output/' + jobId + '.mp4' });

  } catch (error) {
    await fs.remove(jobDir).catch(() => {});
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/output', express.static(OUTPUT_DIR));

app.listen(3000, () => {
  console.log('API rodando na porta 3000');
});
