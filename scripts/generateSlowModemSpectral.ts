import fs from 'node:fs';
import path from 'node:path';
import { encodeWav16Bit } from '../src/audio/dialupDsp';
import { synthesizeSlowModem, type SlowModelMode } from '../src/audio/slowModemMode';

const outDir = path.resolve('output');
fs.mkdirSync(outDir, { recursive: true });

for (const mode of ['standard10ms', 'precision1ms'] as SlowModelMode[]) {
  const result = synthesizeSlowModem(mode, 5);
  const label = mode === 'precision1ms' ? 'Точный 1 мс' : 'Обычный 10 мс';
  const file = path.join(outDir, `Медленный модем — ${label}.wav`);
  fs.writeFileSync(file, encodeWav16Bit(result.samples, result.sampleRate));
  console.log(`${mode}: duration=${result.durationSec.toFixed(3)}s frames=${result.analysisFrameCount} step=${result.frameStepMs}ms`);
  console.log(file);
}
