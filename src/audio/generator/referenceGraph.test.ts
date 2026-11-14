import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  SAMPLE_RATE,
  synthesizeDialupHandshake,
} from '../dialupDsp';
import {
  buildReferenceGraphPlan,
  renderReferenceGraphPlan,
  REFERENCE_STAGE_FRAME_RANGES,
} from './referenceGraph';

function snrDb(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sig = 0;
  let err = 0;
  for (let i = 0; i < n; i++) {
    sig += a[i] * a[i];
    const e = a[i] - b[i];
    err += e * e;
  }
  return 10 * Math.log10(sig / Math.max(1e-30, err));
}

function maxJump(samples: Float32Array): number {
  let best = 0;
  for (let i = 1; i < samples.length; i++) {
    best = Math.max(best, Math.abs(samples[i] - samples[i - 1]));
  }
  return best;
}

test('exact reference graph clone matches the successful model sample-for-sample', () => {
  const reference = synthesizeDialupHandshake(DEFAULT_CONFIG);
  const plan = buildReferenceGraphPlan({ seed: 0, variation: false });
  const generated = renderReferenceGraphPlan(plan);

  assert.equal(generated.sampleRate, SAMPLE_RATE);
  assert.equal(generated.samples.length, reference.samples.length);
  assert.ok(snrDb(reference.samples, generated.samples) > 140);

  let worst = 0;
  for (let i = 0; i < reference.samples.length; i++) {
    worst = Math.max(worst, Math.abs(reference.samples[i] - generated.samples[i]));
  }
  assert.ok(worst < 1e-6, `worst sample error ${worst}`);
});

test('new connection changes the path but keeps every frame inside its own modem stage', () => {
  const base = buildReferenceGraphPlan({ seed: 0, variation: false });
  const varied = buildReferenceGraphPlan({ seed: 314159, variation: true });

  assert.notDeepEqual(Array.from(varied.frameSequence), Array.from(base.frameSequence));
  assert.ok(varied.frameSequence.length > base.frameSequence.length);

  for (const stage of varied.stageSlices) {
    const allowed = REFERENCE_STAGE_FRAME_RANGES.find((x) => x.id === stage.id)!;
    for (let i = stage.outputStartFrame; i < stage.outputEndFrame; i++) {
      const sourceFrame = varied.frameSequence[i];
      assert.ok(
        sourceFrame >= allowed.startFrame && sourceFrame <= allowed.endFrame,
        `${stage.id} contains source frame ${sourceFrame}`
      );
    }
  }
});

test('varied connection stays finite, non-clipping, and no rougher than successful long model', () => {
  const variedPlan = buildReferenceGraphPlan({ seed: 271828, variation: true });
  const varied = renderReferenceGraphPlan(variedPlan);
  const longReference = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    extendedMode: true,
  });

  let peak = 0;
  for (const sample of varied.samples) {
    assert.ok(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
  }

  assert.ok(peak <= 0.91, `peak ${peak}`);
  assert.ok(varied.durationSec > 25);
  assert.ok(
    maxJump(varied.samples) <= maxJump(longReference.samples) * 1.02 + 1e-6,
    `varied jump ${maxJump(varied.samples)}, long reference jump ${maxJump(longReference.samples)}`
  );
});

test('many generated connections stay inside the strict transition gate and actually vary', () => {
  const variants = new Set<string>();

  for (let seed = 1; seed <= 64; seed++) {
    const plan = buildReferenceGraphPlan({ seed, variation: true });
    assert.ok(plan.transitionScores.length > 0, `seed ${seed} did not vary`);
    for (const score of plan.transitionScores) {
      assert.ok(score <= 0.18, `seed ${seed} unsafe transition ${score}`);
    }
    variants.add(Array.from(plan.frameSequence).join(','));
  }

  assert.ok(variants.size >= 12, `only ${variants.size} unique generated paths`);
});

test('several rendered generated connections remain as smooth as the accepted long model', () => {
  const longReference = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    extendedMode: true,
  });
  const allowedJump = maxJump(longReference.samples) * 1.02 + 1e-6;

  for (const seed of [2, 7, 19, 31, 47, 63]) {
    const rendered = renderReferenceGraphPlan(
      buildReferenceGraphPlan({ seed, variation: true })
    );
    assert.ok(maxJump(rendered.samples) <= allowedJump, `seed ${seed} has a rough seam`);
  }
});
