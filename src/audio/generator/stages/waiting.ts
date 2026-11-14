import type { StagePlugin, SynthEvent } from '../types';
import { fskEvent } from '../primitives';

export const waitingStage: StagePlugin = {
  id: 'waiting',
  build({ startSec, seed }) {
    const events: SynthEvent[] = [
      {
        kind: 'tone', side: 'answer',
        startSec: startSec + 1.72, endSec: startSec + 2.08,
        amp: 0.15, freqHz: 1980, edgeSec: 0.006,
      },
      {
        kind: 'multitone', side: 'answer',
        startSec: startSec + 2.05, endSec: startSec + 2.48,
        amp: 0.14, freqsHz: [2225, 1528], phases: [0.2, 1.3], edgeSec: 0.006,
      },
      fskEvent('caller', startSec + 2.48, 1.18, 0.145, 980, 1180, 300, seed + 11),
      fskEvent('answer', startSec + 3.58, 1.15, 0.14, 1650, 1850, 300, seed + 12),
      fskEvent('caller', startSec + 4.72, 0.42, 0.10, 980, 1180, 300, seed + 13),
    ];
    return {
      durationSec: 5.40,
      events,
      phase: {
        id: 'waiting', index: 2, shortLabel: '2. Первый вызов',
        title: 'Ответ станции и первая перекличка',
        ituCode: 'V.8bis / V.21',
        atLog: 'Answer tones → V.21 FSK exchange',
        freqSummary: '≈2 кГц → 2.2 кГц → 980/1180 → 1650/1850',
        simpleSummary: 'После ожидания второй модем отвечает и оба модема по очереди передают цифровые посылки.',
        plainExplanation: 'Рисунок частот подогнан по текущей удачной версии, но все тоны и данные рождаются математически.',
      },
    };
  },
};
