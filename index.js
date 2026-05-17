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

    // 4. Gera arquivo ASS com karaoke
    const assPath = path.join(jobDir, 'subtitles.ass');
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

    function ft(s) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sc = Math.floor(s % 60);
      const cs = Math.round((s % 1) * 100);
      return h + ':' + String(m).padStart(2, '0') + ':' + String(sc).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
    }

    let assContent = '[Script Info]\n';
    assContent += 'ScriptType: v4.00+\n';
    assContent += 'PlayResX: 1080\n';
    assContent += 'PlayResY: 1920\n\n';
    assContent += '[V4+ Styles]\n';
    assContent += 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n';
    assContent += 'Style: Default,Arial,60,&H00FFFFFF,&H00FFC000,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,0,2,10,10,150,1\n\n';
    assContent += '[Events]\n';
    assContent += 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

    for (const w of words) {
      assContent += 'Dialogue: 0,' + ft(w.start) + ',' + ft(w.end) + ',Default,,0,0,0,,{\\c&H00FFC000&}' + w.word.trim() + '\n';
    }

    fs.writeFileSync(assPath, assContent);

    // 5. Baixa e concatena videos
    const listPath = path.join(jobDir, 'videos.txt');
    let listContent = '';
    for (let i = 0; i < video_clips.length; i++) {
      const clipPath = path.join(jobDir, 'clip_' + i + '.mp4');
      await downloadFile(video_clips[i].url, clipPath);
      listContent += "file '" + clipPath + "'\n";
      listContent += 'duration ' + video_clips[i].duration + '\n';
    }
    fs.writeFileSync(listPath, listContent);

    const concatPath = path.join(jobDir, 'concat.mp4');
    execSync('ffmpeg -f concat -safe 0 -i ' + listPath + ' -c copy ' + concatPath, { timeout: 120000 });

    // 6. Aplica audio + legenda
    const outputPath = path.join(OUTPUT_DIR, jobId + '.mp4');
    execSync('ffmpeg -i ' + concatPath + ' -i ' + audioPath + ' -vf ass=' + assPath + ' -c:v libx264 -c:a aac -shortest ' + outputPath, { timeout: 300000 });

    // 7. Limpa temporarios
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
