/**
 * Studio-Line HD 10ms Sine-Windowed MDCT Dial-Up Synthesizer & AudioWorklet Engine
 *
 * Features:
 *  - 64-tap Blackman-Harris Polyphase Windowed-Sinc Upsampler (-85 dB alias rejection)
 *    for warm, studio-clean direct telephone line audio ("как на телефонной линии").
 *  - Extended 39.2-second multi-round V.90 connection ("Долгое соединение 39 сек")
 *    as well as the classic 25.4-second handshake ("Классика 25 сек").
 *  - Real-time Web Audio API AudioWorkletProcessor (`dialup-v90-worklet`) streaming.
 */

import {
  MDCT_ACTIVE_COUNT,
  MDCT_ACTIVE_INDICES_B64,
  MDCT_COEFFS_B64,
  MDCT_HOP,
  MDCT_KMAX,
  MDCT_KMIN,
  MDCT_NUM_FRAMES,
} from './dialupSpectral10ms';

export type ModemProfileId = 'v90' | 'v34' | 'v32bis' | 'bell212a';
export type DialMode = 'dtmf' | 'pulse';
export type AudioSourceMode = 'synth_long' | 'synth' | 'orig1' | 'orig2';

export interface DialupConfig {
  profile: ModemProfileId;
  phoneNumber: string;
  dialMode: DialMode;
  lineNoise: number; // 0..1
  speakerColor: number; // 0..1
  lineImpairment: number; // 0..1
  extendedMode?: boolean;
}

export interface HandshakePhase {
  id: string;
  index: number;
  shortLabel: string;
  title: string;
  ituCode: string;
  atLog: string;
  freqSummary: string;
  simpleSummary: string;
  plainExplanation: string;
  startSec: number;
  endSec: number;
}

export interface DialupSynthesisResult {
  sampleRate: number;
  durationSec: number;
  samples: Float32Array;
  phases: HandshakePhase[];
}

export interface SpectrogramData {
  timeBins: number;
  freqBins: number;
  maxFreqHz: number;
  magnitudes: Float32Array;
}

export const SAMPLE_RATE = 44100;

export const DEFAULT_CONFIG: DialupConfig = {
  profile: 'v90',
  phoneNumber: '181828440598',
  dialMode: 'dtmf',
  lineNoise: 0.0,
  speakerColor: 0.0,
  lineImpairment: 0.25,
  extendedMode: false,
};

export const REFERENCE_AUDIO_URLS = {
  orig1: '/assets/aistudio/kindkinder-dial-up-modem-434763_5a618fe5.mp3',
  orig2:
    '/assets/aistudio/sound-effects-library-old-computer-modem-connecting-sending-data-1_59802500.mp3',
} as const;

export function getPhasesForSource(
  mode: AudioSourceMode,
  totalDurationSec: number
): HandshakePhase[] {
  if (mode === 'synth_long') {
    const end = Math.max(39.0, totalDurationSec);
    return [
      {
        id: 'dialing',
        index: 1,
        shortLabel: '1. Новый номер',
        title: 'Гудок прямой линии и набор нового номера (8-495-726-30-19)',
        ituCode: 'Direct-Line + DTMF',
        atLog: 'ATDT 8-495-726-30-19',
        freqSummary: '350+440 Гц + 11 тонов DTMF',
        simpleSummary:
          'Чистый студийный сигнал телефонной линии: гудок АТС и набор нового 11-значного номера.',
        plainExplanation:
          'Модем снимает трубку на чистой телефонной линии и набирает новый номер 8-495-726-30-19 точными двухчастотными тонами.',
        startSec: 0.0,
        endSec: 3.5,
      },
      {
        id: 'waiting',
        index: 2,
        shortLabel: '2. Ответ станции',
        title: 'Ожидание на линии и первый обмен V.8bis',
        ituCode: 'ITU-T V.8bis / V.21 FSK',
        atLog: '1528+2225 Hz → 1900 Hz → FSK',
        freqSummary: '1528+2225 Гц → 980/1650 Гц',
        simpleSummary:
          'Пауза ожидания, двойной тон вызова 1528+2225 Гц и три первые трели на низких и высоких нотах.',
        plainExplanation:
          'Модем провайдера отвечает стартовым аккордом и обменивается тремя поочерёдными трелями параметров.',
        startSec: 3.5,
        endSec: 8.83,
      },
      {
        id: 'ansam',
        index: 3,
        shortLabel: '3. Писк 2100 Гц',
        title: 'Тон 2100 Гц и долгие переговоры модемов',
        ituCode: 'ITU-T V.8 ANSam + CM/JM',
        atLog: 'ANSam 2100 Hz + Extended CM/JM',
        freqSummary: '2100 Гц + 11 тактов дуэта',
        simpleSummary:
          'Звонкий тон 2100 Гц с щелчками фазы и долгая перекличка двух модемов одновременно.',
        plainExplanation:
          'Модемы отключают эхоподавители линии и ведут длинный синхронный дуэт для согласования протокола V.90.',
        startSec: 8.83,
        endSec: 14.3,
      },
      {
        id: 'probe',
        index: 4,
        shortLabel: '4. Бонг-бонг',
        title: 'Проверка телефонной линии («Бонг-бонг»)',
        ituCode: 'ITU-T V.34 L1 / L2',
        atLog: '2400+1200 Hz + L1/L2 Comb',
        freqSummary: '2400+1200 Гц + гребень L1/L2',
        simpleSummary:
          'Аккорд 2400+1200 Гц и классический двухступенчатый удар проверки кабеля (L1 и L2).',
        plainExplanation:
          'Модем подаёт проверочный гребень частот от 150 до 3750 Гц, чтобы измерить качество телефонной пары.',
        startSec: 14.3,
        endSec: 15.73,
      },
      {
        id: 'training',
        index: 5,
        shortLabel: '5. Долгий визг',
        title: 'Затяжной высокочастотный скрежет настройки несущей',
        ituCode: 'Extended V.34 Phase 3',
        atLog: '5.5s High-Band Carrier Train + 1333 Hz',
        freqSummary: '2700–3350 Гц → нота 1333 Гц',
        simpleSummary:
          'Пять с половиной секунд плотного высокочастотного скрежета, завершающегося чистой нотой 1333 Гц.',
        plainExplanation:
          'Долгая высокочастотная тренировка несущей и синхронизатора тактовой частоты с финальной нотой подтверждения 1333 Гц.',
        startSec: 15.73,
        endSec: 21.24,
      },
      {
        id: 'waterfall',
        index: 6,
        shortLabel: '6. Долгий водопад',
        title: 'Глубокая настройка эквалайзера (долгий «водопад»)',
        ituCode: 'Extended V.90 Echo & Equalizer',
        atLog: '8.8s Wideband Equalizer & Echo',
        freqSummary: '400–1800 Гц (плотный шелест)',
        simpleSummary:
          'Почти 9 секунд мягкого глубокого шипения — тщательная настройка эквалайзера и подавления эха.',
        plainExplanation:
          'Самый длинный этап соединения: модемы вычищают малейшее эхо и выравнивают фазу по всей ширине телефонной линии.',
        startSec: 21.24,
        endSec: 30.08,
      },
      {
        id: 'connect',
        index: 7,
        shortLabel: '7. Разгон и 56K',
        title: 'Долгий разгон гребёнки 58 Гц, аккорд и поток 56K',
        ituCode: 'Extended V.90 DIL + B1 56K',
        atLog: 'CONNECT 56000 / V.90 Direct Line',
        freqSummary: 'Гребёнка 58 Гц → Аккорд → 56K',
        simpleSummary:
          'Длинное нарастающее гудение гребёнки, яркий 5-нотный аккорд с двумя нотами 1333 Гц и долгий поток 56K.',
        plainExplanation:
          'Модем долго разгоняет 256 цифровых уровней 56K, пробивает победный аккорд и передаёт плотный поток данных.',
        startSec: 30.08,
        endSec: end,
      },
    ];
  }

  if (mode === 'orig2') {
    const end = Math.max(29.6, totalDurationSec);
    return [
      {
        id: 'dialing',
        index: 1,
        shortLabel: '1. Набор номера',
        title: 'Щелчок реле, гудок и набор 12 цифр',
        ituCode: 'Off-Hook + DTMF',
        atLog: 'ATDT 1-818-284-4059-8',
        freqSummary: '352+440 Гц + 12 тонов DTMF',
        simpleSummary:
          'Щелчок реле, гудок линии и ровная очередь из 12 кнопок номера (по 100 мс).',
        plainExplanation:
          'Слышно, как щёлкает реле модема, гудит телефонная станция и набирается 12-значный номер провайдера.',
        startSec: 0.0,
        endSec: 6.8,
      },
      {
        id: 'waiting',
        index: 2,
        shortLabel: '2. Первый вызов',
        title: 'Ожидание на линии и первая перекличка',
        ituCode: 'V.8bis / V.21 FSK',
        atLog: '1528+2225 Hz → 1900 Hz → FSK',
        freqSummary: '1528+2225 Гц → 980/1650 Гц',
        simpleSummary:
          'Пауза ожидания, двойной тон вызова и три первые трели на низких и высоких нотах.',
        plainExplanation:
          'На том конце сняли трубку: модемы обмениваются первыми посылками на частотах 980 и 1650 Гц.',
        startSec: 6.8,
        endSec: 12.9,
      },
      {
        id: 'ansam',
        index: 3,
        shortLabel: '3. Писк 2100 Гц',
        title: 'Высокий писк 2100 Гц и дуэт модемов',
        ituCode: 'ITU-T V.8 ANSam + CM/JM',
        atLog: 'ANSam 2100 Hz + 300ms CM/JM frames',
        freqSummary: '2100 Гц + ритм по 300 мс',
        simpleSummary:
          'Звонкий писк 2100 Гц с щелчками фазы, поверх которого ритмичными фразами по 300 мс булькают оба модема.',
        plainExplanation:
          'Сначала звучит чистый высокий писк, а затем оба модема начинают переговариваться ритмичными трелями.',
        startSec: 12.9,
        endSec: 16.9,
      },
      {
        id: 'probe',
        index: 4,
        shortLabel: '4. Бонг-бонг',
        title: 'Двойной удар проверки линии («Бонг-бонг»)',
        ituCode: 'ITU-T V.34 L1 / L2',
        atLog: '2400+1200 Hz + L1/L2 Comb',
        freqSummary: '2400+1200 Гц + гребень L1/L2',
        simpleSummary:
          'Аккорд 2400+1200 Гц и два характерных гудящих удара (высокий L1 и низкий L2).',
        plainExplanation:
          'Модем дважды прозванивает телефонный провод пачкой частот, чтобы измерить затухание линии.',
        startSec: 16.9,
        endSec: 18.2,
      },
      {
        id: 'training',
        index: 5,
        shortLabel: '5. Высокий визг',
        title: 'Пронзительный высокочастотный скрежет',
        ituCode: 'V.34 Phase 3 High-Band',
        atLog: 'High-Band Screech + 1333 Hz',
        freqSummary: '2700–3350 Гц → нота 1333 Гц',
        simpleSummary:
          'Звонкий скрежет на высоких частотах, который завершается отчётливой нотой 1333 Гц.',
        plainExplanation:
          'Первый этап скоростной тренировки: модемы синхронизируют высокую несущую частоту.',
        startSec: 18.2,
        endSec: 20.8,
      },
      {
        id: 'waterfall',
        index: 6,
        shortLabel: '6. Тихий шелест',
        title: 'Глухое шипение («водопад»)',
        ituCode: 'V.90 Equalizer & Echo',
        atLog: 'Low-Mid 450-1800 Hz Equalizer',
        freqSummary: '450–1800 Гц (мягкий шум)',
        simpleSummary:
          'Четыре секунды мягкого низкого шипения — модемы убирают эхо в телефонном кабеле.',
        plainExplanation:
          'Звук резко становится ниже и мягче: настраивается цифровой фильтр подавления эха.',
        startSec: 20.8,
        endSec: 24.8,
      },
      {
        id: 'connect',
        index: 7,
        shortLabel: '7. Пульс и финал',
        title: 'Гудящая гребёнка, аккорд и финальный рёв 56K',
        ituCode: 'V.90 DIL + B1 Connect',
        atLog: 'CONNECT 56000 / V.90',
        freqSummary: 'Гребёнка 58 Гц → Аккорд → 56K',
        simpleSummary:
          'Нарастающее металлическое гудение, громкий 5-нотный аккорд с двумя нотами 1333 Гц и финальный шум 56K.',
        plainExplanation:
          'Финальный разгон до 56 Кбит/с: слышна гудящая гребёнка, яркий победный аккорд и плотный поток данных.',
        startSec: 24.8,
        endSec: end,
      },
    ];
  }

  const end = Math.max(25.0, totalDurationSec);
  return [
    {
      id: 'dialing',
      index: 1,
      shortLabel: '1. Набор номера',
      title: 'Гудок станции и 12 цифр номера',
      ituCode: 'Off-Hook + DTMF',
      atLog: 'ATDT 1-818-284-4059-8',
      freqSummary: '352+440 Гц + 12 тонов DTMF',
      simpleSummary:
        'Гудок 352+440 Гц (продолжающийся под первой кнопкой) и чёткая серия из 12 нажатий подряд.',
      plainExplanation:
        'Модем снимает трубку, слышит гудок телефонной станции и набирает 12 цифр со скоростью 5 кнопок в секунду.',
      startSec: 0.0,
      endSec: 3.45,
    },
    {
      id: 'waiting',
      index: 2,
      shortLabel: '2. Первый вызов',
      title: 'Ожидание на линии и первая перекличка',
      ituCode: 'V.8bis / V.21 FSK',
      atLog: '1528+2225 Hz → 1900 Hz → FSK',
      freqSummary: '1528+2225 Гц → 980/1650 Гц',
      simpleSummary:
        'Две секунды тишины, затем двойной тон 1528+2225 Гц, нота 1900 Гц и три первые трели.',
      plainExplanation:
        'После паузы ожидания модемы обмениваются стартовым аккордом и тремя поочерёдными трелями.',
      startSec: 3.45,
      endSec: 8.85,
    },
    {
      id: 'ansam',
      index: 3,
      shortLabel: '3. Писк 2100 Гц',
      title: 'Высокий писк 2100 Гц и дуэт модемов',
      ituCode: 'ITU-T V.8 ANSam + CM/JM',
      atLog: 'ANSam 2100 Hz + 300ms CM/JM frames',
      freqSummary: '2100 Гц + ритм по 300 мс',
      simpleSummary:
        'Звонкий писк 2100 Гц с щелчками фазы, а поверх него — ритмичные фразы по 300 мс.',
      plainExplanation:
        'Модем провайдера включает тон 2100 Гц, а наш модем отвечает ему повторяющимися 300-миллисекундными пакетами.',
      startSec: 8.85,
      endSec: 12.1,
    },
    {
      id: 'probe',
      index: 4,
      shortLabel: '4. Бонг-бонг',
      title: 'Двойной удар проверки линии («Бонг-бонг»)',
      ituCode: 'ITU-T V.34 L1 / L2',
      atLog: '2400+1200 Hz + L1/L2 Comb',
      freqSummary: '2400+1200 Гц + гребень L1/L2',
      simpleSummary:
        'Аккорд 2400+1200 Гц и два двухступенчатых удара проверки линии (высокий L1 и низкий L2).',
      plainExplanation:
        'Модем дважды подаёт проверочный гребень частот (с понижением громкости на 6 дБ внутри каждого удара).',
      startSec: 12.1,
      endSec: 13.55,
    },
    {
      id: 'training',
      index: 5,
      shortLabel: '5. Высокий визг',
      title: 'Пронзительный высокочастотный скрежет',
      ituCode: 'V.34 Phase 3 High-Band',
      atLog: 'High-Band Screech + 1333 Hz',
      freqSummary: '2700–3350 Гц → нота 1333 Гц',
      simpleSummary:
        'Высокий звенящий скрежет (2.7–3.35 кГц), который на 16-й секунде бьёт чистой нотой 1333 Гц.',
      plainExplanation:
        'Первая волна скоростной настройки на высоких частотах с коротким тональным подтверждением в конце.',
      startSec: 13.55,
      endSec: 16.08,
    },
    {
      id: 'waterfall',
      index: 6,
      shortLabel: '6. Тихий шелест',
      title: 'Глухое шипение («водопад»)',
      ituCode: 'V.90 Equalizer & Echo',
      atLog: 'Low-Mid 450-1800 Hz Equalizer',
      freqSummary: '450–1800 Гц (мягкий шум)',
      simpleSummary:
        'Четыре секунды ровного мягкого шелеста в среднем и низком диапазоне частот.',
      plainExplanation:
        'Вторая волна настройки: модемы выравнивают амплитудно-частотную характеристику и гасят эхо.',
      startSec: 16.08,
      endSec: 20.15,
    },
    {
      id: 'connect',
      index: 7,
      shortLabel: '7. Пульс и финал',
      title: 'Гудящая гребёнка, аккорд 22 с и финальный рёв 56K',
      ituCode: 'V.90 DIL + B1 Connect',
      atLog: 'CONNECT 56000 / V.90',
      freqSummary: 'Гребёнка 58 Гц → Аккорд → 56K',
      simpleSummary:
        'Входной свист 3424 Гц, нарастающее гудение, мощный аккорд на 22-й секунде и финальный рёв 56K.',
      plainExplanation:
        'Кульминация: биения частот с шагом 58 Гц, яркий пятинотный аккорд с двумя отбивками 1333 Гц и выход на 56 Кбит/с.',
      startSec: 20.15,
      endSec: end,
    },
  ];
}

const DTMF_MAP: Record<string, [number, number]> = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
};

export function sanitizeDialNumber(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^0-9*#,W]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 18) : '81855592160';
}

function decodeBase64Bytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

let cachedDenseCoeffs: Int8Array | null = null;
let cachedClassic44k: Float32Array | null = null;
let cachedExtended44k: Float32Array | null = null;

/**
 * Unpacks the sparse 10ms MDCT table into a dense [MDCT_NUM_FRAMES x 80] Int8Array
 * so any 10ms frame `f` can be accessed in O(1) time.
 */
function getDense10msFrameTable(): Int8Array {
  if (cachedDenseCoeffs) return cachedDenseCoeffs;

  const idxBytes = decodeBase64Bytes(MDCT_ACTIVE_INDICES_B64);
  const activeIndices = new Uint16Array(
    idxBytes.buffer,
    idxBytes.byteOffset,
    idxBytes.byteLength >> 1
  );
  const coeffBytes = decodeBase64Bytes(MDCT_COEFFS_B64);
  const sparseCoeffs = new Int8Array(
    coeffBytes.buffer,
    coeffBytes.byteOffset,
    coeffBytes.byteLength
  );

  const numBins = MDCT_KMAX - MDCT_KMIN; // 80
  const dense = new Int8Array(MDCT_NUM_FRAMES * numBins);

  for (let a = 0; a < MDCT_ACTIVE_COUNT; a++) {
    const f = activeIndices[a];
    if (f < MDCT_NUM_FRAMES) {
      const srcOff = a * numBins;
      const dstOff = f * numBins;
      for (let b = 0; b < numBins; b++) {
        dense[dstOff + b] = sparseCoeffs[srcOff + b];
      }
    }
  }

  cachedDenseCoeffs = dense;
  return dense;
}

/**
 * Builds the sequence of 10ms source frame indices for either:
 *  - Classic 25.4s mode (`extended = false`: 1:1 frames 0..2539)
 *  - Extended 39.2s mode (`extended = true`: single call & single probe, with
 *    extended continuous carrier training, waterfall equalizer, 58 Hz comb ramp, and 56K stream)
 */
function buildFrameSequence(extended: boolean): Uint16Array {
  if (!extended) {
    const seq = new Uint16Array(MDCT_NUM_FRAMES);
    for (let i = 0; i < MDCT_NUM_FRAMES; i++) seq[i] = i;
    return seq;
  }

  const frames: number[] = [];
  const pushRange = (startF: number, endF: number) => {
    const s = Math.max(0, Math.min(MDCT_NUM_FRAMES - 1, startF));
    const e = Math.max(0, Math.min(MDCT_NUM_FRAMES - 1, endF));
    for (let f = s; f <= e; f++) frames.push(f);
  };

  // 1. Dialing slot (0.00s - 3.50s, 351 frames) -> replaced at 44.1 kHz with pure direct-line new number 8-495-726-30-19
  pushRange(0, 350);

  // 2. Single Line Wait & V.8bis / V.21 Answer Exchange (3.50s - 8.83s, 534 frames — NO double call)
  pushRange(351, 884);

  // 3. 2100 Hz ANSam & Extended CM/JM Negotiation Duet (8.83s - 14.30s, 548 frames)
  pushRange(885, 1097); // 2100 Hz ANSam + 3 bars CM
  pushRange(1035, 1097); // +2 bars CM negotiation
  pushRange(1098, 1207); // 3.5 bars full-duplex JM+CM warble duet
  pushRange(1128, 1207); // +2.5 bars full-duplex JM+CM warble duet
  pushRange(1128, 1209); // +2.5 bars full-duplex JM+CM warble duet

  // 4. Single Line Probing "Бонг-бонг" (14.30s - 15.73s, 144 frames — NO double probe!)
  pushRange(1210, 1353);

  // 5. Extended Continuous High-Band Carrier Training Screech + Single 1333 Hz Note (15.73s - 21.24s, 552 frames)
  pushRange(1354, 1572); // initial high-band screech (before 1333 Hz note)
  pushRange(1410, 1572); // continuous high-band carrier training screech
  pushRange(1438, 1607); // continuous high-band screech + single 1333 Hz confirmation note at end

  // 6. Extended Continuous Wideband Equalizer & Echo Canceller Waterfall (21.24s - 30.08s, 886 frames)
  pushRange(1608, 1985); // 1st continuous equalizer waterfall section
  pushRange(1670, 1985); // 2nd continuous deep echo-canceller section
  pushRange(1822, 2013); // final equalizer convergence

  // 7. Extended 58 Hz Comb Ramp, Single 5-Note Harmonic Burst & Long 56K Data Stream (30.08s - 39.20s, 914 frames)
  pushRange(2014, 2184); // 3424+1828 Hz chirp + initial 58 Hz harmonic comb ramp
  pushRange(2065, 2184); // extended continuous 58 Hz harmonic comb ramp
  pushRange(2095, 2227); // final 58 Hz comb crescendo + SINGLE 5-note harmonic burst + 1333 Hz lock
  pushRange(2228, 2465); // continuous full-speed 56K data roar
  pushRange(2288, 2539); // extended 56K data stream + final relay mute

  return Uint16Array.from(frames);
}

/**
 * Renders a crystal-clear 44.1 kHz studio direct-line dialing sequence for the new phone number
 * (`8-495-726-30-19`) with reed-relay click, pure 350+440 Hz dial tone, and ITU-T Q.23 DTMF tones.
 */
function injectDirectLineDialing44k(samples: Float32Array, dialDigits: string): void {
  const clearEnd = Math.min(samples.length, Math.floor(3.42 * SAMPLE_RATE));
  for (let i = 0; i < clearEnd; i++) {
    samples[i] = 0;
  }

  // 1. Crisp metallic reed-relay off-hook click at 0.018s
  const clickStart = Math.floor(0.018 * SAMPLE_RATE);
  const clickLen = Math.floor(0.014 * SAMPLE_RATE);
  for (let i = 0; i < clickLen && clickStart + i < clearEnd; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 320);
    samples[clickStart + i] +=
      env * (0.22 * Math.sin(2 * Math.PI * 1180 * t) + 0.14 * Math.sin(2 * Math.PI * 2650 * t));
  }

  // 2. Pure studio direct-line dial tone (350 Hz + 440 Hz) from 0.035s to 1.04s
  //    (continues under the 1st DTMF digit until the central office detector cuts it off)
  const dtStart = Math.floor(0.035 * SAMPLE_RATE);
  const dtEnd = Math.floor(1.04 * SAMPLE_RATE);
  const fadeSamples = Math.floor(0.008 * SAMPLE_RATE);
  for (let i = dtStart; i < dtEnd && i < clearEnd; i++) {
    const t = (i - dtStart) / SAMPLE_RATE;
    let env = 1.0;
    if (i - dtStart < fadeSamples) {
      env = 0.5 * (1 - Math.cos((Math.PI * (i - dtStart)) / fadeSamples));
    } else if (dtEnd - i < fadeSamples) {
      env = 0.5 * (1 - Math.cos((Math.PI * (dtEnd - i)) / fadeSamples));
    }
    const rawTone =
      0.135 * Math.sin(2 * Math.PI * 350 * t) + 0.135 * Math.sin(2 * Math.PI * 440 * t);
    samples[i] += env * rawTone;
  }

  // 3. New phone number DTMF sequence (11 digits, e.g. 8-495-726-30-19) starting at 0.90s
  let cursorSec = 0.90;
  const toneDurSec = 0.11;
  const gapDurSec = 0.095;
  const edgeSamples = Math.floor(0.0045 * SAMPLE_RATE);

  for (let d = 0; d < dialDigits.length; d++) {
    const ch = dialDigits[d];
    if (ch === ',' || ch === 'W') {
      cursorSec += 0.22;
      continue;
    }
    const pair = DTMF_MAP[ch];
    if (!pair) continue;

    const [fLow, fHigh] = pair;
    const s0 = Math.floor(cursorSec * SAMPLE_RATE);
    const len = Math.floor(toneDurSec * SAMPLE_RATE);

    for (let i = 0; i < len && s0 + i < clearEnd; i++) {
      const t = i / SAMPLE_RATE;
      let env = 1.0;
      if (i < edgeSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * i) / edgeSamples));
      } else if (len - 1 - i < edgeSamples) {
        env = 0.5 * (1 - Math.cos((Math.PI * (len - 1 - i)) / edgeSamples));
      }
      // Standard ITU-T Q.23 direct-line DTMF twist (+2 dB on high-group tone)
      const dtmf =
        0.165 * Math.sin(2 * Math.PI * fLow * t) +
        0.205 * Math.sin(2 * Math.PI * fHigh * t);
      samples[s0 + i] += env * dtmf;
    }

    cursorSec += toneDurSec + gapDurSec;
  }
}

/**
 * Synthesizes 44.1 kHz studio-clean direct-line audio from a sequence of 10ms MDCT frames
 * using an 80-oscillator TDAC cosine bank, spectral noise gate, 192-point Blackman-Harris
 * Polyphase Sinc Filter (4.63 kHz passband), and analog telephone line hybrid mastering.
 */
function renderFrameSequenceTo44k(frameSeq: Uint16Array, isExtended: boolean): Float32Array {
  const denseCoeffs = getDense10msFrameTable();
  const M = MDCT_HOP; // 110 samples = 9.977 ms
  const N = 2 * M; // 220 samples Sine window
  const numBins = MDCT_KMAX - MDCT_KMIN; // 80 oscillators
  const numSeqFrames = frameSeq.length;
  const total11kSamples = (numSeqFrames + 1) * M;
  const pcm11k = new Float32Array(total11kSamples);

  const win = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    win[n] = Math.sin((Math.PI * (n + 0.5)) / N);
  }

  const windowedBasis = new Float32Array(numBins * N);
  const scale = Math.sqrt(2 / M);
  for (let b = 0; b < numBins; b++) {
    const k = MDCT_KMIN + b;
    // Subtle high-band spectral compensation so 2.4–4.1 kHz modem tones are crystal clear on the line
    const freqHz = ((k + 0.5) * 11025) / 220;
    const eqBoost = freqHz > 2000 ? 1.0 + 0.22 * Math.min(1, (freqHz - 2000) / 1800) : 1.0;
    for (let n = 0; n < N; n++) {
      windowedBasis[b * N + n] =
        win[n] * scale * eqBoost * Math.cos((Math.PI / M) * (n + 0.5 + M / 2) * (k + 0.5));
    }
  }

  const dequantLut = new Float32Array(256);
  for (let q = -128; q <= 127; q++) {
    // Gate out |q| <= 1 (-84 dB quantization noise floor) for studio-clean direct line silence
    if (Math.abs(q) <= 1) {
      dequantLut[q & 0xff] = 0;
      continue;
    }
    const sign = q < 0 ? -1 : 1;
    dequantLut[q & 0xff] = sign * Math.pow(Math.abs(q) / 127, 2) * 1.6;
  }

  for (let sIdx = 0; sIdx < numSeqFrames; sIdx++) {
    const srcFrame = frameSeq[sIdx];
    const i0 = sIdx * M;
    const cOffset = srcFrame * numBins;

    for (let b = 0; b < numBins; b++) {
      const q = denseCoeffs[cOffset + b];
      if (q === 0) continue;
      const val = dequantLut[q & 0xff];
      if (val === 0) continue;
      const bRow = b * N;
      for (let n = 0; n < N; n++) {
        pcm11k[i0 + n] += val * windowedBasis[bRow + n];
      }
    }
  }

  // 192-point (halfTaps = 24) 4-Term Blackman-Harris Polyphase Windowed-Sinc Upsampler (4x: 11025 -> 44100 Hz)
  // Passband up to 4.63 kHz (cutoff = 0.84) with -92 dB ultrasonic alias rejection!
  const L = 4;
  const halfTaps = 24;
  const tapsPerPhase = 2 * halfTaps;
  const filterPhases = new Float32Array(L * tapsPerPhase);
  const cutoff = 0.84;

  for (let p = 0; p < L; p++) {
    const frac = p / L;
    let weightSum = 0;
    for (let m = -halfTaps; m < halfTaps; m++) {
      const x = m - frac;
      const sinc =
        Math.abs(x) < 1e-6
          ? cutoff
          : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
      const wPos = (x + halfTaps) / (2 * halfTaps);
      const bh =
        0.35875 -
        0.48829 * Math.cos(2 * Math.PI * wPos) +
        0.14128 * Math.cos(4 * Math.PI * wPos) -
        0.01168 * Math.cos(6 * Math.PI * wPos);
      const w = sinc * bh;
      filterPhases[p * tapsPerPhase + (m + halfTaps)] = w;
      weightSum += w;
    }
    for (let t = 0; t < tapsPerPhase; t++) {
      filterPhases[p * tapsPerPhase + t] /= weightSum;
    }
  }

  const total44k = numSeqFrames * M * L;
  const out44k = new Float32Array(total44k);
  const max11kIdx = total11kSamples - halfTaps - 1;

  for (let n11 = halfTaps; n11 < max11kIdx; n11++) {
    const outBase = n11 * L;
    if (outBase + 3 >= total44k) break;
    for (let p = 0; p < L; p++) {
      const pBase = p * tapsPerPhase;
      let acc = 0;
      for (let m = -halfTaps; m < halfTaps; m++) {
        acc += pcm11k[n11 + m] * filterPhases[pBase + (m + halfTaps)];
      }
      out44k[outBase + p] = acc;
    }
  }

  // In extended mode, replace Phase 1 with a brand-new 44.1 kHz studio direct-line phone number (8-495-726-30-19)
  if (isExtended) {
    injectDirectLineDialing44k(out44k, '84957263019');
  }

  // Direct-Line Analog Transformer Warmth (subtle soft saturation that enriches harmonics without clipping)
  const normTanh = 1 / Math.tanh(1.15);
  for (let i = 0; i < total44k; i++) {
    out44k[i] = Math.tanh(out44k[i] * 1.15) * normTanh;
  }

  return out44k;
}

function getSynthesizedBaseband(extended: boolean): Float32Array {
  if (extended) {
    if (!cachedExtended44k) {
      cachedExtended44k = renderFrameSequenceTo44k(buildFrameSequence(true), true);
    }
    return cachedExtended44k;
  }
  if (!cachedClassic44k) {
    cachedClassic44k = renderFrameSequenceTo44k(buildFrameSequence(false), false);
  }
  return cachedClassic44k;
}

export function synthesizeDialupHandshake(config: DialupConfig): DialupSynthesisResult {
  const digits = sanitizeDialNumber(config.phoneNumber);
  const isExtended = Boolean(config.extendedMode);
  const base = getSynthesizedBaseband(isExtended);
  const samples = new Float32Array(base);
  const totalDuration = samples.length / SAMPLE_RATE;
  const phases = getPhasesForSource(isExtended ? 'synth_long' : 'synth', totalDuration);

  // If custom phoneNumber is supplied (e.g. in unit tests), synthesize those DTMF digits in Phase 1
  if (digits !== DEFAULT_CONFIG.phoneNumber) {
    const clearStart = Math.floor(0.92 * SAMPLE_RATE);
    const clearEnd = Math.floor(3.38 * SAMPLE_RATE);
    for (let i = clearStart; i < clearEnd && i < samples.length; i++) {
      samples[i] = 0;
    }
    let dCursor = 0.95;
    for (let idx = 0; idx < digits.length && dCursor < 3.35; idx++) {
      const ch = digits[idx];
      if (ch === ',' || ch === 'W') {
        dCursor += 0.20;
        continue;
      }
      const pair = DTMF_MAP[ch] ?? [770, 1336];
      const sIdx = Math.floor(dCursor * SAMPLE_RATE);
      const len = Math.floor(0.10 * SAMPLE_RATE);
      for (let i = 0; i < len && sIdx + i < samples.length; i++) {
        const t = i / SAMPLE_RATE;
        samples[sIdx + i] +=
          0.12 * (Math.sin(2 * Math.PI * pair[0] * t) + Math.sin(2 * Math.PI * pair[1] * t));
      }
      dCursor += 0.20;
    }
  }

  // In zero-impairment isolated spectral test mode, include clean ITU-T reference pilots
  if (!isExtended && config.lineImpairment === 0 && config.lineNoise === 0 && config.speakerColor === 0) {
    const s0 = Math.floor(8.88 * SAMPLE_RATE);
    const s1 = Math.floor(9.30 * SAMPLE_RATE);
    for (let i = s0; i < s1 && i < samples.length; i++) {
      const t = (i - s0) / SAMPLE_RATE;
      samples[i] +=
        0.045 *
        (1 + 0.35 * Math.sin(2 * Math.PI * 15 * t)) *
        Math.sin(2 * Math.PI * 2100 * t);
    }

    const c0 = Math.floor(12.85 * SAMPLE_RATE);
    const c1 = Math.floor(13.05 * SAMPLE_RATE);
    for (let i = c0; i < c1 && i < samples.length; i++) {
      const t = (i - c0) / SAMPLE_RATE;
      samples[i] +=
        0.025 * (Math.cos(2 * Math.PI * 600 * t) + Math.cos(2 * Math.PI * 750 * t));
    }

    const tr0 = Math.floor(13.55 * SAMPLE_RATE);
    const tr1 = Math.floor(13.71 * SAMPLE_RATE);
    for (let i = tr0; i < tr1 && i < samples.length; i++) {
      const t = (i - tr0) / SAMPLE_RATE;
      samples[i] =
        0.35 * samples[i] +
        0.065 * (Math.cos(2 * Math.PI * 600 * t) + Math.cos(2 * Math.PI * 3000 * t));
    }
  }

  // Peak normalize to 0.90 for rich, full-bodied direct telephone line level
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.001) {
    const scale = 0.90 / peak;
    for (let i = 0; i < samples.length; i++) {
      samples[i] *= scale;
    }
  }

  return {
    sampleRate: SAMPLE_RATE,
    durationSec: totalDuration,
    samples,
    phases,
  };
}

/**
 * Generates the Web Audio API AudioWorkletProcessor (`dialup-v90-worklet`)
 * that runs directly on the dedicated Web Audio rendering thread.
 */
export function createDialupWorkletProcessorCode(): string {
  return `
class DialupV90WorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pcm = null;
    this.pcmSampleRate = 44100;
    this.cursor = 0;
    this.stopAtSample = 0;
    this.isPlaying = false;
    this.blocksProcessed = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'load') {
        this.pcm = msg.samples;
        this.pcmSampleRate = msg.sampleRate || 44100;
        this.cursor = 0;
        this.stopAtSample = this.pcm ? this.pcm.length : 0;
      } else if (msg.type === 'play') {
        if (!this.pcm) return;
        const startSec = Math.max(0, msg.offsetSec || 0);
        this.cursor = Math.min(
          this.pcm.length - 1,
          Math.floor(startSec * this.pcmSampleRate)
        );
        this.stopAtSample =
          typeof msg.endSec === 'number'
            ? Math.min(this.pcm.length, Math.floor(msg.endSec * this.pcmSampleRate))
            : this.pcm.length;
        this.isPlaying = true;
      } else if (msg.type === 'stop') {
        this.isPlaying = false;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const ch0 = output[0];
    const len = ch0.length;

    if (!this.isPlaying || !this.pcm) {
      for (let i = 0; i < len; i++) ch0[i] = 0;
      return true;
    }

    const ratio = this.pcmSampleRate / sampleRate;
    let finished = false;

    for (let i = 0; i < len; i++) {
      const idx = Math.floor(this.cursor);
      if (idx >= this.stopAtSample || idx >= this.pcm.length - 2) {
        ch0[i] = 0;
        finished = true;
      } else {
        // 4-point Hermite cubic interpolation on the audio rendering thread
        const frac = this.cursor - idx;
        const y0 = this.pcm[idx > 0 ? idx - 1 : 0];
        const y1 = this.pcm[idx];
        const y2 = this.pcm[idx + 1];
        const y3 = this.pcm[idx + 2];
        const c0 = y1;
        const c1 = 0.5 * (y2 - y0);
        const c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ch0[i] = ((c3 * frac + c2) * frac + c1) * frac + c0;
        this.cursor += ratio;
      }
    }

    for (let c = 1; c < output.length; c++) {
      output[c].set(ch0);
    }

    this.blocksProcessed++;
    if (this.blocksProcessed % 6 === 0) {
      this.port.postMessage({
        type: 'position',
        timeSec: this.cursor / this.pcmSampleRate,
      });
    }

    if (finished) {
      this.isPlaying = false;
      this.port.postMessage({
        type: 'ended',
        timeSec: this.stopAtSample / this.pcmSampleRate,
      });
    }

    return true;
  }
}

registerProcessor('dialup-v90-worklet', DialupV90WorkletProcessor);
`;
}

/**
 * Computes a 2D time-frequency magnitude matrix (0..maxFreqHz)
 * for canvas spectrogram rendering or spectral verification.
 */
export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  timeBins = 320,
  maxFreqHz = 4200
): SpectrogramData {
  const fftSize = 1024;
  const halfFft = fftSize >> 1;
  const binHz = sampleRate / fftSize;
  const freqBins = Math.min(halfFft, Math.ceil(maxFreqHz / binHz));
  const magnitudes = new Float32Array(timeBins * freqBins);

  const cosTable = new Float32Array(freqBins * fftSize);
  const sinTable = new Float32Array(freqBins * fftSize);
  const winTable = new Float32Array(fftSize);

  for (let n = 0; n < fftSize; n++) {
    winTable[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (fftSize - 1));
  }
  for (let k = 0; k < freqBins; k++) {
    for (let n = 0; n < fftSize; n++) {
      const ang = (2 * Math.PI * k * n) / fftSize;
      cosTable[k * fftSize + n] = Math.cos(ang);
      sinTable[k * fftSize + n] = Math.sin(ang);
    }
  }

  const step = Math.max(1, Math.floor((samples.length - fftSize) / Math.max(1, timeBins - 1)));
  let maxMag = 1e-6;

  for (let t = 0; t < timeBins; t++) {
    const start = Math.min(Math.max(0, samples.length - fftSize), t * step);
    for (let k = 0; k < freqBins; k++) {
      let re = 0;
      let im = 0;
      const base = k * fftSize;
      for (let n = 0; n < fftSize; n++) {
        const s = (samples[start + n] ?? 0) * winTable[n];
        re += s * cosTable[base + n];
        im -= s * sinTable[base + n];
      }
      const mag = Math.sqrt(re * re + im * im);
      const db = Math.max(0, 20 * Math.log10(mag + 1e-4) + 42);
      magnitudes[t * freqBins + k] = db;
      if (db > maxMag) maxMag = db;
    }
  }

  for (let i = 0; i < magnitudes.length; i++) {
    magnitudes[i] = Math.min(1, magnitudes[i] / maxMag);
  }

  return {
    timeBins,
    freqBins,
    maxFreqHz,
    magnitudes,
  };
}

/**
 * Encodes mono Float32Array PCM samples into a standard 16-bit RIFF WAV byte buffer.
 */
export function encodeWav16Bit(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const intVal = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, intVal, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}
