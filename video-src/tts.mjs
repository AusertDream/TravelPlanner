import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
const script = JSON.parse(fs.readFileSync('script.json','utf8'));
const voice = process.env.VOICE || 'zh-CN-XiaoyiNeural';
const only = process.argv.slice(2);
for (const s of script) for (const l of s.lines) {
  const rate = s.rate || process.env.RATE || '+5%';
  if (only.length && !only.includes(l.id)) continue;
  let text = (l.tts || l.sub.replaceAll('|','，')).replaceAll('TravelPlanner','Travel Planner');
  for (let attempt=0; attempt<4; attempt++) {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
      const dir = `audio/${l.id}`; fs.mkdirSync(dir, {recursive:true});
      const r = await tts.toFile(dir, text, { rate });
      tts.close?.();
      console.log(l.id, r.audioFilePath, r.metadataFilePath||'');
      break;
    } catch (e) { console.log(l.id, 'retry', e.message); await new Promise(r=>setTimeout(r,2000)); }
  }
}
process.exit(0);
