import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChannelMode, WaveformType, AIInsight } from './types';
import { audioService } from './services/audioService';
import Visualizer from './components/Visualizer';
import FrequencyKnob from './components/FrequencyKnob';
import { getFrequencyInsight } from './services/geminiService';

// Icons
const PlayIcon = () => <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>;
const StopIcon = () => <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>;
const SparklesIcon = () => <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>;
const ArrowRightIcon = () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>;
const LoopIcon = () => <svg className="w-4 h-4 mr-2 animate-spin-slow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
const WavesIcon = () => <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
const InfoIcon = () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

const getNoiseStandardInfo = (type: WaveformType) => {
    switch (type) {
        case WaveformType.CTA_2034:
            return { cf: 12, hpf: 100, lpf: 10000, origin: "Consumer Technology Association", base: "Pink Noise", desc: "CTA-2034 (Spinorama) Standard. Uses shaped band-limited pink noise for evaluating loudspeaker directivity and response." };
        case WaveformType.M_NOISE:
            return { cf: 18, hpf: 20, lpf: 20000, origin: "AES75 (Meyer Sound)", base: "Pink Noise", desc: "AES75 Standard recommends 18dB Crest Factor to accurately emulate the dynamic range of live music. (Approximated using Pink Noise)." };
        case WaveformType.EIA_426_B:
            return { cf: 6, hpf: 40, lpf: 10000, origin: "Electronic Industries Alliance", base: "Pink Noise", desc: "EIA-426-B Standard Program. Commonly uses a 6dB Crest Factor and shaped band-limiting for continuous loudspeaker power testing. (Note: True standard requires complex shaping networks, this uses basic filtering on pink noise)." };
        case WaveformType.IEC_60268:
            return { cf: 6, hpf: 20, lpf: 20000, origin: "International Electrotechnical Commission", base: "Pink Noise", desc: "IEC 60268-1 / 60268-5 Standard. Simulated program material often using a 6dB Crest Factor for equipment rating. (Note: True standard requires specific shaping networks, this uses basic filtering on pink noise)." };
        case WaveformType.PINK_NOISE:
            return { cf: 12, hpf: 20, lpf: 20000, origin: "Acoustics / Physics", base: "Pink Noise", desc: "Industry Standard (SMPTE/AES) recommends 12dB Crest Factor for cinema calibration and room EQ. Equal energy per octave (-3dB/octave on FFT, flat on RTA)." };
        case WaveformType.WHITE_NOISE:
        default:
            return { cf: 12, hpf: 20, lpf: 20000, origin: "Mathematics / Physics", base: "White Noise", desc: "Common Standard recommends 12dB Crest Factor for testing general electronic components. Equal energy per frequency (flat on FFT, +3dB/octave on RTA)." };
    }
};

function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [frequency, setFrequency] = useState(440);
  const [volume, setVolume] = useState(0.5);
  const [channel, setChannel] = useState<ChannelMode>(ChannelMode.MONO);
  const [waveform, setWaveform] = useState<WaveformType>(WaveformType.SINE);
  
  // Sweep State
  const [mode, setMode] = useState<'manual' | 'sweep'>('manual');
  const [controlType, setControlType] = useState<'slider' | 'knob'>('knob');
  const [sweepStart, setSweepStart] = useState(20);
  const [sweepEnd, setSweepEnd] = useState(20000);
  const [sweepDuration, setSweepDuration] = useState(1);
  
  // Display State
  const [displayFreq, setDisplayFreq] = useState(440);

  // Logic Refs
  const sweepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationFrameRef = useRef<number>(null);
  const startTimeRef = useRef<number>(0);
  const sweepDirectionRef = useRef<'up' | 'down'>('up');

  // AI State
  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);

  // Noise Settings State
  const [noiseHpf, setNoiseHpf] = useState(20);
  const [noiseLpf, setNoiseLpf] = useState(20000);
  const [noiseCf, setNoiseCf] = useState(12);

  // Derived state
  const isNoiseMode = [WaveformType.WHITE_NOISE, WaveformType.PINK_NOISE, WaveformType.M_NOISE, WaveformType.EIA_426_B, WaveformType.IEC_60268, WaveformType.CTA_2034].includes(waveform);

  // Automatically update CF and filters to standard when switching noise types
  useEffect(() => {
     if (isNoiseMode) {
         const info = getNoiseStandardInfo(waveform);
         setNoiseCf(info.cf);
         setNoiseHpf(info.hpf);
         setNoiseLpf(info.lpf);
     }
  }, [waveform, isNoiseMode]);

  // Apply HPF/LPF instantly
  useEffect(() => {
     audioService.setNoiseSettings(noiseCf, noiseHpf, noiseLpf);
  }, [noiseHpf, noiseLpf]);

  // Apply CF with debounce to avoid stuttering when dragging slider
  useEffect(() => {
     const t = setTimeout(() => {
         audioService.setNoiseSettings(noiseCf, noiseHpf, noiseLpf);
         if (isPlaying && isNoiseMode) {
             audioService.start(0, volume, channel, waveform);
         }
     }, 300);
     return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noiseCf]);

  // Sync Audio Parameters
  useEffect(() => {
    if (isPlaying) {
        audioService.setVolume(volume);
        audioService.setChannel(channel);

        if (!isNoiseMode) {
             audioService.setWaveform(waveform);
             if (mode === 'manual') {
                 audioService.setFrequency(frequency);
             }
        }
    }
  }, [frequency, volume, channel, waveform, isPlaying, mode, isNoiseMode]);

  // Restart audio when switching waveform types (Osc <-> Noise) or Mode
  useEffect(() => {
      if (isPlaying) {
          if (isNoiseMode) {
              // Always restart for noise to ensure buffer/filter setup
              audioService.start(0, volume, channel, waveform);
          } else if (mode === 'manual') {
              // Ensure oscillator is running with correct shape
              audioService.start(frequency, volume, channel, waveform);
          }
          // Note: Sweep mode handles its own start logic via effect below
      }
  }, [waveform, mode]); // Trigger on waveform/mode change only if playing

  // --- Sweep Logic ---
  const sweepStartRef = useRef(sweepStart);
  const sweepEndRef = useRef(sweepEnd);
  const sweepDurationRef = useRef(sweepDuration);

  // Sync refs and update running sweep dynamically
  useEffect(() => {
    sweepStartRef.current = sweepStart;
    sweepEndRef.current = sweepEnd;
    sweepDurationRef.current = sweepDuration;
    
    if (isPlaying && mode === 'sweep' && !isNoiseMode) {
        const targetFreq = sweepDirectionRef.current === 'up' ? sweepEnd : sweepStart;
        
        // We use displayFreq as a fallback state if we're mid-sweep
        audioService.sweep(displayFreq, targetFreq, sweepDuration);
        
        // Reset the loop timing to accommodate the new duration smoothly
        startTimeRef.current = performance.now();
        if (sweepTimeoutRef.current) clearTimeout(sweepTimeoutRef.current);
        sweepTimeoutRef.current = setTimeout(() => {
            runSweepLoop(sweepDirectionRef.current === 'up' ? 'down' : 'up');
        }, sweepDuration * 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepStart, sweepEnd, sweepDuration]); // Intentionally omitting others to prevent loop

  const runSweepLoop = useCallback((direction: 'up' | 'down') => {
    if (!isPlaying || mode !== 'sweep' || isNoiseMode) return;

    const start = direction === 'up' ? sweepStartRef.current : sweepEndRef.current;
    const end = direction === 'up' ? sweepEndRef.current : sweepStartRef.current;
    
    audioService.sweep(start, end, sweepDurationRef.current);

    startTimeRef.current = performance.now();
    sweepDirectionRef.current = direction;

    if (sweepTimeoutRef.current) clearTimeout(sweepTimeoutRef.current);
    
    sweepTimeoutRef.current = setTimeout(() => {
      runSweepLoop(direction === 'up' ? 'down' : 'up');
    }, sweepDurationRef.current * 1000);

  }, [isPlaying, mode, isNoiseMode]);

  // Effect to Trigger Sweep Start
  useEffect(() => {
    if (isPlaying && mode === 'sweep' && !isNoiseMode) {
      audioService.start(sweepDirectionRef.current === 'up' ? sweepStartRef.current : sweepEndRef.current, volume, channel, waveform);
      runSweepLoop(sweepDirectionRef.current);

      const animate = () => {
        const now = performance.now();
        const duration = sweepDurationRef.current;
        const elapsed = (now - startTimeRef.current) / 1000;
        
        if (elapsed <= duration) {
          const t = Math.min(1, elapsed / duration);
          const s = sweepDirectionRef.current === 'up' ? sweepStartRef.current : sweepEndRef.current;
          const e = sweepDirectionRef.current === 'up' ? sweepEndRef.current : sweepStartRef.current;
          
          try {
             const safeStart = Math.max(s, 1);
             const safeEnd = Math.max(e, 1);
             const current = safeStart * Math.pow(safeEnd / safeStart, t);
             setDisplayFreq(Math.round(current));
          } catch {
             setDisplayFreq(s);
          }
        }
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      animationFrameRef.current = requestAnimationFrame(animate);

    } else {
      if (sweepTimeoutRef.current) clearTimeout(sweepTimeoutRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      
      if (!isPlaying) {
        audioService.stop();
      }
    }

    return () => {
      if (sweepTimeoutRef.current) clearTimeout(sweepTimeoutRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, mode, isNoiseMode]); // Only re-run when core modes change!


  const togglePlay = () => {
    if (isPlaying) {
        audioService.stop();
        setIsPlaying(false);
    } else {
        // Initial Start
        if (isNoiseMode) {
             audioService.start(0, volume, channel, waveform);
        } else if (mode === 'sweep') {
             // Sweep effect will handle start
        } else {
             audioService.start(frequency, volume, channel, waveform);
        }
        setIsPlaying(true);
    }
  };

  const handleFrequencyChange = (val: number) => {
    setFrequency(val);
    if (!isPlaying) setDisplayFreq(val);
  };

  const handleFrequencyBlur = () => {
    let clamped = Math.min(Math.max(frequency, 20), 20000);
    if (isNaN(clamped) || clamped === 0) clamped = 440;
    setFrequency(clamped);
    if (!isPlaying) setDisplayFreq(clamped);
  };

  const handleOctaveChange = (multiplier: number) => {
    const newVal = Math.min(Math.max(Math.floor(frequency * multiplier), 20), 20000);
    handleFrequencyChange(newVal);
  };
  
  const handleThirdOctaveChange = (isUp: boolean) => {
    const factor = Math.pow(2, 1/3);
    const newFreq = isUp ? frequency * factor : frequency / factor;
    const newVal = Math.min(Math.max(Math.round(newFreq), 20), 20000);
    handleFrequencyChange(newVal);
  };

  const fetchInsight = useCallback(async () => {
    setLoadingInsight(true);
    setInsight(null);
    const targetFreq = mode === 'manual' ? frequency : displayFreq;
    const isNoise = isNoiseMode;
    
    // Custom prompt for noise vs freq
    // Not modifying geminiService for brevity, assuming it handles text. 
    // We will just pass a descriptive string to the existing function if possible, 
    // but the existing function expects a number.
    // For now, if noise, we'll ask about 1000Hz but rely on the prompt to be generic,
    // OR ideally we would update geminiService. 
    // Let's just use the current freq if noise is selected, usually noise analysis is complex.
    // Let's skip updating geminiService to keep changes minimal and just pass a placeholder.
    
    const result = await getFrequencyInsight(targetFreq);
    setInsight(result);
    setLoadingInsight(false);
  }, [frequency, mode, displayFreq, isNoiseMode]);

  return (
    <div className="min-h-screen bg-studio-900 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-lg bg-studio-800 rounded-3xl shadow-2xl overflow-hidden border border-studio-700 ring-1 ring-white/10">
        
        {/* Header */}
        <div className="p-6 pb-2 flex justify-between items-center border-b border-studio-700/50">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-studio-accent animate-pulse"></span>
            ToneLab<span className="text-studio-700 font-light">GEN</span>
          </h1>
          <div className="text-xs font-mono text-studio-700 bg-studio-900 px-2 py-1 rounded">
            v1.4.0
          </div>
        </div>

        {/* Visualizer Area */}
        <div className="p-6">
          <Visualizer isPlaying={isPlaying} />
        </div>

        {/* Main Display Area */}
        <div className="px-6 pb-6 text-center">
            {isNoiseMode ? (
                <div className="flex flex-col items-center justify-center h-[88px]">
                     <div className="text-studio-glow font-mono text-4xl font-bold flex items-center gap-3 tracking-tighter">
                        {waveform === WaveformType.WHITE_NOISE && "WHITE NOISE"}
                        {waveform === WaveformType.PINK_NOISE && "PINK NOISE"}
                        {waveform === WaveformType.M_NOISE && "M-NOISE"}
                     </div>
                     <div className="text-[10px] text-studio-accent font-bold uppercase tracking-widest mt-2 flex items-center bg-studio-900/50 px-3 py-1 rounded-full border border-studio-700/50">
                        <WavesIcon />
                        {waveform === WaveformType.M_NOISE ? "AES75 Approx (20Hz-20kHz)" : "Broadband Signal"}
                     </div>
                </div>
            ) : mode === 'manual' ? (
                <div className="relative inline-block h-[88px] flex items-center justify-center">
                    <input
                        type="number"
                        value={frequency || ''}
                        onChange={(e) => handleFrequencyChange(Number(e.target.value))}
                        onBlur={handleFrequencyBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleFrequencyBlur()}
                        className="text-5xl font-bold text-center bg-transparent text-studio-glow w-48 outline-none focus:text-white font-mono tracking-tighter appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        min="20"
                        max="20000"
                    />
                    <span className="text-studio-700 font-bold text-xl absolute right-2 bottom-4 pointer-events-none">Hz</span>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center h-[88px]">
                     <div className="text-studio-glow font-mono text-5xl font-bold flex items-center gap-3 tracking-tighter">
                        {Math.round(displayFreq)} <span className="text-xl text-studio-700">Hz</span>
                     </div>
                     <div className="text-[10px] text-studio-accent font-bold uppercase tracking-widest mt-2 flex items-center bg-studio-900/50 px-3 py-1 rounded-full border border-studio-700/50">
                        <LoopIcon />
                        Scanning {sweepStart}Hz <ArrowRightIcon className="mx-1" /> {sweepEnd}Hz
                     </div>
                </div>
            )}
          
          <div className="mt-2 flex justify-center">
            <button 
              onClick={fetchInsight}
              disabled={loadingInsight || isNoiseMode} // Disable AI for noise for now
              className="flex items-center text-xs font-medium text-studio-accent hover:text-studio-glow transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <SparklesIcon />
              {loadingInsight ? 'Analyzing...' : isNoiseMode ? 'AI Analysis (Tones Only)' : 'Ask AI about this signal'}
            </button>
          </div>

          {/* AI Insight Card */}
          {insight && (
            <div className="mt-4 bg-studio-900/50 rounded-lg p-3 text-left border border-studio-700 animate-in fade-in slide-in-from-top-2">
              <h3 className="text-studio-accent font-bold text-sm mb-1">{insight.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{insight.description}</p>
            </div>
          )}
        </div>

        {/* Mode Selector Tabs removed from here */}

        {/* Controls Container */}
        <div className="bg-studio-900/50 p-6 space-y-6 backdrop-blur-sm">
          
          {/* Main Controls - Conditionally Rendered based on Noise Mode */}
          {isNoiseMode ? (
              <div className="py-4 flex flex-col space-y-5">
                  <div className="flex justify-between items-center text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">
                      <span>Noise Filters & CF</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                          <label className="text-[10px] text-slate-500 font-bold uppercase">High Pass (Hz)</label>
                          <input 
                              type="number" 
                              min="1" 
                              max="20000" 
                              value={noiseHpf} 
                              onChange={e => setNoiseHpf(Number(e.target.value))} 
                              className="w-full bg-studio-900 border border-studio-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-studio-accent font-mono shadow-inner" 
                          />
                      </div>
                      <div className="space-y-2">
                          <label className="text-[10px] text-slate-500 font-bold uppercase">Low Pass (Hz)</label>
                          <input 
                              type="number" 
                              min="20" 
                              max="20000" 
                              value={noiseLpf} 
                              onChange={e => setNoiseLpf(Number(e.target.value))} 
                              className="w-full bg-studio-900 border border-studio-700 rounded px-2 py-2 text-white text-sm focus:outline-none focus:border-studio-accent font-mono shadow-inner" 
                          />
                      </div>
                  </div>
                  
                  <div className="space-y-2">
                      <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] text-slate-500 font-bold uppercase">Crest Factor (CF)</label>
                          <span className="text-[10px] bg-studio-900 px-2 py-0.5 rounded border border-studio-700 font-mono font-bold text-studio-glow">{noiseCf} dB</span>
                      </div>
                      <input 
                          type="range" 
                          min="3" 
                          max="18" 
                          step="1" 
                          value={noiseCf} 
                          onChange={e => setNoiseCf(Number(e.target.value))} 
                          className="w-full h-2 bg-studio-700 rounded-lg appearance-none cursor-pointer" 
                      />
                      <div className="flex justify-between text-[10px] text-studio-700 font-mono font-bold mt-1">
                          <span>3dB</span>
                          <span>12dB (Typ)</span>
                          <span>18dB</span>
                      </div>
                      
                      {/* Standard Explanation */}
                      {(() => {
                          const info = getNoiseStandardInfo(waveform);
                          const isStandard = noiseCf === info.cf && noiseHpf === info.hpf && noiseLpf === info.lpf;
                          return (
                              <div className="mt-4 bg-studio-800/50 p-2.5 rounded border border-studio-700/50 flex items-start gap-2 animate-in fade-in">
                                  <span className={`mt-0.5 shrink-0 ${isStandard ? 'text-studio-accent' : 'text-amber-500'}`}><InfoIcon /></span>
                                  <div className="flex-1">
                                      <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${isStandard ? 'text-slate-300' : 'text-amber-500'}`}>
                                          {isStandard ? `Standard: ${info.origin}` : "Custom Settings"}
                                      </div>
                                      <div className="text-[10px] text-slate-400 space-y-1 leading-relaxed">
                                          <p><strong className="text-slate-300">Base Signal:</strong> {info.base} + Filters</p>
                                          <p>{isStandard ? info.desc : `You are using custom filters/CF. The standard for this type is ${info.cf}dB with HPF @ ${info.hpf}Hz and LPF @ ${info.lpf}Hz.`}</p>
                                      </div>
                                  </div>
                              </div>
                          );
                      })()}
                  </div>
              </div>
          ) : mode === 'manual' ? (
              /* Manual Controls */
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs text-slate-400 font-medium uppercase tracking-wider mb-2">
                  <span>Frequency Control</span>
                  <div className="flex bg-studio-800 rounded p-0.5 border border-studio-700/50">
                    <button 
                       onClick={() => setControlType('knob')}
                       className={`px-2 py-1 rounded text-[10px] transition-colors ${controlType === 'knob' ? 'bg-studio-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      KNOB
                    </button>
                    <button 
                       onClick={() => setControlType('slider')}
                       className={`px-2 py-1 rounded text-[10px] transition-colors ${controlType === 'slider' ? 'bg-studio-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                      SLIDER
                    </button>
                  </div>
                </div>
                
                {controlType === 'slider' ? (
                    <>
                        <input
                        type="range"
                        min="20"
                        max="20000" 
                        step="1"
                        value={frequency}
                        onChange={(e) => handleFrequencyChange(Number(e.target.value))}
                        className="w-full h-2 bg-studio-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-studio-700 font-mono">
                        <span>20Hz</span>
                        <span>10kHz</span>
                        <span>20kHz</span>
                        </div>
                    </>
                ) : (
                    <div className="py-4">
                        <FrequencyKnob 
                            value={frequency} 
                            min={20} 
                            max={20000} 
                            onChange={handleFrequencyChange}
                            size={160} 
                        />
                    </div>
                )}
                
                <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="flex gap-1">
                        <button onClick={() => handleOctaveChange(0.5)} className="flex-1 py-2 bg-studio-800 rounded text-[10px] font-mono hover:bg-studio-700 text-slate-400 hover:text-white transition-colors border border-studio-700/50">/2 OCT</button>
                        <button onClick={() => handleOctaveChange(2)} className="flex-1 py-2 bg-studio-800 rounded text-[10px] font-mono hover:bg-studio-700 text-slate-400 hover:text-white transition-colors border border-studio-700/50">x2 OCT</button>
                    </div>
                    <div className="flex gap-1">
                        <button onClick={() => handleThirdOctaveChange(false)} className="flex-1 py-2 bg-studio-800 rounded text-[10px] font-mono hover:bg-studio-700 text-slate-400 hover:text-white transition-colors border border-studio-700/50">-1/3 OCT</button>
                        <button onClick={() => handleThirdOctaveChange(true)} className="flex-1 py-2 bg-studio-800 rounded text-[10px] font-mono hover:bg-studio-700 text-slate-400 hover:text-white transition-colors border border-studio-700/50">+1/3 OCT</button>
                    </div>
                </div>
              </div>
          ) : (
              /* Sweep Controls */
              <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                          <label className="text-xs text-slate-400 font-medium uppercase">Start Freq</label>
                          <div className="flex items-center bg-studio-800 rounded-lg px-3 py-2 border border-studio-700">
                             <input 
                                type="number" 
                                value={sweepStart} 
                                onChange={(e) => setSweepStart(Number(e.target.value))}
                                className="bg-transparent w-full outline-none text-white font-mono text-sm"
                             />
                             <span className="text-xs text-slate-500 ml-1">Hz</span>
                          </div>
                      </div>
                      <div className="space-y-1">
                          <label className="text-xs text-slate-400 font-medium uppercase">End Freq</label>
                           <div className="flex items-center bg-studio-800 rounded-lg px-3 py-2 border border-studio-700">
                             <input 
                                type="number" 
                                value={sweepEnd} 
                                onChange={(e) => setSweepEnd(Number(e.target.value))}
                                className="bg-transparent w-full outline-none text-white font-mono text-sm"
                             />
                             <span className="text-xs text-slate-500 ml-1">Hz</span>
                          </div>
                      </div>
                  </div>
                  <div className="space-y-2">
                       <div className="flex justify-between text-xs text-slate-400 font-medium uppercase tracking-wider">
                          <span>Loop Duration</span>
                          <span>{sweepDuration}s</span>
                        </div>
                        <input
                            type="range"
                            min="0.1"
                            max="10"
                            step="0.1"
                            value={sweepDuration}
                            onChange={(e) => setSweepDuration(Number(e.target.value))}
                            className="w-full h-2 bg-studio-700 rounded-lg appearance-none cursor-pointer"
                        />
                         <div className="flex justify-between text-[10px] text-studio-700 font-mono">
                            <span>0.1s</span>
                            <span>10s</span>
                         </div>
                  </div>
              </div>
          )}

          <div className="h-px bg-studio-700/50 w-full"></div>

          {/* Common Controls (Volume & Channel & Waveform) */}
          <div className="grid grid-cols-2 gap-4">
               {/* Volume Control */}
              <div className="space-y-2">
                 <div className="flex justify-between text-xs text-slate-400 font-medium uppercase tracking-wider">
                  <span>Volume</span>
                  <span>{Math.round(volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="w-full h-2 bg-studio-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>

               {/* Waveform Selector - Expanded */}
               <div className="space-y-2">
                 <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                    Source Type
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {/* Oscillators */}
                    <div className="col-span-2 grid grid-cols-4 gap-1">
                         {[WaveformType.SINE, WaveformType.SQUARE, WaveformType.TRIANGLE, WaveformType.SAWTOOTH].map((type) => (
                            <button
                            key={type}
                            onClick={() => setWaveform(type)}
                            className={`
                                py-1 text-[9px] font-bold rounded transition-all duration-200 border
                                ${waveform === type 
                                ? 'bg-studio-accent/20 border-studio-accent text-studio-accent' 
                                : 'bg-studio-800 border-transparent text-slate-500 hover:bg-studio-700'}
                                uppercase truncate
                            `}
                            >
                            {type}
                            </button>
                        ))}
                    </div>
                    {/* Noise */}
                    <div className="col-span-2 grid grid-cols-2 gap-1 mt-1">
                        {[WaveformType.PINK_NOISE, WaveformType.WHITE_NOISE, WaveformType.M_NOISE, WaveformType.EIA_426_B, WaveformType.IEC_60268, WaveformType.CTA_2034].map((type) => (
                            <button
                            key={type}
                            onClick={() => setWaveform(type)}
                            className={`
                                py-1 text-[9px] font-bold rounded transition-all duration-200 border
                                ${waveform === type 
                                ? 'bg-rose-500/20 border-rose-500 text-rose-500' 
                                : 'bg-studio-800 border-transparent text-slate-500 hover:bg-studio-700'}
                                uppercase truncate
                            `}
                            title={type === WaveformType.M_NOISE ? "Approximation of AES75 M-Noise" : type}
                            >
                            {type === WaveformType.CTA_2034 ? 'CTA-2034' : type === WaveformType.EIA_426_B ? 'EIA-426-B' : type === WaveformType.IEC_60268 ? 'IEC 60268' : type === WaveformType.M_NOISE ? 'M-NOISE' : type.split('_')[0]}
                            </button>
                        ))}
                    </div>
                </div>
               </div>
          </div>

          {/* Channel Selector */}
          <div className="space-y-2">
             <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
              Output Channel
            </div>
            <div className="grid grid-cols-3 gap-2 bg-studio-800 p-1 rounded-lg">
              {[ChannelMode.LEFT, ChannelMode.MONO, ChannelMode.RIGHT].map((m) => (
                <button
                  key={m}
                  onClick={() => setChannel(m)}
                  className={`
                    py-2 text-xs font-bold rounded-md transition-all duration-200
                    ${channel === m 
                      ? 'bg-studio-700 text-white shadow-md ring-1 ring-white/10' 
                      : 'text-slate-500 hover:text-slate-300 hover:bg-studio-700/50'}
                    uppercase
                  `}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Play Button */}
          <button
            onClick={togglePlay}
            className={`
              w-full py-4 rounded-xl font-bold text-lg tracking-wide shadow-lg transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-2
              ${isPlaying 
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20' 
                : 'bg-studio-accent hover:bg-cyan-400 text-studio-900 shadow-cyan-500/20'}
            `}
          >
            {isPlaying ? (
              <>
                <StopIcon /> STOP
              </>
            ) : (
              <>
                <PlayIcon /> GENERATE
              </>
            )}
          </button>
          
          {/* Mode Selector Tabs (Moved to Bottom) */}
          <div className={`mt-4 pt-4 border-t border-studio-700/50 transition-all duration-300`}>
              <div className="bg-studio-900 p-1 rounded-xl flex gap-1">
                  <button 
                      onClick={() => { setMode('manual'); setIsPlaying(false); }}
                      className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${mode === 'manual' ? 'bg-studio-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                      Manual Mode
                  </button>
                  <button 
                      onClick={() => { setMode('sweep'); setIsPlaying(false); }}
                      className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${mode === 'sweep' ? 'bg-studio-700 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                  >
                      Sweep Mode
                  </button>
              </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default App;