import type { StagePlugin, SynthEvent } from '../types';
import { randomMultitone } from '../primitives';

export const trainingStage: StagePlugin = {
  id: 'training',
  build({ startSec, seed }) {
    const events: SynthEvent[] = [
      {
        kind: 'multitone', side: 'caller',
        startSec, endSec: startSec + 0.08,
        amp: 0.08, freqsHz: [600, 3000], phases: [0, 0.3], edgeSec: 0.003,
      },
      randomMultitone('caller', startSec + 0.02, 0.92, 0.17, 2450, 3300, 22, seed + 41),
      randomMultitone('answer', startSec + 0.44, 0.92, 0.13, 2700, 3350, 18, seed + 42),
      {
        kind: 'chirp', side: 'caller',
        startSec: startSec + 0.94, endSec: startSec + 1.52,
        amp: 0.12, fromHz: 3350, toHz: 2750, edgeSec: 0.006,
      },
      randomMultitone('caller', startSec + 1.28, 1.16, 0.17, 2600, 3400, 18, seed + 43),
      randomMultitone('answer', startSec + 1.62, 0.82, 0.11, 2850, 3300, 12, seed + 44),
      {
        kind: 'tone', side: 'answer',
        startSec: startSec + 2.43, endSec: startSec + 2.51,
        amp: 0.12, freqHz: 1333, edgeSec: 0.003,
      },
    ];
    return {
      durationSec: 2.53,
      events,
      phase: {
        id: 'training', index: 5, shortLabel: '5. Высокий визг',
        title: 'Высокочастотная тренировка несущей',
        ituCode: 'V.34 Phase 3',
        atLog: 'high-band training → 1333',
        freqSummary: '2.45–3.4 кГц, короткое подтверждение 1333 Гц',
        simpleSummary: 'Почти весь этап держится в высоком диапазоне, как в эталоне.',
        plainExplanation: 'Высокие группы тонов и проходы частоты генерируются заново для каждой попытки.',
      },
    };
  },
};
