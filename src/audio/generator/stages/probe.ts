import type { StagePlugin, SynthEvent } from '../types';
import { combFrequencies, mulberry32 } from '../primitives';

export const probeStage: StagePlugin = {
  id: 'probe',
  build({ startSec, seed }) {
    const random = mulberry32(seed + 31);
    const comb = combFrequencies();
    const phases = comb.map(() => 2 * Math.PI * random());
    const events: SynthEvent[] = [
      {
        kind: 'multitone', side: 'caller',
        startSec, endSec: startSec + 0.70,
        amp: 0.060, freqsHz: comb, phases, edgeSec: 0.005,
      },
      { kind: 'tone', side: 'caller', startSec, endSec: startSec + 0.12, amp: 0.13, freqHz: 2700, edgeSec: 0.004 },
      { kind: 'tone', side: 'caller', startSec: startSec + 0.10, endSec: startSec + 0.34, amp: 0.14, freqHz: 2400, edgeSec: 0.004 },
      { kind: 'chirp', side: 'caller', startSec: startSec + 0.32, endSec: startSec + 0.50, amp: 0.13, fromHz: 2400, toHz: 3050, edgeSec: 0.004 },
      { kind: 'tone', side: 'caller', startSec: startSec + 0.48, endSec: startSec + 0.61, amp: 0.14, freqHz: 3300, edgeSec: 0.004 },
      { kind: 'tone', side: 'caller', startSec: startSec + 0.59, endSec: startSec + 0.70, amp: 0.13, freqHz: 2400, edgeSec: 0.004 },
      {
        kind: 'multitone', side: 'answer',
        startSec: startSec + 0.65, endSec: startSec + 1.05,
        amp: 0.13, freqsHz: [600, 750, 1050, 1350], phases: [0.3,.9,1.2,1.6], edgeSec: 0.005,
      },
      {
        kind: 'multitone', side: 'caller',
        startSec: startSec + 1.00, endSec: startSec + 1.42,
        amp: 0.070, freqsHz: comb, phases: phases.map((p)=>p+0.5), edgeSec: 0.005,
      },
      {
        kind: 'multitone', side: 'caller',
        startSec: startSec + 1.00, endSec: startSec + 1.42,
        amp: 0.13, freqsHz: [2250, 2400, 2550], phases: [0.2,.7,1.1], edgeSec: 0.005,
      },
    ];
    return {
      durationSec: 1.45,
      events,
      phase: {
        id: 'probe', index: 4, shortLabel: '4. Бонг-бонг',
        title: 'Проверка телефонной линии',
        ituCode: 'V.34 L1 / L2',
        atLog: '150 Hz comb with time-varying emphasis',
        freqSummary: 'широкая гребёнка с движущимися акцентами',
        simpleSummary: 'Широкая гребёнка сначала пробегает по высоким акцентам, затем падает к 600 Гц и возвращается вверх.',
        plainExplanation: 'Гребёнка остаётся математической, а временная форма её акцентов повторяет эталон гораздо точнее.',
      },
    };
  },
};
