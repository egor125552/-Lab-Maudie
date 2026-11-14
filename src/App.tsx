import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Check, Play, RefreshCw, Square, Volume2 } from 'lucide-react';
import {
  AudioSourceMode,
  DEFAULT_CONFIG,
  HandshakePhase,
  REFERENCE_AUDIO_URLS,
  encodeWav16Bit,
  getPhasesForSource,
  synthesizeDialupHandshake,
} from './audio/dialupDsp';
import { DecodedTrackData, DialupAudioPlayer } from './audio/webAudioPlayer';
import {
  buildReferenceGraphPlan,
  getReferenceGraphDenseCoefficients,
  renderReferenceGraphPlan,
} from './audio/generator/referenceGraph';
import type { ReferenceGraphWorkletModel } from './audio/generator/referenceGraphWorklet';
import { SimpleWaveform } from './components/SimpleWaveform';

function formatTimeSec(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const rem = clamped - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(1).padStart(4, '0')}`;
}

const EXPORT_NAMES: Record<AudioSourceMode, string> = {
  algorithmic: 'Точный dial-up генератор.wav',
  synth_long: 'Dial-up длинное соединение.wav',
  synth: 'Dial-up классика.wav',
  orig1: 'Dial-up эталон чистая линия.wav',
  orig2: 'Dial-up эталон живой динамик.wav',
};

const SOURCE_OPTIONS: { id: AudioSourceMode; label: string }[] = [
  { id: 'algorithmic', label: 'Генератор по модели' },
  { id: 'synth_long', label: 'Долгое соединение (39 сек)' },
  { id: 'synth', label: 'Классика (25 сек)' },
  { id: 'orig1', label: 'Эталон 1 (Чистая линия)' },
  { id: 'orig2', label: 'Эталон 2 (Живой динамик)' },
];

export default function App() {
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>('algorithmic');
  const [volume, setVolume] = useState<number>(0.9);
  const [algorithmicSeed, setAlgorithmicSeed] = useState<number>(1);
  const [algorithmicVariation, setAlgorithmicVariation] = useState<boolean>(false);
  const [algorithmicLongSounds, setAlgorithmicLongSounds] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playheadSec, setPlayheadSec] = useState<number>(0);
  const [exportSaved, setExportSaved] = useState<boolean>(false);
  const [decodedTracks, setDecodedTracks] = useState<
    Partial<Record<'orig1' | 'orig2', DecodedTrackData>>
  >({});

  const playerRef = useRef<DialupAudioPlayer | null>(null);
  const rafRef = useRef<number | null>(null);

  if (!playerRef.current) {
    playerRef.current = new DialupAudioPlayer();
  }

  // Synthesize the extended 39.2s HD line handshake and classic 25.4s HD line handshake
  const synthesisLong = useMemo(
    () => synthesizeDialupHandshake({ ...DEFAULT_CONFIG, extendedMode: true }),
    []
  );
  const synthesisClassic = useMemo(
    () => synthesizeDialupHandshake({ ...DEFAULT_CONFIG, extendedMode: false }),
    []
  );
  const referenceGraphPlan = useMemo(
    () =>
      buildReferenceGraphPlan({
        seed: algorithmicSeed,
        variation: algorithmicVariation,
        longSounds: algorithmicLongSounds,
      }),
    [algorithmicSeed, algorithmicVariation, algorithmicLongSounds]
  );
  const synthesisAlgorithmic = useMemo(
    () => renderReferenceGraphPlan(referenceGraphPlan),
    [referenceGraphPlan]
  );
  const referenceDenseCoefficients = useMemo(
    () => getReferenceGraphDenseCoefficients(),
    []
  );
  const referenceGraphModel = useMemo<ReferenceGraphWorkletModel>(
    () => ({
      plan: referenceGraphPlan,
      denseCoefficients: referenceDenseCoefficients,
      normalizationGain: synthesisAlgorithmic.normalizationGain,
    }),
    [referenceGraphPlan, referenceDenseCoefficients, synthesisAlgorithmic.normalizationGain]
  );

  // Preload & decode the two attached MP3 reference recordings for instant comparison
  useEffect(() => {
    let cancelled = false;
    const player = playerRef.current;
    if (!player) return;

    const loadBoth = async () => {
      try {
        const [t1, t2] = await Promise.all([
          player.decodeAudioUrl(REFERENCE_AUDIO_URLS.orig1),
          player.decodeAudioUrl(REFERENCE_AUDIO_URLS.orig2),
        ]);
        if (!cancelled) {
          setDecodedTracks({ orig1: t1, orig2: t2 });
        }
      } catch {
        // Fallback to synthesized audio if decoding fails
      }
    };

    void loadBoth();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTrack = useMemo(() => {
    if (sourceMode === 'algorithmic') {
      return synthesisAlgorithmic;
    }
    if (sourceMode === 'synth_long') {
      return synthesisLong;
    }
    if (sourceMode === 'orig1' && decodedTracks.orig1) {
      return {
        samples: decodedTracks.orig1.samples,
        sampleRate: decodedTracks.orig1.sampleRate,
        durationSec: decodedTracks.orig1.durationSec,
        phases: getPhasesForSource('orig1', decodedTracks.orig1.durationSec),
      };
    }
    if (sourceMode === 'orig2' && decodedTracks.orig2) {
      return {
        samples: decodedTracks.orig2.samples,
        sampleRate: decodedTracks.orig2.sampleRate,
        durationSec: decodedTracks.orig2.durationSec,
        phases: getPhasesForSource('orig2', decodedTracks.orig2.durationSec),
      };
    }
    return synthesisClassic;
  }, [sourceMode, decodedTracks, synthesisLong, synthesisClassic, synthesisAlgorithmic]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.setVolume(volume);
    if (sourceMode === 'algorithmic') {
      player.loadReferenceGraphModel(referenceGraphModel, activeTrack.samples);
    } else {
      player.loadSamples(activeTrack.samples, activeTrack.sampleRate);
    }
  }, [activeTrack, referenceGraphModel, sourceMode, volume]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      playerRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      const player = playerRef.current;
      if (!player || !player.getIsPlaying()) {
        setIsPlaying(false);
        return;
      }
      setPlayheadSec(player.getCurrentTimeSec());
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying]);

  const handleSelectSource = useCallback((nextMode: AudioSourceMode) => {
    playerRef.current?.stop(false);
    setIsPlaying(false);
    setPlayheadSec(0);
    setSourceMode(nextMode);
  }, []);

  const handleChangeVolume = useCallback((vol: number) => {
    setVolume(vol);
    playerRef.current?.setVolume(vol);
  }, []);

  const handleNewAlgorithmicConnection = useCallback(() => {
    playerRef.current?.stop(false);
    setIsPlaying(false);
    setPlayheadSec(0);
    setAlgorithmicLongSounds(false);
    setAlgorithmicVariation(true);
    setAlgorithmicSeed((seed) => seed + 1);
  }, []);

  const handleExactAlgorithmicConnection = useCallback(() => {
    playerRef.current?.stop(false);
    setIsPlaying(false);
    setPlayheadSec(0);
    setAlgorithmicVariation(false);
    setAlgorithmicLongSounds(false);
  }, []);

  const handleLongSoundsAlgorithmicConnection = useCallback(() => {
    playerRef.current?.stop(false);
    setIsPlaying(false);
    setPlayheadSec(0);
    setAlgorithmicVariation(false);
    setAlgorithmicLongSounds(true);
  }, []);

  const handleTogglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    if (isPlaying) {
      player.stop(false);
      setIsPlaying(false);
      return;
    }

    const startFrom = playheadSec >= activeTrack.durationSec - 0.1 ? 0 : playheadSec;
    setPlayheadSec(startFrom);
    setIsPlaying(true);
    void player.play(startFrom, null, () => {
      setIsPlaying(false);
      setPlayheadSec(activeTrack.durationSec);
    });
  }, [isPlaying, playheadSec, activeTrack.durationSec]);

  const handleSeek = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(activeTrack.durationSec, targetSec));
      setPlayheadSec(clamped);
      const player = playerRef.current;
      if (!player) return;
      setIsPlaying(true);
      void player.play(clamped, null, () => {
        setIsPlaying(false);
        setPlayheadSec(activeTrack.durationSec);
      });
    },
    [activeTrack.durationSec]
  );

  const handlePlayStep = useCallback(
    (phase: HandshakePhase) => {
      const player = playerRef.current;
      if (!player) return;
      setPlayheadSec(phase.startSec);
      setIsPlaying(true);
      void player.play(phase.startSec, null, () => {
        setIsPlaying(false);
        setPlayheadSec(activeTrack.durationSec);
      });
    },
    [activeTrack.durationSec]
  );

  const handleExportWav = useCallback(() => {
    const wavBytes = encodeWav16Bit(activeTrack.samples, activeTrack.sampleRate);
    const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download =
      sourceMode === 'algorithmic' && algorithmicLongSounds
        ? 'Dial-up с длинными звуками.wav'
        : sourceMode === 'algorithmic' && algorithmicVariation
          ? 'Новое dial-up соединение по модели.wav'
          : EXPORT_NAMES[sourceMode];
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportSaved(true);
    setTimeout(() => setExportSaved(false), 2200);
  }, [activeTrack, sourceMode, algorithmicVariation, algorithmicLongSounds]);

  const activePhase = useMemo(() => {
    return (
      activeTrack.phases.find(
        (p) => playheadSec >= p.startSec && playheadSec <= p.endSec + 0.001
      ) ?? activeTrack.phases[0] ?? null
    );
  }, [activeTrack.phases, playheadSec]);

  const isCompleted = !isPlaying && playheadSec >= activeTrack.durationSec - 0.08;

  return (
    <div className="min-h-screen bg-[#090C12] text-slate-100 flex flex-col">
      {/* Clean Minimal Top Bar */}
      <header className="border-b border-slate-800 bg-[#0B0F17]">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            Dial-Up 56K
          </a>

          {/* Source Switcher: Extended 39s HD Line + Classic 25s HD Line + Reference Recordings */}
          <div
            role="group"
            aria-label="Выбор варианта звука модема"
            className="flex flex-wrap items-center gap-1.5 bg-[#090C12] p-1 rounded-lg border border-slate-800"
          >
            {SOURCE_OPTIONS.map((opt) => {
              const active = sourceMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectSource(opt.id)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                    active
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {sourceMode === 'algorithmic' && (
              <>
                <button
                  type="button"
                  onClick={handleExactAlgorithmicConnection}
                  aria-pressed={!algorithmicVariation && !algorithmicLongSounds}
                  className={`min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold border inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                    !algorithmicVariation && !algorithmicLongSounds
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-100 border-slate-700'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Точная копия</span>
                </button>
                <button
                  type="button"
                  onClick={handleLongSoundsAlgorithmicConnection}
                  aria-pressed={algorithmicLongSounds}
                  className={`min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold border inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                    algorithmicLongSounds
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-100 border-slate-700'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Длинные звуки</span>
                </button>
                <button
                  type="button"
                  onClick={handleNewAlgorithmicConnection}
                  aria-pressed={algorithmicVariation}
                  className={`min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold border inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                    algorithmicVariation
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-100 border-slate-700'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>Новое соединение</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleExportWav}
              className="min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400"
            >
              {exportSaved ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  <span>WAV сохранён</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  <span>Скачать WAV</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Focused Single-Container Stage */}
      <main
        id="top"
        data-playback={isPlaying ? 'playing' : isCompleted ? 'completed' : 'idle'}
        className="flex-1 max-w-[1040px] w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col justify-center"
      >
        <section
          aria-label="Плеер звука модема 56K"
          className="border border-slate-800 bg-[#10151F] rounded-xl overflow-hidden"
        >
          {/* Hero Launch Row: Big Button + Timer + Volume */}
          <div className="p-6 sm:p-8 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <button
                type="button"
                onClick={handleTogglePlay}
                className={`min-h-[56px] px-7 py-3.5 rounded-lg text-base font-bold inline-flex items-center justify-center gap-3 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                  isPlaying
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Square className="w-5 h-5 fill-current" aria-hidden="true" />
                    <span>Остановить звук</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-current" aria-hidden="true" />
                    <span>
                      Включить звук модема ({Math.round(activeTrack.durationSec)} сек)
                    </span>
                  </>
                )}
              </button>

              <div className="flex items-center gap-3 px-1">
                <Volume2 className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                <input
                  id="volume-slider"
                  type="range"
                  aria-label="Громкость звука"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => handleChangeVolume(parseFloat(e.target.value))}
                  className="w-28 dsp-slider"
                />
              </div>
            </div>

            <div className="flex items-baseline gap-6 shrink-0">
              <div>
                <div className="text-xs text-slate-400">Время</div>
                <div
                  data-testid="time-readout"
                  className="mt-0.5 text-2xl font-mono font-bold tabular-nums text-slate-100 whitespace-nowrap"
                >
                  {formatTimeSec(playheadSec)}
                  <span className="text-sm font-normal text-slate-400 ml-1.5">
                    / {formatTimeSec(activeTrack.durationSec)}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-400">Шаг</div>
                <div
                  data-testid="phase-readout"
                  className="mt-0.5 text-2xl font-mono font-bold tabular-nums text-amber-400 whitespace-nowrap"
                >
                  {activePhase ? `${activePhase.index} / ${activeTrack.phases.length}` : '—'}
                </div>
              </div>
            </div>
          </div>

          {sourceMode === 'algorithmic' && (
            <div
              role="status"
              aria-live="polite"
              className="px-6 py-3 bg-[#0B1018] border-b border-slate-800 text-sm text-slate-300"
            >
              {algorithmicLongSounds
                ? 'Режим генератора: длинные звуки, удлиняются сами пик, bong, визги и шумовые участки'
                : algorithmicVariation
                  ? `Режим генератора: новое соединение ${algorithmicSeed}, используются только проверенные спектральные петли`
                  : 'Режим генератора: точная копия, путь совпадает с удачной моделью'}
            </div>
          )}

          {/* Short Live Step Caption (1 concise plain-Russian sentence) */}
          <div aria-live="polite" className="px-6 py-4 bg-[#0D121B] border-b border-slate-800 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-base font-semibold text-slate-100">
              {isCompleted
                ? 'Готово — модем подключился к интернету (56 000 бит/с)'
                : activePhase
                  ? `${activePhase.index}. ${activePhase.title}`
                  : 'Нажмите кнопку, чтобы услышать полный звук модема'}
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              {activePhase?.simpleSummary}
            </p>
          </div>

          {/* Interactive Waveform */}
          <SimpleWaveform
            samples={activeTrack.samples}
            durationSec={activeTrack.durationSec}
            phases={activeTrack.phases}
            activePhase={activePhase}
            playheadSec={playheadSec}
            isPlaying={isPlaying}
            onSeek={handleSeek}
          />

          {/* Simple Step Buttons to Jump to Any Part of the Sound */}
          <div className="p-4 bg-[#0D121B] border-t border-slate-800">
            <div
              className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2"
              role="group"
              aria-label="Быстрый переход по шагам звука"
            >
              {activeTrack.phases.map((phase) => {
                const isCurrent = activePhase?.id === phase.id;
                return (
                  <button
                    key={phase.id}
                    type="button"
                    onClick={() => handlePlayStep(phase)}
                    aria-label={`Шаг ${phase.index}: ${phase.title}`}
                    className={`px-3 py-2.5 rounded-lg text-left transition-colors border cursor-pointer focus-visible:outline-2 focus-visible:outline-amber-400 ${
                      isCurrent
                        ? 'bg-amber-500/15 border-amber-500/70 text-amber-200'
                        : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100'
                    }`}
                  >
                    <div className="text-xs font-semibold whitespace-nowrap truncate">
                      {phase.shortLabel}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                      {phase.startSec.toFixed(1)}–{phase.endSec.toFixed(1)} с
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
