import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import {
  buildExactReferenceGraphPlan,
  getReferenceGraphDenseCoefficients,
  renderReferenceGraphPlan,
} from '../src/audio/generator/referenceGraph';
import { createReferenceGraphWorkletProcessorCode } from '../src/audio/generator/referenceGraphWorklet';

let Processor: any = null;
class Stub {
  port = { onmessage: null as any, postMessage: (_m: unknown) => {} };
}
vm.runInNewContext(createReferenceGraphWorkletProcessorCode(), {
  AudioWorkletProcessor: Stub,
  registerProcessor: (_name: string, cls: any) => { Processor = cls; },
  Math,
  Float32Array,
  Int8Array,
  Number,
  Array,
  Object,
});

const plan = buildExactReferenceGraphPlan();
const rendered = renderReferenceGraphPlan(plan);
const processor = new Processor();
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
processor.port.onmessage({
  data: { type: 'play', offsetSec: 0, endSec: rendered.durationSec },
});

const total = rendered.samples.length;
let done = 0;
const t0 = performance.now();
while (done < total) {
  const len = Math.min(128, total - done);
  const block = new Float32Array(len);
  processor.process([], [[block]]);
  done += len;
}
const cpuSec = (performance.now() - t0) / 1000;
console.log('audioSeconds=' + rendered.durationSec.toFixed(3));
console.log('cpuSeconds=' + cpuSec.toFixed(3));
console.log('realtimeHeadroom=' + (rendered.durationSec / cpuSec).toFixed(1) + 'x');
