import { createDialupWorkletProcessorCode } from './dialupDsp';
import type { ReferenceGraphWorkletModel } from './generator/referenceGraphWorklet';
import { createReferenceGraphWorkletProcessorCode } from './generator/referenceGraphWorklet';

export interface DecodedTrackData {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
}

type PlaybackMode = 'pcm' | 'referenceGraph';

export class DialupAudioPlayer {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  private pcmWorkletNode: AudioWorkletNode | null = null;
  private pcmWorkletReady = false;
  private pcmWorkletInitPromise: Promise<boolean> | null = null;

  private referenceGraphWorkletNode: AudioWorkletNode | null = null;
  private referenceGraphWorkletReady = false;
  private referenceGraphWorkletInitPromise: Promise<boolean> | null = null;

  private source: AudioBufferSourceNode | null = null;
  private audioBuffer: AudioBuffer | null = null;

  private isPlayingState = false;
  private playbackMode: PlaybackMode = 'pcm';
  private startContextTime = 0;
  private startOffsetSec = 0;
  private workletTimeSec = 0;
  private stopAtSec: number | null = null;
  private volume = 0.85;
  private onEndedCallback: (() => void) | null = null;

  private pendingSamples: Float32Array | null = null;
  private pendingSampleRate = 44100;
  private pendingReferenceGraphModel: ReferenceGraphWorkletModel | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      try {
        this.ctx = new AudioCtx({ sampleRate: 44100 });
      } catch {
        this.ctx = new AudioCtx();
      }
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

  private attachWorkletMessages(node: AudioWorkletNode) {
    node.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'position' && typeof msg.timeSec === 'number') {
        this.workletTimeSec = msg.timeSec;
        return;
      }

      if (msg.type === 'ended') {
        this.isPlayingState = false;
        if (typeof msg.timeSec === 'number') {
          this.workletTimeSec = msg.timeSec;
        }
        this.onEndedCallback?.();
      }
    };
  }

  private async registerWorklet(code: string): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;

    const blob = new Blob([code], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(blobUrl);
      return true;
    } catch {
      return false;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  private async ensurePcmWorklet(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (this.pcmWorkletReady && this.pcmWorkletNode) return true;
    if (this.pcmWorkletInitPromise) return this.pcmWorkletInitPromise;

    this.pcmWorkletInitPromise = (async () => {
      const registered = await this.registerWorklet(createDialupWorkletProcessorCode());
      if (!registered) return false;

      try {
        const node = new AudioWorkletNode(ctx, 'dialup-v90-worklet', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        this.attachWorkletMessages(node);
        if (this.gainNode) node.connect(this.gainNode);

        if (this.pendingSamples) {
          node.port.postMessage({
            type: 'load',
            samples: this.pendingSamples,
            sampleRate: this.pendingSampleRate,
          });
        }

        this.pcmWorkletNode = node;
        this.pcmWorkletReady = true;
        return true;
      } catch {
        return false;
      }
    })();

    return this.pcmWorkletInitPromise;
  }

  private async ensureReferenceGraphWorklet(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (Math.abs(ctx.sampleRate - 44100) > 1) return false;
    if (this.referenceGraphWorkletReady && this.referenceGraphWorkletNode) return true;
    if (this.referenceGraphWorkletInitPromise) {
      return this.referenceGraphWorkletInitPromise;
    }

    this.referenceGraphWorkletInitPromise = (async () => {
      const registered = await this.registerWorklet(
        createReferenceGraphWorkletProcessorCode()
      );
      if (!registered) return false;

      try {
        const node = new AudioWorkletNode(ctx, 'reference-graph-worklet', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        this.attachWorkletMessages(node);
        if (this.gainNode) node.connect(this.gainNode);

        if (this.pendingReferenceGraphModel) {
          node.port.postMessage({
            type: 'load-reference-model',
            model: this.pendingReferenceGraphModel,
          });
        }

        this.referenceGraphWorkletNode = node;
        this.referenceGraphWorkletReady = true;
        return true;
      } catch {
        return false;
      }
    })();

    return this.referenceGraphWorkletInitPromise;
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
      for (let i = 0; i < len; i++) mono[i] = 0.5 * (ch0[i] + ch1[i]);
    } else {
      mono.set(ch0);
    }

    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak > 0.001) {
      const scale = 0.90 / peak;
      for (let i = 0; i < len; i++) mono[i] *= scale;
    }

    return {
      samples: mono,
      sampleRate: decoded.sampleRate,
      durationSec: decoded.duration,
    };
  }

  loadSamples(samples: Float32Array, sampleRate: number) {
    this.stop(false);
    this.playbackMode = 'pcm';
    this.pendingReferenceGraphModel = null;
    this.pendingSamples = samples;
    this.pendingSampleRate = sampleRate;

    if (this.ctx) {
      const buf = this.ctx.createBuffer(1, samples.length, sampleRate);
      buf.copyToChannel(new Float32Array(samples), 0);
      this.audioBuffer = buf;
    } else {
      this.audioBuffer = null;
    }

    if (this.pcmWorkletNode) {
      this.pcmWorkletNode.port.postMessage({
        type: 'load',
        samples,
        sampleRate,
      });
    }
  }

  loadReferenceGraphModel(
    model: ReferenceGraphWorkletModel,
    previewSamples: Float32Array
  ) {
    this.stop(false);
    this.playbackMode = 'referenceGraph';
    this.pendingReferenceGraphModel = model;
    this.pendingSamples = previewSamples;
    this.pendingSampleRate = model.plan.sampleRate;

    if (this.ctx) {
      const buf = this.ctx.createBuffer(1, previewSamples.length, model.plan.sampleRate);
      buf.copyToChannel(new Float32Array(previewSamples), 0);
      this.audioBuffer = buf;
    } else {
      this.audioBuffer = null;
    }

    if (this.referenceGraphWorkletNode) {
      this.referenceGraphWorkletNode.port.postMessage({
        type: 'load-reference-model',
        model,
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

    const totalDur =
      this.playbackMode === 'referenceGraph' && this.pendingReferenceGraphModel
        ? this.pendingReferenceGraphModel.plan.durationSec
        : this.pendingSamples
          ? this.pendingSamples.length / this.pendingSampleRate
          : (this.audioBuffer?.duration ?? 0);

    const safeOffset = Math.max(
      0,
      Math.min(offsetSec, Math.max(0, totalDur - 0.01))
    );
    const targetEnd = endSec !== null ? Math.min(endSec, totalDur) : totalDur;

    this.startContextTime = ctx.currentTime;
    this.startOffsetSec = safeOffset;
    this.workletTimeSec = safeOffset;
    this.stopAtSec = targetEnd;
    this.isPlayingState = true;

    if (ctx.state === 'suspended') await ctx.resume();

    if (this.playbackMode === 'referenceGraph' && this.pendingReferenceGraphModel) {
      const hasReferenceGraph = await this.ensureReferenceGraphWorklet();
      if (!this.isPlayingState) return;

      if (hasReferenceGraph && this.referenceGraphWorkletNode) {
        this.startContextTime = ctx.currentTime;
        this.referenceGraphWorkletNode.port.postMessage({
          type: 'play',
          offsetSec: safeOffset,
          endSec: targetEnd,
        });
        return;
      }
    } else {
      const hasPcm = await this.ensurePcmWorklet();
      if (!this.isPlayingState) return;

      if (hasPcm && this.pcmWorkletNode && this.pendingSamples) {
        this.startContextTime = ctx.currentTime;
        this.pcmWorkletNode.port.postMessage({
          type: 'play',
          offsetSec: safeOffset,
          endSec: targetEnd,
        });
        return;
      }
    }

    if (!this.audioBuffer && this.pendingSamples) {
      const buf = ctx.createBuffer(1, this.pendingSamples.length, this.pendingSampleRate);
      buf.copyToChannel(new Float32Array(this.pendingSamples), 0);
      this.audioBuffer = buf;
    }
    if (!this.audioBuffer || !this.gainNode) {
      this.isPlayingState = false;
      return;
    }

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
    this.stopAtSec =
      duration !== undefined ? safeOffset + duration : this.audioBuffer.duration;
    this.isPlayingState = true;

    if (duration !== undefined) src.start(0, safeOffset, duration);
    else src.start(0, safeOffset);
  }

  stop(triggerCallback = false) {
    this.pcmWorkletNode?.port.postMessage({ type: 'stop' });
    this.referenceGraphWorkletNode?.port.postMessage({ type: 'stop' });

    if (this.source) {
      const src = this.source;
      this.source = null;
      src.onended = null;
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Already stopped.
      }
    }

    this.isPlayingState = false;
    if (triggerCallback) this.onEndedCallback?.();
  }

  getIsPlaying(): boolean {
    return this.isPlayingState;
  }

  getCurrentTimeSec(): number {
    if (!this.isPlayingState || !this.ctx) return this.startOffsetSec;

    if (
      this.playbackMode === 'referenceGraph' &&
      this.referenceGraphWorkletReady &&
      this.referenceGraphWorkletNode
    ) {
      return this.workletTimeSec;
    }

    const elapsed = this.ctx.currentTime - this.startContextTime;
    const pos = this.startOffsetSec + elapsed;
    if (this.stopAtSec !== null && pos >= this.stopAtSec) return this.stopAtSec;
    return pos;
  }

  getLiveTimeDomain(target: Float32Array): boolean {
    if (!this.analyser || !this.isPlayingState) return false;
    this.analyser.getFloatTimeDomainData(target as Float32Array<ArrayBuffer>);
    return true;
  }

  dispose() {
    this.stop(false);

    for (const node of [this.pcmWorkletNode, this.referenceGraphWorkletNode]) {
      if (!node) continue;
      try {
        node.disconnect();
      } catch {
        // Ignore already disconnected nodes.
      }
    }

    this.pcmWorkletNode = null;
    this.referenceGraphWorkletNode = null;

    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
