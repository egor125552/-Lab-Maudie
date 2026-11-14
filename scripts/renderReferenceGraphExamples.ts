import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CONFIG,
  encodeWav16Bit,
  synthesizeDialupHandshake,
} from '../src/audio/dialupDsp';
import {
  buildReferenceGraphPlan,
  renderReferenceGraphPlan,
} from '../src/audio/generator/referenceGraph';

const outDir = path.resolve('output-generator');
fs.mkdirSync(outDir, { recursive: true });

const classic = synthesizeDialupHandshake(DEFAULT_CONFIG);
const exactPlan = buildReferenceGraphPlan({ seed: 0, variation: false });
const exact = renderReferenceGraphPlan(exactPlan);
const variedPlan = buildReferenceGraphPlan({ seed: 314159, variation: true });
const varied = renderReferenceGraphPlan(variedPlan);
const longSoundsPlan = buildReferenceGraphPlan({ seed: 0, variation: false, longSounds: true });
const longSounds = renderReferenceGraphPlan(longSoundsPlan);

const classicWav = encodeWav16Bit(classic.samples, classic.sampleRate);
const exactWav = encodeWav16Bit(exact.samples, exact.sampleRate);
const variedWav = encodeWav16Bit(varied.samples, varied.sampleRate);
const longSoundsWav = encodeWav16Bit(longSounds.samples, longSounds.sampleRate);

fs.writeFileSync(path.join(outDir, 'Классика для проверки.wav'), classicWav);
fs.writeFileSync(path.join(outDir, 'Точный генератор по модели.wav'), exactWav);
fs.writeFileSync(path.join(outDir, 'Новое соединение по модели.wav'), variedWav);
fs.writeFileSync(path.join(outDir, 'Dial-up с длинными звуками.wav'), longSoundsWav);

const same =
  classicWav.length === exactWav.length &&
  Buffer.from(classicWav).equals(Buffer.from(exactWav));

console.log('exactWavByteIdentical=' + same);
console.log('classicBytes=' + classicWav.length);
console.log('exactBytes=' + exactWav.length);
console.log('variedDuration=' + varied.durationSec.toFixed(3));
console.log('variedFrames=' + variedPlan.frameSequence.length);
console.log('longSoundsDuration=' + longSounds.durationSec.toFixed(3));
console.log('longSoundsFrames=' + longSoundsPlan.frameSequence.length);

if (!same) {
  throw new Error('Точный WAV отличается от текущей Классики');
}
