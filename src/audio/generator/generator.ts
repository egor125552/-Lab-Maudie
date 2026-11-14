import { SAMPLE_RATE } from '../dialupDsp';
import { renderAlgorithmicPlan } from './render';
import type {
  AlgorithmicDialupConfig,
  AlgorithmicDialupResult,
  AlgorithmicPlan,
  StagePlugin,
} from './types';
import { dialingStage } from './stages/dialing';
import { waitingStage } from './stages/waiting';
import { ansamStage } from './stages/ansam';
import { probeStage } from './stages/probe';
import { trainingStage } from './stages/training';
import { waterfallStage } from './stages/waterfall';
import { connectStage } from './stages/connect';

export const DEFAULT_ALGORITHMIC_CONFIG: AlgorithmicDialupConfig = {
  seed: 19980915,
  phoneNumber: '181828440598',
  lineQuality: 1,
};

export const ALGORITHMIC_STAGES: readonly StagePlugin[] = [
  dialingStage,
  waitingStage,
  ansamStage,
  probeStage,
  trainingStage,
  waterfallStage,
  connectStage,
];

export function buildAlgorithmicPlan(
  config: AlgorithmicDialupConfig = DEFAULT_ALGORITHMIC_CONFIG
): AlgorithmicPlan {
  const safeConfig: AlgorithmicDialupConfig = {
    seed: Number.isFinite(config.seed) ? Math.trunc(config.seed) : DEFAULT_ALGORITHMIC_CONFIG.seed,
    phoneNumber: config.phoneNumber || DEFAULT_ALGORITHMIC_CONFIG.phoneNumber,
    lineQuality: Math.max(0, Math.min(1, config.lineQuality)),
  };

  const events: AlgorithmicPlan['events'] = [];
  const phases: AlgorithmicPlan['phases'] = [];
  let cursor = 0;

  for (let index = 0; index < ALGORITHMIC_STAGES.length; index++) {
    const plugin = ALGORITHMIC_STAGES[index];
    const built = plugin.build({
      sampleRate: SAMPLE_RATE,
      config: safeConfig,
      seed: safeConfig.seed + index * 1000,
      startSec: cursor,
    });
    events.push(...built.events);
    phases.push({
      ...built.phase,
      startSec: cursor,
      endSec: cursor + built.durationSec,
    });
    cursor += built.durationSec;
  }

  return {
    sampleRate: SAMPLE_RATE,
    durationSec: cursor,
    events,
    phases,
    seed: safeConfig.seed,
  };
}

export function generateAlgorithmicDialup(
  config: AlgorithmicDialupConfig = DEFAULT_ALGORITHMIC_CONFIG
): AlgorithmicDialupResult {
  const plan = buildAlgorithmicPlan(config);
  return {
    ...plan,
    samples: renderAlgorithmicPlan(plan),
  };
}

export type {
  AlgorithmicDialupConfig,
  AlgorithmicDialupResult,
  AlgorithmicPlan,
} from './types';
