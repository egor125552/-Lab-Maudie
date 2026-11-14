import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, encodeWav16Bit, synthesizeDialupHandshake } from '../src/audio/dialupDsp';
import { DEFAULT_ALGORITHMIC_CONFIG, generateAlgorithmicDialup } from '../src/audio/generator/generator';

const dir = path.resolve('output-compare');
fs.mkdirSync(dir, { recursive: true });

const reference = synthesizeDialupHandshake({ ...DEFAULT_CONFIG, extendedMode: false });
const generated = generateAlgorithmicDialup(DEFAULT_ALGORITHMIC_CONFIG);

fs.writeFileSync(path.join(dir, 'Эталон текущей программы.wav'), encodeWav16Bit(reference.samples, reference.sampleRate));
fs.writeFileSync(path.join(dir, 'Новый математический генератор.wav'), encodeWav16Bit(generated.samples, generated.sampleRate));
fs.writeFileSync(path.join(dir, 'phases.json'), JSON.stringify({
  reference: reference.phases,
  generated: generated.phases,
}, null, 2));

console.log('reference', reference.durationSec);
console.log('generated', generated.durationSec);
