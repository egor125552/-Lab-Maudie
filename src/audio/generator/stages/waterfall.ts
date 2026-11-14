import type { StagePlugin } from '../types';
import { randomMultitone } from '../primitives';

export const waterfallStage: StagePlugin = {
  id: 'waterfall',
  build({ startSec, seed }) {
    const events = [
      randomMultitone('caller', startSec, 1.20, 0.14, 350, 1150, 40, seed + 51),
      randomMultitone('answer', startSec + 0.45, 1.25, 0.10, 420, 1250, 34, seed + 52),
      randomMultitone('caller', startSec + 1.25, 1.28, 0.13, 320, 1100, 42, seed + 53),
      randomMultitone('answer', startSec + 2.00, 1.35, 0.10, 380, 1200, 38, seed + 54),
      randomMultitone('caller', startSec + 2.82, 1.16, 0.12, 420, 1300, 42, seed + 55),
      randomMultitone('answer', startSec + 0.15, 1.35, 0.065, 1600, 2700, 22, seed + 56),
      randomMultitone('caller', startSec + 1.50, 1.20, 0.060, 1450, 2600, 20, seed + 57),
      randomMultitone('answer', startSec + 2.65, 1.15, 0.060, 1550, 2750, 22, seed + 58),
    ];
    return {
      durationSec: 4.07,
      events,
      phase: {
        id: 'waterfall', index: 6, shortLabel: '6. Тихий шелест',
        title: 'Настройка эквалайзера и эха',
        ituCode: 'V.90 Equalizer / Echo',
        atLog: 'low-mid training with weaker high-band residue',
        freqSummary: '320–1300 Гц + слабые 1.5–2.7 кГц',
        simpleSummary: 'Глубокий низкий шелест сохраняет более слабые верхние слои, как в эталоне.',
        plainExplanation: 'Это по-прежнему полностью сгенерированная тренировка, но спектральный баланс теперь повторяет эталон точнее.',
      },
    };
  },
};
