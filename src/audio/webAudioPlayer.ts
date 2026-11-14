import { createDialupWorkletProcessorCode } from './dialupDsp';

export interface DecodedTrackData {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
}

export class DialupAudioPlayer {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private workletReady = false;
  private workletInitPromise: Promise<boolean> | null = null;

  private source: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;

  private isPlayingState = false;
  private startContextTime = 0;
  private startOffsetSec = 0;
  private workletTimeSec = 0;
  private stopAtSec: number | null = null;
  private volume = 0.85;
  private onEndedCallback: (() => void) | null = null;

  private pendingSamples: Float32Array | null = null;
  private pendingSampleRate = 44100;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.volume;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.72;

      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private async ensureWorklet(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (this.workletReady && this.workletNode) return true;
    if (this.workletInitPromise) return this.workletInitPromise;

    this.workletInitPromise = (async () => {
      try {
        if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
          return false;
        }
        const code = createDialupWorkletProcessorCode();
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          await ctx.audioWorklet.addModule(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }

        const node = new AudioWorkletNode(ctx, 'dialup-v90-worklet', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });

        node.port.onmessage = (event) => {
          const msg = event.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'position' && typeof msg.timeSec === 'number') {
            this.workletTimeSec = msg.timeSec;
          } else if (msg.type === 'ended') {
            this.isPlayingState = false;
            this.onEndedCallback?.();
          }
        };

        if (this.gainNode) {
          node.connect(this.gainNode);
        }

        if (this.pendingSamples) {
          node.port.postMessage({
            type: 'load',
            samples: this.pendingSamples,
            sampleRate: this.pendingSampleRate,
          });
        }

        this.workletNode = node;
        this.workletReady = true;
        return true;
      } catch {
        return false;
      }
    })();

    return this.workletInitPromise;
  }

  async decodeAudioUrl(url: string): Promise<DecodedTrackData> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status}`);
    }
    const arrayBuf = await response.arrayBuffer();
    const ctx = this.ensureContext();
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));

    const len = decoded.length;
    const mono = new Float32Array(len);
    const ch0 = decoded.getChannelData(0);
    if (decoded.numberOfChannels > 1) {
      const ch1 = decoded.getChannelData(1);
      for (let i = 0; i < len; i++) {
        mono[i] = 0.5 * (ch0[i] + ch1[i]);
      }
    } else {
      mono.set(ch0);
    }

    let peak = 0;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(mono[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0.001) {
      const scale = 0.90 / peak;
      for (let i = 0; i < len; i++) {
        mono[i] *= scale;
      }
    }

    return {
      samples: mono,
      sampleRate: decoded.sampleRate,
      durationSec: decoded.duration,
    };
  }

  loadSamples(samples: Float32Array, sampleRate: number) {
    this.stop(false);
    if (this.ctx) {
      const buf = this.ctx.createBuffer(1, samples.length, sampleRate);
      buf.copyToChannel(new Float32Array(samples), 0);
      this.audioBuffer = buf;
    } else {
      this.audioBuffer = null;
    }
    this.pendingSamples = samples;
    this.pendingSampleRate = sampleRate;

    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'load',
        samples,
        sampleRate,
      });
    }
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  async play(
    offsetSec = 0,
    endSec: number | null = null,
    onEnded?: () => void
  ): Promise<void> {
    const ctx = this.ensureContext();
    this.stop(false);
    this.onEndedCallback = onEnded ?? null;

    const totalDur = this.pendingSamples
      ? this.pendingSamples.length / this.pendingSampleRate
      : (this.audioBuffer?.duration ?? 0);
    const safeOffset = Math.max(0, Math.min(offsetSec, Math.max(0, totalDur - 0.01)));
    const targetEnd = endSec !== null ? Math.min(endSec, totalDur) : totalDur;

    this.startContextTime = ctx.currentTime;
    this.startOffsetSec = safeOffset;
    this.workletTimeSec = safeOffset;
    this.stopAtSec = targetEnd;
    this.isPlayingState = true;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const hasWorklet = await this.ensureWorklet();
    if (!this.isPlayingState) return;

    if (hasWorklet && this.workletNode && this.pendingSamples) {
      this.startContextTime = ctx.currentTime;
      this.workletNode.port.postMessage({
        type: 'play',
        offsetSec: safeOffset,
        endSec: targetEnd,
      });
      return;
    }

    // Fallback if AudioWorklet is unavailable
    if (!this.audioBuffer && this.pendingSamples) {
      const buf = ctx.createBuffer(1, this.pendingSamples.length, this.pendingSampleRate);
      buf.copyToChannel(new Float32Array(this.pendingSamples), 0);
      this.audioBuffer = buf;
    }
    if (!this.audioBuffer || !this.gainNode) return;

    const duration =
      endSec !== null
        ? Math.max(0.05, Math.min(endSec, this.audioBuffer.duration) - safeOffset)
        : undefined;

    const src = ctx.createBufferSource();
    src.buffer = this.audioBuffer;
    src.connect(this.gainNode);

    src.onended = () => {
      if (this.source === src) {
        this.isPlayingState = false;
        this.source = null;
        this.onEndedCallback?.();
      }
    };

    this.source = src;
    this.startContextTime = ctx.currentTime;
    this.startOffsetSec = safeOffset;
    this.stopAtSec = duration !== undefined ? safeOffset + duration : this.audioBuffer.duration;
    this.isPlayingState = true;

    if (duration !== undefined) {
      src.start(0, safeOffset, duration);
    } else {
      src.start(0, safeOffset);
    }
  }

  stop(triggerCallback = false) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
    }
    if (this.source) {
      const src = this.source;
      this.source = null;
      src.onended = null;
      try {
        src.stop();
        src.disconnect();
      } catch {
        // already stopped
      }
    }
    this.isPlayingState = false;
    if (triggerCallback) {
      this.onEndedCallback?.();
    }
  }

  getIsPlaying(): boolean {
    return this.isPlayingState;
  }

  getCurrentTimeSec(): number {
    if (!this.isPlayingState || !this.ctx) {
      return this.startOffsetSec;
    }
    const elapsed = this.ctx.currentTime - this.startContextTime;
    const pos = this.startOffsetSec + elapsed;
    if (this.stopAtSec !== null && pos >= this.stopAtSec) {
      return this.stopAtSec;
    }
    return pos;
  }

  getLiveTimeDomain(target: Float32Array): boolean {
    if (!this.analyser || !this.isPlayingState) return false;
    this.analyser.getFloatTimeDomainData(target as Float32Array<ArrayBuffer>);
    return true;
  }

  dispose() {
    this.stop(false);
    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch {
        // ignore
      }
      this.workletNode = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
