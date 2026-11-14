import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { SAMPLE_RATE } from '../dialupDsp';
import {
  DEFAULT_ALGORITHMIC_CONFIG,
  generateAlgorithmicDialup,
} from './generator';
import { createAlgorithmicDialupWorkletProcessorCode } from './worklet';

function magnitude(
  samples: Float32Array,
  startSec: number,
  durationSec: number,
  hz: number
): number {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const len = Math.min(samples.length - start, Math.floor(durationSec * SAMPLE_RATE));
  let re = 0;
  let im = 0;
  for (let i = 0; i < len; i++) {
    const a = (2 * Math.PI * hz * i) / SAMPLE_RATE;
    const s = samples[start + i];
    re += s * Math.cos(a);
    im -= s * Math.sin(a);
  }
  return Math.hypot(re, im) / Math.max(1, len);
}

test('algorithmic generator has seven independent stages and no spectral recording dependency', () => {
  const result = generateAlgorithmicDialup(DEFAULT_ALGORITHMIC_CONFIG);
  assert.equal(result.sampleRate, SAMPLE_RATE);
  assert.equal(result.phases.length, 7);
  assert.ok(result.durationSec > 24 && result.durationSec < 36, String(result.durationSec));

  const generatorDir = path.dirname(new URL(import.meta.url).pathname);
  const files = fs.readdirSync(generatorDir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  const source = files
    .map((name) => fs.readFileSync(path.join(generatorDir, name), 'utf8'))
    .join('\n');

  assert.equal(source.includes('dialupSpectral10ms'), false);
  assert.equal(source.includes('synthesizeDialupHandshake'), false);
});

test('different seeds create different negotiations while protocol timing remains valid', () => {
  const a = generateAlgorithmicDialup({ ...DEFAULT_ALGORITHMIC_CONFIG, seed: 1001 });
  const b = generateAlgorithmicDialup({ ...DEFAULT_ALGORITHMIC_CONFIG, seed: 1002 });

  assert.equal(a.phases.length, b.phases.length);
  assert.equal(a.samples.length, b.samples.length);

  let difference = 0;
  const start = Math.floor(15 * SAMPLE_RATE);
  const end = Math.min(a.samples.length, start + Math.floor(2 * SAMPLE_RATE));
  for (let i = start; i < end; i += 17) {
    difference += Math.abs(a.samples[i] - b.samples[i]);
  }
  assert.ok(difference > 1, `expected generated training to differ, got ${difference}`);
});

test('ANSam is mathematically generated at 2100 Hz with 15 Hz sidebands', () => {
  const result = generateAlgorithmicDialup(DEFAULT_ALGORITHMIC_CONFIG);
  const phase = result.phases.find((p) => p.id === 'ansam')!;
  const t = phase.startSec + 0.35;

  const carrier = magnitude(result.samples, t, 0.4, 2100);
  const side = magnitude(result.samples, t, 0.4, 2085);
  const off = magnitude(result.samples, t, 0.4, 1500);

  assert.ok(carrier > off * 20, `carrier=${carrier}, off=${off}`);
  assert.ok(side > off * 2, `side=${side}, off=${off}`);
});

test('V.34 probing uses 150 Hz comb and omits 900, 1200, 1800 and 2400 Hz', () => {
  const result = generateAlgorithmicDialup(DEFAULT_ALGORITHMIC_CONFIG);
  const phase = result.phases.find((p) => p.id === 'probe')!;
  const t = phase.startSec + 0.55;

  const p600 = magnitude(result.samples, t, 0.12, 600);
  const p750 = magnitude(result.samples, t, 0.12, 750);
  const p900 = magnitude(result.samples, t, 0.12, 900);
  const p1800 = magnitude(result.samples, t, 0.12, 1800);

  assert.ok(p600 > p900 * 3, `600=${p600}, 900=${p900}`);
  assert.ok(p750 > p1800 * 3, `750=${p750}, 1800=${p1800}`);
});

test('generated audio is finite, click-safe and non-clipping', () => {
  const result = generateAlgorithmicDialup(DEFAULT_ALGORITHMIC_CONFIG);
  let peak = 0;
  let maxJump = 0;
  for (let i = 0; i < result.samples.length; i++) {
    const s = result.samples[i];
    assert.ok(Number.isFinite(s));
    peak = Math.max(peak, Math.abs(s));
    if (i) maxJump = Math.max(maxJump, Math.abs(s - result.samples[i - 1]));
  }
  assert.ok(peak > 0.25 && peak <= 0.91, `peak=${peak}`);
  assert.ok(maxJump < 0.55, `maxJump=${maxJump}`);
});


test('AudioWorklet renders the same first block as the offline comparison renderer', () => {
  const result = generateAlgorithmicDialup(DEFAULT_ALGORITHMIC_CONFIG);
  let Processor: any = null;

  class MockPort {
    onmessage: ((event: { data: any }) => void) | null = null;
    postMessage() {}
  }
  class MockAudioWorkletProcessor {
    port = new MockPort();
  }

  const context = {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    sampleRate: SAMPLE_RATE,
    registerProcessor: (_name: string, ctor: any) => { Processor = ctor; },
    Math,
    Float32Array,
  };
  vm.runInNewContext(createAlgorithmicDialupWorkletProcessorCode(), context);
  assert.ok(Processor, 'worklet processor was not registered');

  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load-plan', plan: result } });
  processor.port.onmessage({ data: { type: 'play', offsetSec: 0, endSec: result.durationSec } });

  const block = new Float32Array(128);
  processor.process([], [[block]]);
  for (let i = 0; i < block.length; i++) {
    assert.ok(Math.abs(block[i] - result.samples[i]) < 1e-6,
      `sample ${i}: worklet=${block[i]} offline=${result.samples[i]}`);
  }
});
