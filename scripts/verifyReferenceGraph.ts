import {
  DEFAULT_CONFIG,
  synthesizeDialupHandshake,
} from '../src/audio/dialupDsp';
import {
  buildReferenceGraphPlan,
  renderReferenceGraphPlan,
} from '../src/audio/generator/referenceGraph';

function snrDb(a: Float32Array, b: Float32Array): number {
  let signal = 0;
  let error = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    signal += a[i] * a[i];
    const e = a[i] - b[i];
    error += e * e;
  }
  return 10 * Math.log10(signal / Math.max(1e-30, error));
}

function maxError(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    worst = Math.max(worst, Math.abs(a[i] - b[i]));
  }
  return worst;
}

function maxJump(a: Float32Array): number {
  let worst = 0;
  for (let i = 1; i < a.length; i++) {
    worst = Math.max(worst, Math.abs(a[i] - a[i - 1]));
  }
  return worst;
}

const reference = synthesizeDialupHandshake(DEFAULT_CONFIG);
const exact = renderReferenceGraphPlan(
  buildReferenceGraphPlan({ seed: 0, variation: false })
);
const varied = renderReferenceGraphPlan(
  buildReferenceGraphPlan({ seed: 314159, variation: true })
);
const acceptedLong = synthesizeDialupHandshake({
  ...DEFAULT_CONFIG,
  extendedMode: true,
});

const snr = snrDb(reference.samples, exact.samples);
const error = maxError(reference.samples, exact.samples);
const variedJump = maxJump(varied.samples);
const acceptedJump = maxJump(acceptedLong.samples);

console.log('exactSNR=' + snr.toFixed(2) + 'dB');
console.log('exactMaxError=' + error.toExponential(6));
console.log('exactDuration=' + exact.durationSec.toFixed(6) + 's');
console.log('variedDuration=' + varied.durationSec.toFixed(3) + 's');
console.log('variedMaxJump=' + variedJump.toFixed(6));
console.log('acceptedLongMaxJump=' + acceptedJump.toFixed(6));

if (reference.samples.length !== exact.samples.length) {
  throw new Error('Exact generator length differs from accepted model');
}
if (snr < 140 || error >= 1e-6) {
  throw new Error('Exact generator is not transparent enough');
}
if (variedJump > acceptedJump * 1.02 + 1e-6) {
  throw new Error('Varied generator has rougher transitions than accepted long model');
}
