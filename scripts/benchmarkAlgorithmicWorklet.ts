import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { SAMPLE_RATE } from '../src/audio/dialupDsp';
import { buildAlgorithmicPlan } from '../src/audio/generator/generator';
import { createAlgorithmicDialupWorkletProcessorCode } from '../src/audio/generator/worklet';

let Processor: any = null;
class Stub {
  port = { onmessage: null as any, postMessage: (_m: unknown) => {} };
}

vm.runInNewContext(createAlgorithmicDialupWorkletProcessorCode(), {
  AudioWorkletProcessor: Stub,
  registerProcessor: (_name: string, cls: any) => { Processor = cls; },
  sampleRate: SAMPLE_RATE,
  Math,
  Float32Array,
  Number,
  Array,
  Object,
});

const plan = buildAlgorithmicPlan();
const processor = new Processor();
processor.port.onmessage({ data: { type: 'load-plan', plan } });
processor.port.onmessage({ data: { type: 'play', offsetSec: 0, endSec: plan.durationSec } });

const totalSamples = Math.ceil(plan.durationSec * SAMPLE_RATE);
let rendered = 0;
const t0 = performance.now();
while (rendered < totalSamples) {
  const len = Math.min(128, totalSamples - rendered);
  const out = new Float32Array(len);
  processor.process([], [[out]]);
  rendered += len;
}
const elapsedSec = (performance.now() - t0) / 1000;
console.log('audioSeconds=' + plan.durationSec.toFixed(3));
console.log('cpuSeconds=' + elapsedSec.toFixed(3));
console.log('realtimeHeadroom=' + (plan.durationSec / elapsedSec).toFixed(1) + 'x');
