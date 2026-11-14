import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SAMPLE_RATE } from '../dialupDsp';
import { buildAlgorithmicPlan } from './generator';
import { renderAlgorithmicPlan } from './render';
import { createAlgorithmicDialupWorkletProcessorCode } from './worklet';

test('AudioWorklet renders the same mathematical signal as the offline comparator', () => {
  const plan = buildAlgorithmicPlan();
  const expected = renderAlgorithmicPlan(plan);
  const code = createAlgorithmicDialupWorkletProcessorCode();

  let Processor: any = null;

  class AudioWorkletProcessorStub {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (_message: unknown) => {},
    };
  }

  const context = {
    AudioWorkletProcessor: AudioWorkletProcessorStub,
    registerProcessor: (name: string, cls: any) => {
      assert.equal(name, 'algorithmic-dialup-worklet');
      Processor = cls;
    },
    sampleRate: SAMPLE_RATE,
    Math,
    Float32Array,
    Number,
    Array,
    Object,
  };

  vm.runInNewContext(code, context);
  assert.ok(Processor, 'worklet processor was not registered');

  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load-plan', plan } });
  processor.port.onmessage({ data: { type: 'gain', value: 1 } });
  processor.port.onmessage({ data: { type: 'play', offsetSec: 0, endSec: 2 } });

  const actual = new Float32Array(2 * SAMPLE_RATE);
  let offset = 0;
  while (offset < actual.length) {
    const block = new Float32Array(Math.min(128, actual.length - offset));
    processor.process([], [[block]]);
    actual.set(block, offset);
    offset += block.length;
  }

  let worst = 0;
  for (let i = 0; i < actual.length; i++) {
    worst = Math.max(worst, Math.abs(actual[i] - expected[i]));
  }

  assert.ok(worst < 1e-6, `offline/worklet mismatch: ${worst}`);
});
