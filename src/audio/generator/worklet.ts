import type { AlgorithmicPlan } from './types';

export function createAlgorithmicDialupWorkletProcessorCode(): string {
  return String.raw`
function eventEnvelope(event, localSec, durationSec) {
  const edge = event.edgeSec === undefined ? 0.006 : event.edgeSec;
  if (edge <= 0) return 1;
  const a = Math.min(1, Math.max(0, localSec / edge));
  const b = Math.min(1, Math.max(0, (durationSec - localSec) / edge));
  const x = Math.min(a, b);
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

function renderEvent(event, timeSec) {
  if (timeSec < event.startSec || timeSec >= event.endSec) return 0;
  const local = timeSec - event.startSec;
  const duration = event.endSec - event.startSec;
  const env = eventEnvelope(event, local, duration);

  if (event.kind === 'tone') {
    const am = event.amHz
      ? 1 + (event.amDepth || 0.25) * Math.sin(2 * Math.PI * event.amHz * local)
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

class AlgorithmicDialupProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.plan = null;
    this.cursor = 0;
    this.endCursor = 0;
    this.playing = false;
    this.gain = 1;
    this.blockCounter = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'load-plan') {
        this.plan = msg.plan;
        this.cursor = 0;
        this.endCursor = this.plan ? this.plan.durationSec * this.plan.sampleRate : 0;
      } else if (msg.type === 'play' && this.plan) {
        const startSec = Math.max(0, Math.min(this.plan.durationSec, msg.offsetSec || 0));
        const endSec = typeof msg.endSec === 'number'
          ? Math.max(startSec, Math.min(this.plan.durationSec, msg.endSec))
          : this.plan.durationSec;
        this.cursor = startSec * this.plan.sampleRate;
        this.endCursor = endSec * this.plan.sampleRate;
        this.playing = true;
      } else if (msg.type === 'stop') {
        this.playing = false;
      } else if (msg.type === 'gain') {
        this.gain = Math.max(0, Math.min(1.5, Number(msg.value) || 0));
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const ch = output[0];

    if (!this.playing || !this.plan) {
      ch.fill(0);
      for (let c = 1; c < output.length; c++) output[c].fill(0);
      return true;
    }

    const ratio = this.plan.sampleRate / sampleRate;
    const blockStartSec = this.cursor / this.plan.sampleRate;
    const blockEndSec = blockStartSec + (ch.length * ratio) / this.plan.sampleRate;
    const activeEvents = this.plan.events.filter(
      (event) => event.endSec > blockStartSec && event.startSec < blockEndSec
    );
    let ended = false;

    for (let i = 0; i < ch.length; i++) {
      if (this.cursor >= this.endCursor) {
        ch[i] = 0;
        ended = true;
        continue;
      }

      const timeSec = this.cursor / this.plan.sampleRate;
      let sample = 0;
      for (let e = 0; e < activeEvents.length; e++) {
        sample += renderEvent(activeEvents[e], timeSec);
      }

      ch[i] = 0.90 * Math.tanh(sample * 1.12) / Math.tanh(1.12) * this.gain;
      this.cursor += ratio;
    }

    for (let c = 1; c < output.length; c++) output[c].set(ch);

    this.blockCounter++;
    if (this.blockCounter % 6 === 0) {
      this.port.postMessage({
        type: 'position',
        timeSec: this.cursor / this.plan.sampleRate,
      });
    }

    if (ended) {
      this.playing = false;
      this.port.postMessage({
        type: 'ended',
        timeSec: this.endCursor / this.plan.sampleRate,
      });
    }
    return true;
  }
}

registerProcessor('algorithmic-dialup-worklet', AlgorithmicDialupProcessor);
`;
}

export function serializeAlgorithmicPlan(plan: AlgorithmicPlan): AlgorithmicPlan {
  return plan;
}
