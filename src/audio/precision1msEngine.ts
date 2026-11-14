import { SAMPLE_RATE } from './dialupDsp';

const FFT_SIZE = 1024;
const ANALYSIS_HOP = 44; // 0.998 ms at 44.1 kHz
const WINDOW_SIZE = 1024;

const bitReverse = new Uint16Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  let x = i;
  let y = 0;
  for (let b = 0; b < 10; b++) {
    y = (y << 1) | (x & 1);
    x >>= 1;
  }
  bitReverse[i] = y;
}

const window = new Float64Array(WINDOW_SIZE);
for (let i = 0; i < WINDOW_SIZE; i++) {
  window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW_SIZE - 1));
}

function fftInPlace(real: Float64Array, imag: Float64Array, inverse: boolean): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = bitReverse[i];
    if (j <= i) continue;
    const tr = real[i];
    const ti = imag[i];
    real[i] = real[j];
    imag[i] = imag[j];
    real[j] = tr;
    imag[j] = ti;
  }

  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const theta = (sign * 2 * Math.PI) / size;
    const wpr = Math.cos(theta);
    const wpi = Math.sin(theta);

    for (let start = 0; start < FFT_SIZE; start += size) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < half; j++) {
        const even = start + j;
        const odd = even + half;
        const or = real[odd];
        const oi = imag[odd];
        const tr = wr * or - wi * oi;
        const ti = wr * oi + wi * or;

        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;

        const nextWr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr;
        wr = nextWr;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < FFT_SIZE; i++) {
      real[i] /= FFT_SIZE;
      imag[i] /= FFT_SIZE;
    }
  }
}

function wrapPhase(x: number): number {
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

export interface Precision1msResult {
  samples: Float32Array;
  analysisFrameCount: number;
  frameStepMs: number;
}

export function stretchPrecision1ms(
  source: Float32Array,
  factor: number
): Precision1msResult {
  const stretch = Math.max(1, factor);
  const synthesisHop = Math.max(1, Math.round(ANALYSIS_HOP * stretch));
  const frameCount = Math.max(
    1,
    Math.floor((source.length - WINDOW_SIZE) / ANALYSIS_HOP) + 1
  );
  const outLength = (frameCount - 1) * synthesisHop + WINDOW_SIZE;

  const output = new Float64Array(outLength);
  const norm = new Float64Array(outLength);
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);
  const previousPhase = new Float64Array(FFT_SIZE / 2 + 1);
  const synthesisPhase = new Float64Array(FFT_SIZE / 2 + 1);
  const first = new Uint8Array(FFT_SIZE / 2 + 1);
  first.fill(1);

  for (let frame = 0; frame < frameCount; frame++) {
    const sourceStart = frame * ANALYSIS_HOP;
    real.fill(0);
    imag.fill(0);

    for (let n = 0; n < WINDOW_SIZE; n++) {
      real[n] = (source[sourceStart + n] ?? 0) * window[n];
    }

    fftInPlace(real, imag, false);

    for (let k = 0; k <= FFT_SIZE / 2; k++) {
      const magnitude = Math.hypot(real[k], imag[k]);
      const phase = Math.atan2(imag[k], real[k]);
      const expected = (2 * Math.PI * k * ANALYSIS_HOP) / FFT_SIZE;

      if (first[k]) {
        synthesisPhase[k] = phase;
        first[k] = 0;
      } else {
        const delta = wrapPhase(phase - previousPhase[k] - expected);
        const trueAdvance = expected + delta;
        synthesisPhase[k] += trueAdvance * (synthesisHop / ANALYSIS_HOP);
      }

      previousPhase[k] = phase;
      real[k] = magnitude * Math.cos(synthesisPhase[k]);
      imag[k] = magnitude * Math.sin(synthesisPhase[k]);
    }

    imag[0] = 0;
    imag[FFT_SIZE / 2] = 0;
    for (let k = 1; k < FFT_SIZE / 2; k++) {
      real[FFT_SIZE - k] = real[k];
      imag[FFT_SIZE - k] = -imag[k];
    }

    fftInPlace(real, imag, true);

    const outStart = frame * synthesisHop;
    for (let n = 0; n < WINDOW_SIZE; n++) {
      const w = window[n];
      output[outStart + n] += real[n] * w;
      norm[outStart + n] += w * w;
    }
  }

  const samples = new Float32Array(outLength);
  let peak = 0;
  for (let i = 0; i < outLength; i++) {
    const v = norm[i] > 1e-9 ? output[i] / norm[i] : 0;
    samples[i] = Number.isFinite(v) ? v : 0;
    peak = Math.max(peak, Math.abs(samples[i]));
  }

  if (peak > 0.90) {
    const scale = 0.90 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }

  return {
    samples,
    analysisFrameCount: frameCount,
    frameStepMs: (ANALYSIS_HOP / SAMPLE_RATE) * 1000,
  };
}
