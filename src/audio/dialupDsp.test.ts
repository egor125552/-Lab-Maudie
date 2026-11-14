import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  REFERENCE_AUDIO_URLS,
  SAMPLE_RATE,
  computeSpectrogram,
  encodeWav16Bit,
  getPhasesForSource,
  sanitizeDialNumber,
  synthesizeDialupHandshake,
} from './dialupDsp';

/** Measure power at a specific frequency (Hz) in a slice of samples via Goertzel / DFT */
function measureFreqMagnitude(
  samples: Float32Array,
  sampleRate: number,
  startSec: number,
  durationSec: number,
  targetHz: number
): number {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const len = Math.min(samples.length - startIdx, Math.floor(durationSec * sampleRate));
  let re = 0;
  let im = 0;
  for (let i = 0; i < len; i++) {
    const s = samples[startIdx + i];
    const angle = (2 * Math.PI * targetHz * i) / sampleRate;
    re += s * Math.cos(angle);
    im -= s * Math.sin(angle);
  }
  return Math.sqrt(re * re + im * im) / Math.max(1, len);
}

test('sanitizeDialNumber keeps valid DTMF & pause symbols', () => {
  assert.equal(sanitizeDialNumber('8-800-555-35-35'), '88005553535');
  assert.equal(sanitizeDialNumber('*99#w12,3'), '*99#W12,3');
  assert.equal(sanitizeDialNumber('---'), '81855592160');
});

test('reference audio URLs and phase timelines cover all 7 stages', () => {
  assert.ok(REFERENCE_AUDIO_URLS.orig1.startsWith('assets/aistudio/'));
  assert.ok(REFERENCE_AUDIO_URLS.orig2.startsWith('assets/aistudio/'));

  const p1 = getPhasesForSource('orig1', 26.04);
  const p2 = getPhasesForSource('orig2', 31.37);
  assert.equal(p1.length, 7);
  assert.equal(p2.length, 7);
});

test('calibrated V.90 handshake produces 7 phases and non-clipping audio', () => {
  const result = synthesizeDialupHandshake(DEFAULT_CONFIG);

  assert.equal(result.sampleRate, SAMPLE_RATE);
  assert.ok(result.durationSec >= 25.0, `Expected >=25.0s duration, got ${result.durationSec}`);
  assert.equal(result.samples.length, Math.ceil(result.durationSec * SAMPLE_RATE));
  assert.equal(result.phases.length, 7, 'Expected 7 phases in calibrated V.90 handshake');

  let maxAbs = 0;
  for (let i = 0; i < result.samples.length; i++) {
    const s = result.samples[i];
    assert.ok(Number.isFinite(s), `Sample ${i} is not finite`);
    const a = Math.abs(s);
    if (a > maxAbs) maxAbs = a;
  }
  assert.ok(maxAbs > 0.2 && maxAbs <= 0.95, `Peak amplitude ${maxAbs} out of expected range`);
});

test('extended 39s V.90 handshake produces ~39.2s 7-phase direct-line audio', () => {
  const result = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    extendedMode: true,
  });

  assert.equal(result.sampleRate, SAMPLE_RATE);
  assert.ok(result.durationSec >= 38.5 && result.durationSec <= 40.5, `Expected ~39.2s duration, got ${result.durationSec}`);
  assert.equal(result.phases.length, 7, 'Expected 7 phases in extended V.90 handshake');

  let maxAbs = 0;
  for (let i = 0; i < result.samples.length; i++) {
    const s = result.samples[i];
    assert.ok(Number.isFinite(s), `Sample ${i} is not finite`);
    const a = Math.abs(s);
    if (a > maxAbs) maxAbs = a;
  }
  assert.ok(maxAbs > 0.4 && maxAbs <= 0.95, `Peak amplitude ${maxAbs} out of expected range`);
});

test('DTMF digit 5 contains exact 770 Hz and 1336 Hz spectral peaks', () => {
  const res = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    phoneNumber: '5',
    dialMode: 'dtmf',
    speakerColor: 0,
    lineNoise: 0,
    lineImpairment: 0,
  });

  const dialingPhase = res.phases.find((p) => p.id === 'dialing')!;
  assert.ok(dialingPhase);
  const t0 = dialingPhase.startSec + 0.96;
  const mag770 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.10, 770);
  const mag1336 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.10, 1336);
  const magOther = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.10, 1000);

  assert.ok(mag770 > magOther * 4, `Expected 770 Hz (${mag770}) >> 1000 Hz (${magOther})`);
  assert.ok(mag1336 > magOther * 4, `Expected 1336 Hz (${mag1336}) >> 1000 Hz (${magOther})`);
});

test('V.90 ANSam has 2100 Hz carrier and 15 Hz AM sidebands (2085 & 2115 Hz)', () => {
  const res = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    profile: 'v90',
    speakerColor: 0,
    lineNoise: 0,
    lineImpairment: 0,
  });

  const ansam = res.phases.find((p) => p.id === 'ansam')!;
  assert.ok(ansam);
  const t0 = ansam.startSec + 0.05;
  const mag2100 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.35, 2100);
  const mag2085 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.35, 2085);
  const mag1500 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.35, 1500);

  assert.ok(mag2100 > mag1500 * 10, `Expected strong 2100 Hz carrier (${mag2100})`);
  assert.ok(mag2085 > mag1500 * 1.5, `Expected 15 Hz AM sideband at 2085 Hz (${mag2085})`);
});

test('V.34/V.90 L1 probing comb contains 600/750 Hz and omits 900 Hz & 1800 Hz', () => {
  const res = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    profile: 'v90',
    speakerColor: 0,
    lineNoise: 0,
    lineImpairment: 0,
  });

  const probe = res.phases.find((p) => p.id === 'probe')!;
  assert.ok(probe);
  const t0 = probe.startSec + 0.76;
  const mag600 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.14, 600);
  const mag750 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.14, 750);
  const mag900 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.14, 900);
  const mag1800 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.14, 1800);

  assert.ok(mag600 > mag900 * 3, `Expected 600 Hz (${mag600}) >> omitted 900 Hz (${mag900})`);
  assert.ok(mag750 > mag1800 * 3, `Expected 750 Hz (${mag750}) >> omitted 1800 Hz (${mag1800})`);
});

test('V.34/V.90 Phase 3 Signal S produces dual-tone 600 Hz and 3000 Hz whistle', () => {
  const res = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    profile: 'v90',
    speakerColor: 0,
    lineNoise: 0,
    lineImpairment: 0,
  });

  const train = res.phases.find((p) => p.id === 'training')!;
  assert.ok(train);
  const t0 = train.startSec + 0.03;
  const mag600 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.14, 600);
  const mag3000 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.14, 3000);
  const mag1800 = measureFreqMagnitude(res.samples, res.sampleRate, t0, 0.14, 1800);

  assert.ok(mag600 > mag1800 * 4, `Expected 600 Hz sideband (${mag600}) >> suppressed 1800 Hz carrier (${mag1800})`);
  assert.ok(mag3000 > mag1800 * 4, `Expected 3000 Hz sideband (${mag3000}) >> suppressed 1800 Hz carrier (${mag1800})`);
});

test('computeSpectrogram and encodeWav16Bit return valid structures', () => {
  const res = synthesizeDialupHandshake({
    ...DEFAULT_CONFIG,
    phoneNumber: '12',
  });

  const spec = computeSpectrogram(res.samples, res.sampleRate, 120, 4200);
  assert.equal(spec.timeBins, 120);
  assert.ok(spec.freqBins > 50);
  assert.equal(spec.magnitudes.length, spec.timeBins * spec.freqBins);
  for (let i = 0; i < spec.magnitudes.length; i++) {
    assert.ok(spec.magnitudes[i] >= 0 && spec.magnitudes[i] <= 1);
  }

  const wav = encodeWav16Bit(res.samples, res.sampleRate);
  assert.equal(wav.length, 44 + res.samples.length * 2);
  const header = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
  const waveTag = String.fromCharCode(wav[8], wav[9], wav[10], wav[11]);
  assert.equal(header, 'RIFF');
  assert.equal(waveTag, 'WAVE');
});
