import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_RATE } from './dialupDsp';
import { buildNaturalSlowFrameSequence, synthesizeNaturalSlowModem } from './slowModemMode';

function longestIdenticalRun(seq: Uint16Array): number {
  let best = 1, run = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

test('natural slow mode loops moving phrases instead of freezing one 10 ms frame', () => {
  const seq = buildNaturalSlowFrameSequence();
  assert.ok(seq.length > 12000, `expected long multi-minute sequence, got ${seq.length} frames`);
  assert.ok(longestIdenticalRun(seq) <= 2,
    `a spectral frame was frozen for ${longestIdenticalRun(seq)} consecutive hops`);

  // Dialing stays unchanged.
  for (let i = 0; i <= 350; i++) assert.equal(seq[i], i);
});

test('natural slow modem remains finite, non-clipping and multi-minute', () => {
  const result = synthesizeNaturalSlowModem();
  assert.equal(result.sampleRate, SAMPLE_RATE);
  assert.ok(result.durationSec > 120 && result.durationSec < 210, String(result.durationSec));

  let peak = 0;
  for (const sample of result.samples) {
    assert.ok(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
  }
  assert.ok(peak <= 0.91, String(peak));
});
