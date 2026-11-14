import {
  DEFAULT_CONFIG,
  SAMPLE_RATE,
  synthesizeDialupHandshake,
} from '../src/audio/dialupDsp';
import {
  DEFAULT_ALGORITHMIC_CONFIG,
  generateAlgorithmicDialup,
} from '../src/audio/generator/generator';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / (Math.sqrt(aa * bb) || 1);
}

function rmsEnvelope(
  samples: Float32Array,
  startSec: number,
  endSec: number,
  bins = 40
): number[] {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const end = Math.min(samples.length, Math.floor(endSec * SAMPLE_RATE));
  const out: number[] = [];
  for (let b = 0; b < bins; b++) {
    const a = Math.floor(start + ((end - start) * b) / bins);
    const z = Math.max(a + 1, Math.floor(start + ((end - start) * (b + 1)) / bins));
    let sum = 0;
    for (let i = a; i < z; i++) sum += samples[i] * samples[i];
    out.push(Math.sqrt(sum / Math.max(1, z - a)));
  }
  return out;
}

function spectralWindows(
  samples: Float32Array,
  startSec: number,
  endSec: number,
  windows = 12
): { vector: number[]; peaks: number[] } {
  const frameSize = 768;
  const vector: number[] = [];
  const peaks: number[] = [];

  for (let w = 0; w < windows; w++) {
    const frac = (w + 0.5) / windows;
    const centerSec = startSec + (endSec - startSec) * frac;
    const first = Math.floor(centerSec * SAMPLE_RATE - frameSize / 2);
    const row: number[] = [];
    let bestMagnitude = -1;
    let bestHz = 0;

    for (let hz = 100; hz <= 4100; hz += 100) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < frameSize; n++) {
        const index = first + n;
        const sample = index >= 0 && index < samples.length ? samples[index] : 0;
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (frameSize - 1));
        const angle = (2 * Math.PI * hz * n) / SAMPLE_RATE;
        re += sample * window * Math.cos(angle);
        im -= sample * window * Math.sin(angle);
      }
      const magnitude = Math.log1p(Math.hypot(re, im));
      row.push(magnitude);
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestHz = hz;
      }
    }

    const norm = Math.hypot(...row) || 1;
    vector.push(...row.map((value) => value / norm));
    peaks.push(bestHz);
  }

  return { vector, peaks };
}

function peakScore(a: number[], b: number[]) {
  let difference = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) difference += Math.abs(a[i] - b[i]);
  const meanDifferenceHz = difference / Math.max(1, n);
  return {
    score: Math.exp(-meanDifferenceHz / 600),
    meanDifferenceHz,
  };
}

const reference = synthesizeDialupHandshake({
  ...DEFAULT_CONFIG,
  extendedMode: false,
});
const generated = generateAlgorithmicDialup(DEFAULT_ALGORITHMIC_CONFIG);

const rows = reference.phases.map((referencePhase, index) => {
  const generatedPhase = generated.phases[index];
  const refSpectrum = spectralWindows(
    reference.samples,
    referencePhase.startSec,
    referencePhase.endSec
  );
  const genSpectrum = spectralWindows(
    generated.samples,
    generatedPhase.startSec,
    generatedPhase.endSec
  );

  const spectral = Math.max(0, Math.min(1, cosine(refSpectrum.vector, genSpectrum.vector)));
  const envelope = Math.max(
    0,
    Math.min(
      1,
      cosine(
        rmsEnvelope(reference.samples, referencePhase.startSec, referencePhase.endSec),
        rmsEnvelope(generated.samples, generatedPhase.startSec, generatedPhase.endSec)
      )
    )
  );
  const peak = peakScore(refSpectrum.peaks, genSpectrum.peaks);
  const referenceDuration = referencePhase.endSec - referencePhase.startSec;
  const generatedDuration = generatedPhase.endSec - generatedPhase.startSec;
  const duration = Math.exp(-Math.abs(referenceDuration - generatedDuration) / 1.5);
  const total = 0.55 * spectral + 0.20 * envelope + 0.20 * peak.score + 0.05 * duration;

  return {
    stage: referencePhase.id,
    spectral,
    envelope,
    peak: peak.score,
    meanPeakDifferenceHz: peak.meanDifferenceHz,
    duration,
    total,
  };
});

const average = rows.reduce((sum, row) => sum + row.total, 0) / rows.length;
console.table(
  rows.map((row) => ({
    stage: row.stage,
    spectral: row.spectral.toFixed(3),
    envelope: row.envelope.toFixed(3),
    peak: row.peak.toFixed(3),
    peakDiffHz: row.meanPeakDifferenceHz.toFixed(0),
    total: row.total.toFixed(3),
  }))
);
console.log('average', average.toFixed(3));

const weak = rows.filter((row) => row.total < 0.68);
if (average < 0.79 || weak.length > 0) {
  console.error(
    'Generator quality gate failed:',
    weak.map((row) => `${row.stage}=${row.total.toFixed(3)}`).join(', ') || 'average'
  );
  process.exitCode = 1;
}
