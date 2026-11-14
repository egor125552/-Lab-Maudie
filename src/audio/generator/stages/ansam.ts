import type { StagePlugin, SynthEvent } from '../types';
import { fskEvent } from '../primitives';

export const ansamStage: StagePlugin = {
  id: 'ansam',
  build({ startSec, seed }) {
    const events: SynthEvent[] = [
      {
        kind: 'tone', side: 'answer',
        startSec, endSec: startSec + 2.20,
        amp: 0.18, freqHz: 2100, amHz: 15, amDepth: 0.20,
        reverseEverySec: 0.45, edgeSec: 0.006,
      },
      fskEvent('caller', startSec + 1.02, 0.58, 0.16, 980, 1180, 300, seed + 21),
      fskEvent('answer', startSec + 2.05, 0.55, 0.15, 1650, 1850, 300, seed + 22),
      fskEvent('answer', startSec + 2.48, 0.48, 0.15, 1650, 1850, 300, seed + 23),
      fskEvent('caller', startSec + 2.92, 0.28, 0.14, 980, 1180, 300, seed + 24),
    ];
    return {
      durationSec: 3.25,
      events,
      phase: {
        id: 'ansam', index: 3, shortLabel: '3. Писк 2100 Гц',
        title: 'ANSam и переговоры двух модемов',
        ituCode: 'V.8 ANSam + CM/JM',
        atLog: '2100 Hz, 15 Hz AM, phase reversals + V.21',
        freqSummary: '2100 Гц + 15 Гц AM + FSK',
        simpleSummary: 'Ответный модем держит 2100 Гц, пока поверх него начинается цифровая перекличка.',
        plainExplanation: 'Тон 2100 Гц живёт дольше, как в эталоне, а цифровые ответы обоих модемов создаются отдельно.',
      },
    };
  },
};
