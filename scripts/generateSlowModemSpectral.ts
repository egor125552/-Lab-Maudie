import fs from 'node:fs';
import path from 'node:path';
import { encodeWav16Bit } from '../src/audio/dialupDsp';
import { synthesizeNaturalSlowModem } from '../src/audio/slowModemMode';

const result = synthesizeNaturalSlowModem();
const outDir = path.resolve('output');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'Медленный модем естественные циклы.wav');
fs.writeFileSync(out, encodeWav16Bit(result.samples, result.sampleRate));
console.log(`duration=${result.durationSec.toFixed(3)}`);
console.log(out);
