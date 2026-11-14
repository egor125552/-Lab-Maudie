import type { StagePlugin, SynthEvent } from '../types';
import { dtmfPair } from '../primitives';

export const dialingStage: StagePlugin = {
  id: 'dialing',
  build({ config, startSec }) {
    const events: SynthEvent[] = [
      {
        kind: 'click', side: 'caller',
        startSec: startSec + 0.018, endSec: startSec + 0.035,
        amp: 0.22, freqsHz: [1180, 2650], decay: 320,
      },
      {
        kind: 'multitone', side: 'answer',
        startSec: startSec + 0.035, endSec: startSec + 1.04,
        amp: 0.135, freqsHz: [350, 440], phases: [0, 0], edgeSec: 0.008,
      },
    ];
    const digits = config.phoneNumber.replace(/[^0-9*#]/g, '') || '181828440598';
    let cursor = startSec + 0.90;
    for (const digit of digits) {
      const pair = dtmfPair(digit);
      if (!pair) continue;
      events.push({
        kind: 'multitone', side: 'caller',
        startSec: cursor, endSec: cursor + 0.11,
        amp: 0.18, freqsHz: pair, phases: [0, 0], edgeSec: 0.0045,
      });
      cursor += 0.205;
    }
    return {
      durationSec: 3.45,
      events,
      phase: {
        id: 'dialing', index: 1, shortLabel: '1. Набор номера',
        title: 'Гудок станции и набор номера',
        ituCode: 'Off-Hook + DTMF',
        atLog: 'ATDT ' + digits,
        freqSummary: '350+440 Гц + DTMF',
        simpleSummary: 'Модем снимает линию и набирает номер точными двухчастотными сигналами.',
        plainExplanation: 'Щелчок реле, гудок станции и DTMF строятся математически.',
      },
    };
  },
};
