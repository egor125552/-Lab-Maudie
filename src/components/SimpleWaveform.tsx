import React, { useEffect, useRef } from 'react';
import { HandshakePhase } from '../audio/dialupDsp';

interface SimpleWaveformProps {
  samples: Float32Array;
  durationSec: number;
  phases: HandshakePhase[];
  activePhase: HandshakePhase | null;
  playheadSec: number;
  isPlaying: boolean;
  onSeek: (sec: number) => void;
}

export const SimpleWaveform: React.FC<SimpleWaveformProps> = ({
  samples,
  durationSec,
  phases,
  activePhase,
  playheadSec,
  isPlaying,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(280, Math.floor(rect.width));
    const h = Math.max(120, Math.floor(rect.height));

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, w, h);

    const midY = h / 2;

    // Highlight currently active phase region
    if (activePhase) {
      const x0 = (activePhase.startSec / durationSec) * w;
      const x1 = (activePhase.endSec / durationSec) * w;
      ctx.fillStyle = isPlaying
        ? 'rgba(52, 211, 153, 0.06)'
        : 'rgba(245, 158, 11, 0.05)';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }

    // Center baseline
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Subtle phase boundaries
    for (const p of phases) {
      if (p.startSec <= 0.01) continue;
      const x = (p.startSec / durationSec) * w;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, h - 8);
      ctx.stroke();
    }

    const playX = Math.max(0, Math.min(w, (playheadSec / durationSec) * w));

    // Clean 28-second sound bars
    const barWidth = 3;
    const gap = 2;
    const step = barWidth + gap;
    const numBars = Math.floor(w / step);
    const samplesPerBar = Math.max(1, Math.floor(samples.length / numBars));

    for (let b = 0; b < numBars; b++) {
      const start = b * samplesPerBar;
      let peak = 0;
      for (let i = 0; i < samplesPerBar; i += 8) {
        const v = Math.abs(samples[start + i] ?? 0);
        if (v > peak) peak = v;
      }
      const barH = Math.max(4, peak * (h * 0.80));
      const x = b * step;
      const y = midY - barH / 2;

      if (x <= playX && (isPlaying || playheadSec > 0.01)) {
        ctx.fillStyle = isPlaying ? '#34D399' : '#F59E0B';
      } else {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.34)';
      }
      ctx.fillRect(x, y, barWidth, barH);
    }

    // Playhead cursor
    ctx.strokeStyle = isPlaying ? '#34D399' : '#F59E0B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.stroke();

    ctx.restore();
  }, [samples, durationSec, phases, activePhase, playheadSec, isPlaying]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(rx * durationSec);
  };

  return (
    <div className="p-4 bg-[#0B0F17]">
      <canvas
        ref={canvasRef}
        data-testid="waveform-canvas"
        onClick={handleClick}
        title="Нажмите в любом месте дорожки, чтобы перемотать"
        className="w-full h-[148px] sm:h-[168px] block cursor-pointer rounded"
      />
    </div>
  );
};
