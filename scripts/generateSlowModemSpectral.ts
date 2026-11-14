import fs from 'node:fs';
import path from 'node:path';
import { encodeWav16Bit } from '../src/audio/dialupDsp';
import { synthesizeSlowModemFromSpectralFrames } from '../src/audio/slowModemMode';

const result = synthesizeSlowModemFromSpectralFrames(5);
const outDir = path.resolve('output');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'Медленный модем из нашей программы.wav');
fs.writeFileSync(out, encodeWav16Bit(result.samples, result.sampleRate));
console.log(`duration=${result.durationSec.toFixed(3)}`);
console.log(`factor=${result.frameStretchFactor}`);
console.log(out);
