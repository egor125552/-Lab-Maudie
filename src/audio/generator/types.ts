import type { HandshakePhase } from '../dialupDsp';

export type ModemSide = 'caller' | 'answer';

export interface AlgorithmicDialupConfig {
  seed: number;
  phoneNumber: string;
  lineQuality: number;
}

export type SynthEvent =
  | {
      kind: 'tone';
      side: ModemSide;
      startSec: number;
      endSec: number;
      amp: number;
      freqHz: number;
      amHz?: number;
      amDepth?: number;
      reverseEverySec?: number;
      edgeSec?: number;
    }
  | {
      kind: 'chirp';
      side: ModemSide;
      startSec: number;
      endSec: number;
      amp: number;
      fromHz: number;
      toHz: number;
      edgeSec?: number;
    }
  | {
      kind: 'fsk';
      side: ModemSide;
      startSec: number;
      endSec: number;
      amp: number;
      lowHz: number;
      highHz: number;
      baud: number;
      bits: number[];
      phaseOffsets: number[];
      edgeSec?: number;
    }
  | {
      kind: 'multitone';
      side: ModemSide;
      startSec: number;
      endSec: number;
      amp: number;
      freqsHz: number[];
      phases: number[];
      edgeSec?: number;
    }
  | {
      kind: 'click';
      side: ModemSide;
      startSec: number;
      endSec: number;
      amp: number;
      freqsHz: number[];
      decay: number;
    };

export interface StageContext {
  sampleRate: number;
  config: AlgorithmicDialupConfig;
  seed: number;
  startSec: number;
}

export interface StageBuild {
  durationSec: number;
  events: SynthEvent[];
  phase: Omit<HandshakePhase, 'startSec' | 'endSec'>;
}

export interface StagePlugin {
  id: string;
  build(context: StageContext): StageBuild;
}

export interface AlgorithmicPlan {
  sampleRate: number;
  durationSec: number;
  events: SynthEvent[];
  phases: HandshakePhase[];
  seed: number;
}

export interface AlgorithmicDialupResult extends AlgorithmicPlan {
  samples: Float32Array;
}
