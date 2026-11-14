import type { StagePlugin, SynthEvent } from '../types';
import { mulberry32, randomMultitone } from '../primitives';

export const connectStage: StagePlugin = {
  id: 'connect',
  build({ startSec, seed }) {
    const random = mulberry32(seed + 61);
    const comb: number[] = [];
    const phases: number[] = [];
    for (let f = 1800; f <= 3422; f += 58) {
      comb.push(f);
      phases.push(2 * Math.PI * random());
    }

    const events: SynthEvent[] = [
      {
        kind: 'multitone', side: 'answer',
        startSec, endSec: startSec + 0.62,
        amp: 0.13, freqsHz: [2196, 1828, 3424], phases: [0.2, .8, 1.4], edgeSec: 0.006,
      },
      {
        kind: 'multitone', side: 'caller',
        startSec: startSec + 0.36, endSec: startSec + 1.45,
        amp: 0.095, freqsHz: comb, phases, edgeSec: 0.010,
      },
      randomMultitone('answer', startSec + 0.72, 1.10, 0.10, 1950, 2850, 30, seed + 61),
      randomMultitone('caller', startSec + 1.55, 1.20, 0.15, 2200, 3200, 42, seed + 62),
      randomMultitone('answer', startSec + 2.30, 1.15, 0.14, 2450, 3400, 42, seed + 63),
      randomMultitone('caller', startSec + 3.05, 1.05, 0.14, 2450, 3450, 44, seed + 64),
      {
        kind: 'tone', side: 'answer',
        startSec: startSec + 3.68, endSec: startSec + 4.20,
        amp: 0.10, freqHz: 3015, edgeSec: 0.006,
      },
      {
        kind: 'multitone', side: 'caller',
        startSec: startSec + 1.45, endSec: startSec + 4.18,
        amp: 0.055,
        freqsHz: [1850, 2150, 2350, 2550, 2650, 2750, 2850, 2950, 3050, 3150, 3250, 3350],
        phases: [0,.2,.4,.6,.8,1,1.2,1.4,1.6,1.8,2,2.2],
        edgeSec: 0.012,
      },
    ];

    return {
      durationSec: 5.25,
      events,
      phase: {
        id: 'connect', index: 7, shortLabel: '7. Разгон и 56K',
        title: 'Разгон, подтверждение и поток данных',
        ituCode: 'V.90 DIL / B1',
        atLog: 'broad trained carrier field → data → mute',
        freqSummary: '1.8–3.45 кГц, затем отключение',
        simpleSummary: 'Финал заполняет почти весь верхний телефонный диапазон и затем резко освобождает линию.',
        plainExplanation: 'Широкое поле несущих теперь ближе к эталону по балансу, но все частоты и фазы вычисляются заново.',
      },
    };
  },
};
