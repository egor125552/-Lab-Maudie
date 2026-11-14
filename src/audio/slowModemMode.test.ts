import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLE_RATE,
  buildFrameSequence,
  encodeWav16Bit,
  renderFrameSequenceTo44k,
} from './dialupDsp';
import { buildSlowModemFrameSequence, synthesizeSlowModemFromSpectralFrames } from './slowModemMode';

function magnitude(samples: Float32Array, startSec: number, durationSec: number, hz: number) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const len = Math.min(samples.length - start, Math.floor(durationSec * SAMPLE_RATE));
  let re = 0, im = 0;
  for (let i = 0; i < len; i++) {
    const a = 2 * Math.PI * hz * i / SAMPLE_RATE;
    const s = samples[start + i];
    re += s * Math.cos(a);
    im -= s * Math.sin(a);
  }
  return Math.hypot(re, im) / Math.max(1, len);
}

test('slow modem mode repeats spectral states inside our synthesizer, not rendered PCM', () => {
  const original = buildFrameSequence(true);
  const slow = buildSlowModemFrameSequence(original, 5, 351);

  assert.equal(slow.length, 351 + (original.length - 351) * 5);
  for (let i = 0; i < 351; i++) assert.equal(slow[i], original[i]);

  const sourceFrame = original[400];
  const start = 351 + (400 - 351) * 5;
  for (let i = 0; i < 5; i++) assert.equal(slow[start + i], sourceFrame);
});

test('slow modem synthesized by our frame renderer stays pitched and becomes multi-minute', () => {
  const result = synthesizeSlowModemFromSpectralFrames(5);
  assert.ok(result.durationSec > 175 && result.durationSec < 190, String(result.durationSec));

  let peak = 0;
  for (const s of result.samples) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak <= 0.91);

  // 2100 Hz ANSam begins after unchanged 3.5s + slowed 3.5..8.83 interval.
  const ansamStart = 3.5 + (8.83 - 3.5) * 5;
  const m2100 = magnitude(result.samples, ansamStart + 0.25, 0.35, 2100);
  const m420 = magnitude(result.samples, ansamStart + 0.25, 0.35, 420);
  assert.ok(m2100 > m420 * 10, `2100=${m2100} 420=${m420}`);

  const wav = encodeWav16Bit(result.samples, SAMPLE_RATE);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
});
