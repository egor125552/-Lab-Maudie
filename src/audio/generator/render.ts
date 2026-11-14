import type { AlgorithmicPlan, SynthEvent } from './types';

function envelope(event: SynthEvent, localSec: number, durationSec: number): number {
  const edge = 'edgeSec' in event && event.edgeSec !== undefined ? event.edgeSec : 0.006;
  if (edge <= 0) return 1;
  const a = Math.min(1, Math.max(0, localSec / edge));
  const b = Math.min(1, Math.max(0, (durationSec - localSec) / edge));
  const x = Math.min(a, b);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

export function renderEventAt(event: SynthEvent, timeSec: number): number {
  if (timeSec < event.startSec || timeSec >= event.endSec) return 0;
  const local = timeSec - event.startSec;
  const duration = event.endSec - event.startSec;
  const env = envelope(event, local, duration);

  if (event.kind === 'tone') {
    const am = event.amHz
      ? 1 + (event.amDepth ?? 0.25) * Math.sin(2 * Math.PI * event.amHz * local)
      : 1;
    const reverse = event.reverseEverySec
      ? (Math.floor(local / event.reverseEverySec) % 2 === 0 ? 1 : -1)
      : 1;
    return event.amp * env * am * reverse * Math.sin(2 * Math.PI * event.freqHz * local);
  }

  if (event.kind === 'chirp') {
    const rate = (event.toHz - event.fromHz) / Math.max(1e-6, duration);
    const phase = 2 * Math.PI * (event.fromHz * local + 0.5 * rate * local * local);
    return event.amp * env * Math.sin(phase);
  }

  if (event.kind === 'fsk') {
    const symbol = Math.min(event.bits.length - 1, Math.max(0, Math.floor(local * event.baud)));
    const within = local - symbol / event.baud;
    const freq = event.bits[symbol] ? event.highHz : event.lowHz;
    const phase = event.phaseOffsets[symbol] + 2 * Math.PI * freq * within;
    return event.amp * env * Math.sin(phase);
  }

  if (event.kind === 'multitone') {
    let sum = 0;
    for (let i = 0; i < event.freqsHz.length; i++) {
      sum += Math.sin(2 * Math.PI * event.freqsHz[i] * local + event.phases[i]);
    }
    return event.amp * env * sum / Math.sqrt(Math.max(1, event.freqsHz.length));
  }

  let sum = 0;
  for (let i = 0; i < event.freqsHz.length; i++) {
    sum += Math.sin(2 * Math.PI * event.freqsHz[i] * local);
  }
  return event.amp * Math.exp(-event.decay * local) * sum / Math.sqrt(event.freqsHz.length);
}

export function renderAlgorithmicPlan(plan: AlgorithmicPlan): Float32Array {
  const length = Math.ceil(plan.durationSec * plan.sampleRate);
  const samples = new Float32Array(length);

  for (const event of plan.events) {
    const start = Math.max(0, Math.floor(event.startSec * plan.sampleRate));
    const end = Math.min(length, Math.ceil(event.endSec * plan.sampleRate));
    for (let i = start; i < end; i++) {
      samples[i] += renderEventAt(event, i / plan.sampleRate);
    }
  }

  const warmthNorm = 1 / Math.tanh(1.12);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.tanh(samples[i] * 1.12) * warmthNorm;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak > 0.90) {
    const scale = 0.90 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }

  return samples;
}
