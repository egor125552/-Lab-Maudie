import type { ReferenceGraphPlan } from './referenceGraph';

export interface ReferenceGraphWorkletModel {
  plan: ReferenceGraphPlan;
  denseCoefficients: Int8Array;
  normalizationGain: number;
  dialDigits?: string;
}

export function createReferenceGraphWorkletProcessorCode(): string {
  return String.raw`
class ReferenceGraphDialupProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sequence = null;
    this.coeffs = null;
    this.numBins = 80;
    this.M11 = 110;
    this.M44 = 440;
    this.N44 = 880;
    this.basis = null;
    this.dequant = null;
    this.ola = new Float32Array(this.N44);
    this.hop = new Float32Array(this.M44);
    this.hopOffset = this.M44;
    this.framePos = 0;
    this.currentSample = 0;
    this.stopAtSample = 0;
    this.playing = false;
    this.normalizationGain = 1;
    this.blocks = 0;
    this.ready = false;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'load-reference-model') {
        const model = msg.model;
        this.sequence = model.plan.frameSequence;
        this.coeffs = model.denseCoefficients;
        this.dialDigits = model.dialDigits || '181828440598';
        this.normalizationGain = model.normalizationGain || 1;
        this.buildTables();
        this.resetAtSample(0);
        this.ready = true;
        this.port.postMessage({ type: 'ready' });
      } else if (msg.type === 'play') {
        if (!this.ready || !this.sequence || !this.coeffs) return;
        const durationSamples = this.sequence.length * this.M44;
        const startSample = Math.max(
          0,
          Math.min(durationSamples - 1, Math.floor((msg.offsetSec || 0) * 44100))
        );
        this.stopAtSample =
          typeof msg.endSec === 'number'
            ? Math.min(durationSamples, Math.floor(msg.endSec * 44100))
            : durationSamples;
        this.resetAtSample(startSample);
        this.playing = true;
      } else if (msg.type === 'stop') {
        this.playing = false;
      }
    };
  }

  buildTables() {
    if (this.basis && this.dequant) return;

    this.basis = new Float32Array(this.numBins * this.N44);
    const scale = Math.sqrt(2 / this.M11);

    for (let b = 0; b < this.numBins; b++) {
      const k = 2 + b;
      const freqHz = ((k + 0.5) * 44100) / this.N44;
      const eqBoost =
        freqHz > 1800
          ? 1.0 + 0.28 * Math.min(1, (freqHz - 1800) / 2000)
          : 1.0;

      for (let n = 0; n < this.N44; n++) {
        const win = Math.sin((Math.PI * (n + 0.5)) / this.N44);
        const t11 = (n + 0.5) / 4;
        this.basis[b * this.N44 + n] =
          win *
          scale *
          eqBoost *
          Math.cos(
            (Math.PI / this.M11) *
              (t11 + this.M11 / 2) *
              (k + 0.5)
          );
      }
    }

    this.dequant = new Float32Array(256);
    for (let q = -128; q <= 127; q++) {
      const sign = q < 0 ? -1 : 1;
      this.dequant[q & 0xff] =
        sign * Math.pow(Math.abs(q) / 127, 2) * 1.65;
    }
  }

  addFrameToOla(sourceFrame) {
    const coeffOffset = sourceFrame * this.numBins;
    const gateThreshold = sourceFrame < 1354 ? 4 : 1;

    for (let b = 0; b < this.numBins; b++) {
      const q = this.coeffs[coeffOffset + b];
      if (q === 0 || Math.abs(q) <= gateThreshold) continue;

      const value = this.dequant[q & 0xff];
      const basisOffset = b * this.N44;
      for (let n = 0; n < this.N44; n++) {
        this.ola[n] += value * this.basis[basisOffset + n];
      }
    }
  }

  directLineRaw(sampleIndex) {
    const clearEnd = Math.floor(3.42 * 44100);
    if (sampleIndex >= clearEnd) return null;

    let value = 0;

    const clickStart = Math.floor(0.018 * 44100);
    const clickLen = Math.floor(0.014 * 44100);
    if (sampleIndex >= clickStart && sampleIndex < clickStart + clickLen) {
      const i = sampleIndex - clickStart;
      const t = i / 44100;
      const env = Math.exp(-t * 320);
      value +=
        env *
        (0.22 * Math.sin(2 * Math.PI * 1180 * t) +
          0.14 * Math.sin(2 * Math.PI * 2650 * t));
    }

    const dialStart = Math.floor(0.035 * 44100);
    const dialEnd = Math.floor(1.04 * 44100);
    const fadeSamples = Math.floor(0.008 * 44100);
    if (sampleIndex >= dialStart && sampleIndex < dialEnd) {
      const i = sampleIndex - dialStart;
      const t = i / 44100;
      let env = 1;
      if (i < fadeSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * i) / fadeSamples));
      } else if (dialEnd - sampleIndex < fadeSamples) {
        env =
          0.5 *
          (1 -
            Math.cos(
              (Math.PI * (dialEnd - sampleIndex)) / fadeSamples
            ));
      }
      value +=
        env *
        (0.135 * Math.sin(2 * Math.PI * 350 * t) +
          0.135 * Math.sin(2 * Math.PI * 440 * t));
    }

    const digits = this.dialDigits || '181828440598';
    const map = {
      '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
      '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
      '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
      '0': [941, 1336]
    };
    const toneDur = 0.11;
    const gapDur = 0.095;
    const edgeSamples = Math.floor(0.0045 * 44100);
    let cursor = 0.90;

    for (let d = 0; d < digits.length; d++) {
      const start = Math.floor(cursor * 44100);
      const len = Math.floor(toneDur * 44100);
      if (sampleIndex >= start && sampleIndex < start + len) {
        const i = sampleIndex - start;
        const t = i / 44100;
        let env = 1;
        if (i < edgeSamples) {
          env = 0.5 * (1 - Math.cos((Math.PI * i) / edgeSamples));
        } else if (len - 1 - i < edgeSamples) {
          env =
            0.5 *
            (1 -
              Math.cos(
                (Math.PI * (len - 1 - i)) / edgeSamples
              ));
        }
        const pair = map[digits[d]];
        value +=
          env *
          (0.165 * Math.sin(2 * Math.PI * pair[0] * t) +
            0.205 * Math.sin(2 * Math.PI * pair[1] * t));
        break;
      }
      cursor += toneDur + gapDur;
    }

    return value;
  }

  prepareHop() {
    if (!this.sequence || this.framePos >= this.sequence.length) {
      return false;
    }

    const sourceFrame = this.sequence[this.framePos];
    this.addFrameToOla(sourceFrame);

    const hopStartSample = this.framePos * this.M44;
    const tanhNorm = 1 / Math.tanh(1.12);

    for (let n = 0; n < this.M44; n++) {
      const sampleIndex = hopStartSample + n;
      const direct = this.directLineRaw(sampleIndex);
      const raw = direct === null ? this.ola[n] : direct;
      this.hop[n] =
        Math.tanh(raw * 1.12) *
        tanhNorm *
        this.normalizationGain;
    }

    for (let n = 0; n < this.M44; n++) {
      this.ola[n] = this.ola[n + this.M44];
      this.ola[n + this.M44] = 0;
    }

    this.framePos++;
    this.hopOffset = 0;
    return true;
  }

  resetAtSample(targetSample) {
    this.ola.fill(0);
    this.hop.fill(0);

    const targetFrame = Math.floor(targetSample / this.M44);
    const within = targetSample - targetFrame * this.M44;
    this.framePos = Math.min(
      targetFrame,
      this.sequence ? this.sequence.length : 0
    );

    if (
      this.sequence &&
      this.coeffs &&
      this.framePos > 0 &&
      this.framePos - 1 < this.sequence.length
    ) {
      const previousFrame = this.sequence[this.framePos - 1];
      const scratch = new Float32Array(this.N44);
      const savedOla = this.ola;
      this.ola = scratch;
      this.addFrameToOla(previousFrame);
      for (let n = 0; n < this.M44; n++) {
        savedOla[n] = scratch[n + this.M44];
      }
      this.ola = savedOla;
    }

    this.currentSample = targetSample;
    this.hopOffset = this.M44;
    if (this.prepareHop()) {
      this.hopOffset = within;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const ch0 = output[0];

    if (!this.playing || !this.ready) {
      ch0.fill(0);
      for (let c = 1; c < output.length; c++) output[c].fill(0);
      return true;
    }

    let ended = false;

    for (let i = 0; i < ch0.length; i++) {
      if (this.currentSample >= this.stopAtSample) {
        ch0[i] = 0;
        ended = true;
        continue;
      }

      if (this.hopOffset >= this.M44) {
        if (!this.prepareHop()) {
          ch0[i] = 0;
          ended = true;
          continue;
        }
      }

      ch0[i] = this.hop[this.hopOffset++];
      this.currentSample++;
    }

    for (let c = 1; c < output.length; c++) output[c].set(ch0);

    this.blocks++;
    if (this.blocks % 6 === 0) {
      this.port.postMessage({
        type: 'position',
        timeSec: this.currentSample / 44100,
      });
    }

    if (ended) {
      this.playing = false;
      this.port.postMessage({
        type: 'ended',
        timeSec: this.stopAtSample / 44100,
      });
    }

    return true;
  }
}

registerProcessor(
  'reference-graph-worklet',
  ReferenceGraphDialupProcessor
);
`;
}
