import {
  DEFAULT_CONFIG,
  SAMPLE_RATE,
  getDense10msFrameTable,
  getPhasesForSource,
  renderFrameSequenceTo44k,
  type HandshakePhase,
} from '../dialupDsp';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAME_HOP_SAMPLES = 440;
const FRAME_HOP_SEC = FRAME_HOP_SAMPLES / SAMPLE_RATE;

export interface ReferenceStageFrameRange {
  id: HandshakePhase['id'];
  startFrame: number;
  endFrame: number;
}

export const REFERENCE_STAGE_FRAME_RANGES: readonly ReferenceStageFrameRange[] = [
  { id: 'dialing', startFrame: 0, endFrame: 350 },
  { id: 'waiting', startFrame: 351, endFrame: 884 },
  { id: 'ansam', startFrame: 885, endFrame: 1209 },
  { id: 'probe', startFrame: 1210, endFrame: 1353 },
  { id: 'training', startFrame: 1354, endFrame: 1607 },
  { id: 'waterfall', startFrame: 1608, endFrame: 2013 },
  { id: 'connect', startFrame: 2014, endFrame: 2539 },
];

export interface ReferenceGraphStageSlice {
  id: HandshakePhase['id'];
  outputStartFrame: number;
  outputEndFrame: number;
}

export interface ReferenceGraphPlan {
  sampleRate: number;
  seed: number;
  variation: boolean;
  frameSequence: Uint16Array;
  durationSec: number;
  phases: HandshakePhase[];
  stageSlices: ReferenceGraphStageSlice[];
  transitionScores: number[];
}

export interface ReferenceGraphRender {
  sampleRate: number;
  durationSec: number;
  samples: Float32Array;
  phases: HandshakePhase[];
  normalizationGain: number;
}

function appendRange(out: number[], start: number, end: number): void {
  for (let frame = start; frame <= end; frame++) out.push(frame);
}

function appendRepeat(
  out: number[],
  start: number,
  end: number,
  repeats: number,
  transitionScores: number[]
): void {
  for (let i = 0; i < repeats; i++) {
    appendRange(out, start, end);
    transitionScores.push(0);
  }
}

function makePhases(
  stageSlices: ReferenceGraphStageSlice[],
  durationSec: number,
  variation: boolean
): HandshakePhase[] {
  const template = getPhasesForSource('synth', 25.342403628117914);

  if (!variation) {
    return template.map((phase) => ({ ...phase }));
  }

  return stageSlices.map((slice, index) => {
    const base = template[index];
    return {
      ...base,
      startSec: slice.outputStartFrame * FRAME_HOP_SEC,
      endSec:
        index === stageSlices.length - 1
          ? durationSec
          : slice.outputEndFrame * FRAME_HOP_SEC,
      simpleSummary:
        index === 0
          ? base.simpleSummary
          : `${base.simpleSummary} Этот вариант идёт другим проверенным путём той же модели.`,
    };
  });
}

function appendStageVariation(
  out: number[],
  range: ReferenceStageFrameRange,
  random: () => number,
  transitionScores: number[]
): void {
  switch (range.id) {
    case 'dialing':
    case 'waiting':
    case 'probe':
      appendRange(out, range.startFrame, range.endFrame);
      return;

    case 'ansam': {
      appendRange(out, 885, 1097);
      appendRepeat(out, 1035, 1097, 1 + (random() < 0.45 ? 1 : 0), transitionScores);
      appendRange(out, 1098, 1207);
      appendRepeat(out, 1128, 1207, random() < 0.55 ? 1 : 0, transitionScores);
      appendRange(out, 1208, 1209);
      return;
    }

    case 'training': {
      appendRange(out, 1354, 1572);
      if (random() < 0.72) {
        appendRepeat(out, 1410, 1572, 1 + (random() < 0.30 ? 1 : 0), transitionScores);
        appendRange(out, 1438, 1607);
      } else {
        appendRange(out, 1573, 1607);
      }
      return;
    }

    case 'waterfall': {
      appendRange(out, 1608, 1985);
      if (random() < 0.78) {
        appendRepeat(out, 1670, 1985, 1 + (random() < 0.24 ? 1 : 0), transitionScores);
        appendRange(out, 1822, 2013);
      } else {
        appendRange(out, 1986, 2013);
      }
      return;
    }

    case 'connect': {
      appendRange(out, 2014, 2184);
      if (random() < 0.82) {
        appendRepeat(out, 2065, 2184, 1 + (random() < 0.28 ? 1 : 0), transitionScores);
        appendRange(out, 2095, 2227);
      } else {
        appendRange(out, 2185, 2227);
      }

      appendRange(out, 2228, 2465);
      if (random() < 0.75) {
        appendRepeat(out, 2288, 2465, 1 + (random() < 0.22 ? 1 : 0), transitionScores);
        appendRange(out, 2288, 2539);
      } else {
        appendRange(out, 2466, 2539);
      }
      return;
    }
  }
}

export function buildReferenceGraphPlan(options: {
  seed: number;
  variation: boolean;
}): ReferenceGraphPlan {
  const random = mulberry32(options.seed >>> 0);
  const output: number[] = [];
  const stageSlices: ReferenceGraphStageSlice[] = [];
  const transitionScores: number[] = [];

  for (const range of REFERENCE_STAGE_FRAME_RANGES) {
    const outputStartFrame = output.length;

    if (options.variation) {
      appendStageVariation(output, range, random, transitionScores);
    } else {
      appendRange(output, range.startFrame, range.endFrame);
    }

    stageSlices.push({
      id: range.id,
      outputStartFrame,
      outputEndFrame: output.length,
    });
  }

  const frameSequence = Uint16Array.from(output);
  const durationSec = frameSequence.length * FRAME_HOP_SEC;

  return {
    sampleRate: SAMPLE_RATE,
    seed: options.seed >>> 0,
    variation: options.variation,
    frameSequence,
    durationSec,
    phases: makePhases(stageSlices, durationSec, options.variation),
    stageSlices,
    transitionScores,
  };
}

export function renderReferenceGraphPlan(
  plan: ReferenceGraphPlan
): ReferenceGraphRender {
  const raw = renderFrameSequenceTo44k(plan.frameSequence, false);
  const samples = new Float32Array(raw);

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const normalizationGain = peak > 0.001 ? 0.90 / peak : 1;
  if (normalizationGain !== 1) {
    for (let i = 0; i < samples.length; i++) samples[i] *= normalizationGain;
  }

  return {
    sampleRate: SAMPLE_RATE,
    durationSec: samples.length / SAMPLE_RATE,
    samples,
    phases: plan.phases,
    normalizationGain,
  };
}

export function buildExactReferenceGraphPlan(): ReferenceGraphPlan {
  return buildReferenceGraphPlan({ seed: 0, variation: false });
}

export function getReferenceGraphDenseCoefficients(): Int8Array {
  return new Int8Array(getDense10msFrameTable());
}

export const REFERENCE_GRAPH_DEFAULT_PHONE = DEFAULT_CONFIG.phoneNumber;
