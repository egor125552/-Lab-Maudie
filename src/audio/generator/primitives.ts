import type { ModemSide, SynthEvent } from './types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBits(seed: number, count: number): number[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => (random() >= 0.5 ? 1 : 0));
}

export function fskEvent(
  side: ModemSide,
  startSec: number,
  durationSec: number,
  amp: number,
  lowHz: number,
  highHz: number,
  baud: number,
  seed: number
): SynthEvent {
  const symbols = Math.max(1, Math.ceil(durationSec * baud));
  const bits = makeBits(seed, symbols);
  const phaseOffsets = new Array<number>(symbols);
  let cycles = 0;
  for (let i = 0; i < symbols; i++) {
    phaseOffsets[i] = 2 * Math.PI * cycles;
    const f = bits[i] ? highHz : lowHz;
    cycles += f / baud;
  }
  return {
    kind: 'fsk',
    side,
    startSec,
    endSec: startSec + durationSec,
    amp,
    lowHz,
    highHz,
    baud,
    bits,
    phaseOffsets,
    edgeSec: 0.004,
  };
}

export function randomMultitone(
  side: ModemSide,
  startSec: number,
  durationSec: number,
  amp: number,
  minHz: number,
  maxHz: number,
  count: number,
  seed: number
): SynthEvent {
  const random = mulberry32(seed);
  const freqsHz: number[] = [];
  const phases: number[] = [];
  for (let i = 0; i < count; i++) {
    freqsHz.push(minHz + (maxHz - minHz) * random());
    phases.push(2 * Math.PI * random());
  }
  return {
    kind: 'multitone',
    side,
    startSec,
    endSec: startSec + durationSec,
    amp,
    freqsHz,
    phases,
    edgeSec: 0.012,
  };
}

export function combFrequencies(): number[] {
  const omitted = new Set([900, 1200, 1800, 2400]);
  const out: number[] = [];
  for (let f = 150; f <= 3750; f += 150) {
    if (!omitted.has(f)) out.push(f);
  }
  return out;
}

export function dtmfPair(digit: string): [number, number] | null {
  const map: Record<string, [number, number]> = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
  };
  return map[digit] ?? null;
}
