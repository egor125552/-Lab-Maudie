import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  buildExactReferenceGraphPlan,
  getReferenceGraphDenseCoefficients,
  renderReferenceGraphPlan,
} from './referenceGraph';
import { createReferenceGraphWorkletProcessorCode } from './referenceGraphWorklet';

function createProcessor() {
  let Processor: any = null;

  class AudioWorkletProcessorStub {
    port = {
      onmessage: null as ((event: { data: any }) => void) | null,
      postMessage: (_message: any) => {},
    };
  }

  const context = {
    AudioWorkletProcessor: AudioWorkletProcessorStub,
    registerProcessor: (name: string, cls: any) => {
      assert.equal(name, 'reference-graph-worklet');
      Processor = cls;
    },
    Math,
    Float32Array,
    Int8Array,
    Number,
    Array,
    Object,
  };

  vm.runInNewContext(createReferenceGraphWorkletProcessorCode(), context);
  assert.ok(Processor);
  return new Processor();
}

function renderSegment(
  processor: any,
  startSec: number,
  durationSec: number
): Float32Array {
  processor.port.onmessage({
    data: {
      type: 'play',
      offsetSec: startSec,
      endSec: startSec + durationSec,
    },
  });

  const total = Math.floor(durationSec * 44100);
  const result = new Float32Array(total);
  let offset = 0;

  while (offset < total) {
    const len = Math.min(128, total - offset);
    const block = new Float32Array(len);
    processor.process([], [[block]]);
    result.set(block, offset);
    offset += len;
  }

  return result;
}

function maxError(
  actual: Float32Array,
  expected: Float32Array,
  expectedStart: number
): number {
  let worst = 0;
  for (let i = 0; i < actual.length; i++) {
    worst = Math.max(
      worst,
      Math.abs(actual[i] - expected[expectedStart + i])
    );
  }
  return worst;
}

test('reference graph AudioWorklet matches exact clone at start and after seeking', () => {
  const plan = buildExactReferenceGraphPlan();
  const rendered = renderReferenceGraphPlan(plan);
  const processor = createProcessor();

  processor.port.onmessage({
    data: {
      type: 'load-reference-model',
      model: {
        plan,
        denseCoefficients: getReferenceGraphDenseCoefficients(),
        dialDigits: '181828440598',
        normalizationGain: rendered.normalizationGain,
      },
    },
  });

  const first = renderSegment(processor, 0, 4.2);
  const firstError = maxError(first, rendered.samples, 0);
  assert.ok(firstError < 2e-6, `start mismatch ${firstError}`);

  const seekSec = 13.72;
  const later = renderSegment(processor, seekSec, 1.4);
  const laterError = maxError(
    later,
    rendered.samples,
    Math.floor(seekSec * 44100)
  );
  assert.ok(laterError < 2e-6, `seek mismatch ${laterError}`);
});


test('reference graph AudioWorklet matches the exact clone for the full connection', () => {
  const plan = buildExactReferenceGraphPlan();
  const rendered = renderReferenceGraphPlan(plan);
  const processor = createProcessor();

  processor.port.onmessage({
    data: {
      type: 'load-reference-model',
      model: {
        plan,
        denseCoefficients: getReferenceGraphDenseCoefficients(),
        dialDigits: '181828440598',
        normalizationGain: rendered.normalizationGain,
      },
    },
  });

  const full = renderSegment(processor, 0, rendered.durationSec);
  assert.equal(full.length, rendered.samples.length);
  const error = maxError(full, rendered.samples, 0);
  assert.ok(error < 2e-6, `full connection mismatch ${error}`);
});
