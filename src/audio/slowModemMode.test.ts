import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_RATE } from './dialupDsp';
import {
  SLOW_MODE_OPTIONS,
  synthesizeSlowModem,
  type SlowModelMode,
} from './slowModemMode';

function maxJump(samples: Float32Array): number {
  let best = 0;
  for (let i = 1; i < samples.length; i++) {
    best = Math.max(best, Math.abs(samples[i] - samples[i - 1]));
  }
  return best;
}

test('slow modem exposes exactly two user modes: 10 ms and 1 ms', () => {
  assert.deepEqual(
    SLOW_MODE_OPTIONS.map((x) => [x.id, x.frameStepMs]),
    [
      ['standard10ms', 10],
      ['precision1ms', 1],
    ]
  );
});

for (const mode of ['standard10ms', 'precision1ms'] as SlowModelMode[]) {
  test(`${mode} produces finite non-clipping multi-minute audio`, () => {
    const result = synthesizeSlowModem(mode, 5);
    assert.equal(result.sampleRate, SAMPLE_RATE);
    assert.ok(result.durationSec > 120 && result.durationSec < 210, String(result.durationSec));
    assert.equal(result.mode, mode);

    let peak = 0;
    for (const s of result.samples) {
      assert.ok(Number.isFinite(s));
      peak = Math.max(peak, Math.abs(s));
    }
    assert.ok(peak <= 0.91, `peak=${peak}`);
    assert.ok(maxJump(result.samples) < 0.40, `jump=${maxJump(result.samples)}`);
  });
}

test('1 ms precision mode reports millisecond analysis states', () => {
  const result = synthesizeSlowModem('precision1ms', 3);
  assert.equal(result.frameStepMs, 1);
  assert.ok(result.analysisFrameCount > 30000, String(result.analysisFrameCount));
});
