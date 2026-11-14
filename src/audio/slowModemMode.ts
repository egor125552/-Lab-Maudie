import {
  DEFAULT_CONFIG,
  SAMPLE_RATE,
  renderFrameSequenceTo44k,
  synthesizeDialupHandshake,
} from './dialupDsp';
import { stretchPrecision1ms } from './precision1msEngine';

export type SlowModelMode = 'standard10ms' | 'precision1ms';

export const SLOW_MODE_OPTIONS = [
  { id: 'standard10ms' as const, label: 'Обычный 10 мс', frameStepMs: 10 },
  { id: 'precision1ms' as const, label: 'Точный 1 мс', frameStepMs: 1 },
];

export interface SlowModemSynthesisResult {
  sampleRate: number;
  durationSec: number;
  samples: Float32Array;
  mode: SlowModelMode;
  frameStepMs: number;
  analysisFrameCount: number;
}

function appendRange(target: number[], start: number, end: number): void {
  for (let frame = start; frame <= end; frame++) target.push(frame);
}

function repeatRange(target: number[], start: number, end: number, count: number): void {
  for (let i = 0; i < count; i++) appendRange(target, start, end);
}

export function buildNaturalSlowFrameSequence(): Uint16Array {
  const frames: number[] = [];

  appendRange(frames, 0, 350);
  appendRange(frames, 351, 619);
  repeatRange(frames, 620, 884, 5);
  appendRange(frames, 885, 1097);
  repeatRange(frames, 1035, 1097, 10);
  repeatRange(frames, 1098, 1207, 10);
  appendRange(frames, 1128, 1209);
  repeatRange(frames, 1210, 1353, 5);
  appendRange(frames, 1354, 1572);
  repeatRange(frames, 1410, 1572, 12);
  appendRange(frames, 1438, 1607);
  appendRange(frames, 1608, 1985);
  repeatRange(frames, 1670, 1985, 10);
  appendRange(frames, 1822, 2013);
  appendRange(frames, 2014, 2184);
  repeatRange(frames, 2065, 2184, 8);
  appendRange(frames, 2095, 2227);
  appendRange(frames, 2228, 2465);
  repeatRange(frames, 2288, 2465, 7);
  appendRange(frames, 2288, 2539);

  return Uint16Array.from(frames);
}

function normalize(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.90) {
    const scale = 0.90 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }
  return samples;
}

function synthesizeStandard10ms(): SlowModemSynthesisResult {
  const frameSequence = buildNaturalSlowFrameSequence();
  const samples = normalize(new Float32Array(renderFrameSequenceTo44k(frameSequence, true)));

  return {
    sampleRate: SAMPLE_RATE,
    durationSec: samples.length / SAMPLE_RATE,
    samples,
    mode: 'standard10ms',
    frameStepMs: 10,
    analysisFrameCount: frameSequence.length,
  };
}

function synthesizePrecision1ms(factor: number): SlowModemSynthesisResult {
  const base = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    extendedMode: true,
  });

  const prefixEnd = Math.min(base.samples.length, Math.floor(3.5 * SAMPLE_RATE));
  const prefix = base.samples.slice(0, prefixEnd);
  const tail = base.samples.slice(prefixEnd);
  const precise = stretchPrecision1ms(tail, factor);

  const crossfade = Math.min(
    Math.floor(0.015 * SAMPLE_RATE),
    prefix.length,
    precise.samples.length
  );
  const samples = new Float32Array(prefix.length + precise.samples.length - crossfade);
  samples.set(prefix.subarray(0, prefix.length - crossfade), 0);

  const join = prefix.length - crossfade;
  for (let i = 0; i < crossfade; i++) {
    const x = (i + 1) / (crossfade + 1);
    const a = Math.cos(x * Math.PI * 0.5);
    const b = Math.sin(x * Math.PI * 0.5);
    samples[join + i] = prefix[join + i] * a + precise.samples[i] * b;
  }
  samples.set(precise.samples.subarray(crossfade), prefix.length);

  normalize(samples);
  return {
    sampleRate: SAMPLE_RATE,
    durationSec: samples.length / SAMPLE_RATE,
    samples,
    mode: 'precision1ms',
    frameStepMs: 1,
    analysisFrameCount: precise.analysisFrameCount,
  };
}

export function synthesizeSlowModem(
  mode: SlowModelMode = 'standard10ms',
  factor = 5
): SlowModemSynthesisResult {
  return mode === 'precision1ms'
    ? synthesizePrecision1ms(factor)
    : synthesizeStandard10ms();
}

export function synthesizeNaturalSlowModem(): SlowModemSynthesisResult {
  return synthesizeStandard10ms();
}
