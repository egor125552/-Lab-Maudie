import {
  SAMPLE_RATE,
  renderFrameSequenceTo44k,
} from './dialupDsp';

export interface SlowModemSynthesisResult {
  sampleRate: number;
  durationSec: number;
  samples: Float32Array;
}

function appendRange(target: number[], start: number, end: number): void {
  for (let frame = start; frame <= end; frame++) target.push(frame);
}

function repeatRange(target: number[], start: number, end: number, count: number): void {
  for (let i = 0; i < count; i++) appendRange(target, start, end);
}

export function buildNaturalSlowFrameSequence(): Uint16Array {
  const frames: number[] = [];

  // Набор номера остаётся обычным.
  appendRange(frames, 0, 350);

  // Ответ станции. Повторяем живой рисунок трелей целиком, а не один кадр.
  appendRange(frames, 351, 619);
  repeatRange(frames, 620, 884, 5);

  // 2100 Гц и переговоры двух модемов.
  appendRange(frames, 885, 1097);
  repeatRange(frames, 1035, 1097, 10);
  repeatRange(frames, 1098, 1207, 10);
  appendRange(frames, 1128, 1209);

  // Проверка линии. Каждый бонг остаётся естественным движущимся мини-фрагментом.
  repeatRange(frames, 1210, 1353, 5);

  // Высокочастотное обучение. Используем те же естественные петли,
  // которые уже хорошо звучат в расширенной версии.
  appendRange(frames, 1354, 1572);
  repeatRange(frames, 1410, 1572, 12);
  appendRange(frames, 1438, 1607);

  // Эквалайзер и подавление эха.
  appendRange(frames, 1608, 1985);
  repeatRange(frames, 1670, 1985, 10);
  appendRange(frames, 1822, 2013);

  // Разгон и поток данных.
  appendRange(frames, 2014, 2184);
  repeatRange(frames, 2065, 2184, 8);
  appendRange(frames, 2095, 2227);
  appendRange(frames, 2228, 2465);
  repeatRange(frames, 2288, 2465, 7);
  appendRange(frames, 2288, 2539);

  return Uint16Array.from(frames);
}

export function synthesizeNaturalSlowModem(): SlowModemSynthesisResult {
  const frameSequence = buildNaturalSlowFrameSequence();
  const rendered = renderFrameSequenceTo44k(frameSequence, true);
  const samples = new Float32Array(rendered);

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.001) {
    const scale = 0.90 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }

  return {
    sampleRate: SAMPLE_RATE,
    durationSec: samples.length / SAMPLE_RATE,
    samples,
  };
}
