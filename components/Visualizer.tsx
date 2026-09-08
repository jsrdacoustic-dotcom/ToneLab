import React, { useEffect, useRef, useState } from 'react';
import { audioService } from '../services/audioService';

interface VisualizerProps {
  isPlaying: boolean;
}

const OCTAVE_BANDS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 
  1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
];

const Visualizer: React.FC<VisualizerProps> = ({ isPlaying }) => {
  const timeCanvasRef = useRef<HTMLCanvasElement>(null);
  const freqCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  
  const [spectrumMode, setSpectrumMode] = useState<'fft' | 'rta'>('rta');
  const spectrumModeRef = useRef(spectrumMode);

  useEffect(() => {
    spectrumModeRef.current = spectrumMode;
  }, [spectrumMode]);

  useEffect(() => {
    const timeCanvas = timeCanvasRef.current;
    const freqCanvas = freqCanvasRef.current;
    if (!timeCanvas || !freqCanvas) return;

    const timeCtx = timeCanvas.getContext('2d');
    const freqCtx = freqCanvas.getContext('2d');
    if (!timeCtx || !freqCtx) return;

    const render = () => {
      const analyser = audioService.getAnalyser();
      
      // Set canvas size to match display size for sharpness only if it changed
      const timeWidth = timeCanvas.clientWidth * 2;
      const timeHeight = timeCanvas.clientHeight * 2;
      if (timeCanvas.width !== timeWidth || timeCanvas.height !== timeHeight) {
          timeCanvas.width = timeWidth;
          timeCanvas.height = timeHeight;
      }
      
      const freqWidth = freqCanvas.clientWidth * 2;
      const freqHeight = freqCanvas.clientHeight * 2;
      if (freqCanvas.width !== freqWidth || freqCanvas.height !== freqHeight) {
          freqCanvas.width = freqWidth;
          freqCanvas.height = freqHeight;
      }
      
      timeCtx.clearRect(0, 0, timeWidth, timeHeight);
      freqCtx.clearRect(0, 0, freqWidth, freqHeight);

      if (!isPlaying || !analyser) {
        // Draw flat line for oscilloscope
        timeCtx.lineWidth = 4;
        timeCtx.strokeStyle = '#06b6d4'; // Cyan
        timeCtx.beginPath();
        timeCtx.moveTo(0, timeHeight / 2);
        timeCtx.lineTo(timeWidth, timeHeight / 2);
        timeCtx.stroke();
        
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const sampleRate = analyser.context.sampleRate || 48000;

      // ===========================
      // 1. Time Domain (Oscilloscope)
      // ===========================
      const timeData = new Uint8Array(bufferLength);
      analyser.getByteTimeDomainData(timeData);
      
      timeCtx.lineWidth = 4;
      timeCtx.strokeStyle = '#06b6d4';
      timeCtx.beginPath();
      
      const sliceWidth = timeWidth * 1.0 / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = timeData[i] / 128.0;
        const y = v * timeHeight / 2;
        if (i === 0) {
          timeCtx.moveTo(x, y);
        } else {
          timeCtx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      timeCtx.lineTo(timeWidth, timeHeight / 2);
      timeCtx.stroke();

      // Add a glow effect
      timeCtx.shadowBlur = 15;
      timeCtx.shadowColor = '#06b6d4';
      timeCtx.stroke();
      timeCtx.shadowBlur = 0;

      // ===========================
      // 2. Frequency Domain
      // ===========================
      const minFreq = 20;
      const maxFreq = 20000;
      
      if (spectrumModeRef.current === 'fft') {
          // --- FFT (Narrowband, Log Scale X) ---
          const freqData = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(freqData);
          
          const minLog = Math.log10(minFreq);
          const maxLog = Math.log10(maxFreq);
          const logRange = maxLog - minLog;
          
          for (let i = 1; i < bufferLength; i++) {
            const freq = i * (sampleRate / 2) / bufferLength;
            if (freq < minFreq) continue;
            if (freq > maxFreq) break;
            
            const nextFreq = (i + 1) * (sampleRate / 2) / bufferLength;
            
            const xPos = freqWidth * (Math.log10(freq) - minLog) / logRange;
            const nextXPos = freqWidth * (Math.log10(nextFreq) - minLog) / logRange;
            let barW = nextXPos - xPos;
            barW = Math.max(1, barW + 0.5); // slight overlap
            
            const barHeight = (freqData[i] / 255) * freqHeight;
            
            const normalizedPos = xPos / freqWidth;
            const r = barHeight + (25 * normalizedPos);
            const g = 250 * normalizedPos;
            const b = 250;
            
            freqCtx.fillStyle = `rgb(${r},${g},${b})`;
            freqCtx.shadowBlur = 5;
            freqCtx.shadowColor = `rgb(${r},${g},${b})`;
            freqCtx.fillRect(xPos, freqHeight - barHeight, barW, barHeight);
          }
      } else {
          // --- RTA (1/3 Octave, Constant Percentage Bandwidth) ---
          const floatData = new Float32Array(bufferLength);
          analyser.getFloatFrequencyData(floatData);
          
          const minDb = analyser.minDecibels;
          const maxDb = analyser.maxDecibels;
          const rangeDb = maxDb - minDb;
          
          const barWidth = freqWidth / OCTAVE_BANDS.length;
          
          OCTAVE_BANDS.forEach((fc, index) => {
              // 1/3 octave boundaries
              const flow = fc / Math.pow(2, 1/6);
              const fhigh = fc * Math.pow(2, 1/6);
              
              const binLow = Math.floor(flow * bufferLength / (sampleRate / 2));
              const binHigh = Math.ceil(fhigh * bufferLength / (sampleRate / 2));
              
              let sumLinearPower = 0;
              for (let i = Math.max(0, binLow); i <= Math.min(bufferLength - 1, binHigh); i++) {
                  const db = floatData[i];
                  if (db > -1000) {
                      sumLinearPower += Math.pow(10, db / 10);
                  }
              }
              
              let bandDb = minDb;
              if (sumLinearPower > 0) {
                  bandDb = 10 * Math.log10(sumLinearPower);
              }
              
              let barHeight = ((bandDb - minDb) / rangeDb) * freqHeight;
              barHeight = Math.max(0, Math.min(freqHeight, barHeight));
              
              const xPos = index * barWidth;
              
              const normalizedPos = xPos / freqWidth;
              const r = barHeight + (25 * normalizedPos);
              const g = 250 * normalizedPos;
              const b = 250;
              
              freqCtx.fillStyle = `rgb(${r},${g},${b})`;
              freqCtx.shadowBlur = 5;
              freqCtx.shadowColor = `rgb(${r},${g},${b})`;
              freqCtx.fillRect(xPos, freqHeight - barHeight, barWidth - 1, barHeight);
          });
      }
      
      freqCtx.shadowBlur = 0;
      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Time Domain (Oscilloscope) */}
      <div className="w-full h-16 bg-studio-800/50 rounded-xl border border-studio-700 overflow-hidden relative shadow-inner">
        <canvas ref={timeCanvasRef} className="w-full h-full block" />
        <div className="absolute top-1 right-2 text-[9px] text-studio-700 font-mono font-bold pointer-events-none">
          OSCILLOSCOPE
        </div>
      </div>

      {/* Frequency Domain (Spectrum Analyzer) */}
      <div className="w-full h-32 bg-studio-800/50 rounded-xl border border-studio-700 overflow-hidden relative shadow-inner group">
        <canvas ref={freqCanvasRef} className="w-full h-full block relative z-10" />
        <div className="absolute top-2 right-2 z-20 flex gap-2">
            <button
                onClick={() => setSpectrumMode(m => m === 'fft' ? 'rta' : 'fft')}
                className="text-[9px] bg-studio-900/80 hover:bg-studio-700 text-studio-accent font-mono px-2 py-1 rounded transition-colors border border-studio-700/50 opacity-50 group-hover:opacity-100"
            >
                {spectrumMode === 'fft' ? 'FFT (NARROWBAND)' : 'RTA (1/3 OCTAVE)'}
            </button>
        </div>
        
        {/* Logarithmic Grid Overlay */}
        <div className="absolute inset-0 z-0 pointer-events-none">
            {/* 100Hz = ~23.3% */}
            <div className="absolute top-0 bottom-0 border-l border-studio-700/30" style={{ left: '23.3%' }}>
                <span className="absolute bottom-0 text-[8px] text-studio-700 font-mono translate-x-1">100Hz</span>
            </div>
            {/* 1kHz = ~56.6% */}
            <div className="absolute top-0 bottom-0 border-l border-studio-700/30" style={{ left: '56.6%' }}>
                <span className="absolute bottom-0 text-[8px] text-studio-700 font-mono translate-x-1">1kHz</span>
            </div>
            {/* 10kHz = ~90% */}
            <div className="absolute top-0 bottom-0 border-l border-studio-700/30" style={{ left: '90%' }}>
                <span className="absolute bottom-0 text-[8px] text-studio-700 font-mono -translate-x-full pr-1">10kHz</span>
            </div>
            {/* 20Hz (Start) */}
            <div className="absolute bottom-0 left-1 text-[8px] text-studio-700 font-mono">20Hz</div>
            {/* 20kHz (End) */}
            <div className="absolute bottom-0 right-1 text-[8px] text-studio-700 font-mono">20kHz</div>
        </div>
      </div>
    </div>
  );
};

export default Visualizer;
