import {
  SAMPLE_RATE,
  buildFrameSequence,
  renderFrameSequenceTo44k,
} from './dialupDsp';

export interface SlowModemSynthesisResult {
  sampleRate: number;
  durationSec: number;
  samples: Float32Array;
  frameStretchFactor: number;
}

export function buildSlowModemFrameSequence(
  source: Uint16Array,
  factor = 5,
  preservePrefixFrames = 351
): Uint16Array {
  const stretch = Math.max(1, Math.round(factor));
  const prefix = Math.max(0, Math.min(source.length, preservePrefixFrames));
  const out = new Uint16Array(prefix + (source.length - prefix) * stretch);
  let dst = 0;

  for (let i = 0; i < prefix; i++) out[dst++] = source[i];
  for (let i = prefix; i < source.length; i++) {
    for (let n = 0; n < stretch; n++) out[dst++] = source[i];
  }
  return out;
}

export function synthesizeSlowModemFromSpectralFrames(
  factor = 5
): SlowModemSynthesisResult {
  const originalFrames = buildFrameSequence(true);
  const slowFrames = buildSlowModemFrameSequence(originalFrames, factor, 351);
  const rendered = renderFrameSequenceTo44k(slowFrames, true);
  const samples = new Float32Array(rendered);

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.001) {
    const scale = 0.90 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }

  return {
    sampleRate: SAMPLE_RATE,
    durationSec: samples.length / SAMPLE_RATE,
    samples,
    frameStretchFactor: Math.max(1, Math.round(factor)),
  };
}
