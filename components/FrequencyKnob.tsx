import React, { useState, useEffect, useRef, useCallback } from 'react';

interface FrequencyKnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
  size?: number;
}

const FrequencyKnob: React.FC<FrequencyKnobProps> = ({
  value,
  min,
  max,
  onChange,
  size = 200,
}) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Convert frequency (log scale) to angle (-135 to 135)
  const freqToAngle = useCallback((freq: number) => {
    const minLog = Math.log10(min);
    const maxLog = Math.log10(max);
    const valLog = Math.log10(Math.max(min, Math.min(max, freq)));
    const percent = (valLog - minLog) / (maxLog - minLog);
    return percent * 270 - 135; // -135 to +135
  }, [min, max]);

  // Convert angle (-135 to 135) to frequency (log scale)
  const angleToFreq = useCallback((angle: number) => {
    const clampedAngle = Math.max(-135, Math.min(135, angle));
    const percent = (clampedAngle + 135) / 270;
    const minLog = Math.log10(min);
    const maxLog = Math.log10(max);
    const valLog = minLog + percent * (maxLog - minLog);
    return Math.round(Math.pow(10, valLog));
  }, [min, max]);

  const [angle, setAngle] = useState(() => freqToAngle(value));

  useEffect(() => {
    if (!isDragging) {
      setAngle(freqToAngle(value));
    }
  }, [value, isDragging, freqToAngle]);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !knobRef.current) return;

    const rect = knobRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const x = e.clientX - centerX;
    const y = e.clientY - centerY;

    let rad = Math.atan2(y, x);
    let deg = rad * (180 / Math.PI) + 90;

    // Handle wrapping around the bottom
    if (deg > 180) deg -= 360;

    // Constrain between -135 and 135
    if (deg > 135) deg = 135;
    if (deg < -135) deg = -135;

    setAngle(deg);
    onChange(angleToFreq(deg));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div className="flex flex-col items-center justify-center relative select-none touch-none">
      <div 
        ref={knobRef}
        className="relative rounded-full rounded-full flex items-center justify-center cursor-pointer shadow-2xl ring-1 ring-white/10"
        style={{ width: size, height: size, background: 'conic-gradient(from 180deg at 50% 50%, #0f172a 0deg, #1e293b 360deg)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="absolute inset-2 rounded-full bg-studio-900 border border-studio-700/50 flex items-center justify-center shadow-inner">
            <div className="text-center">
               <div className="text-3xl font-bold font-mono text-white tracking-tighter" style={{ textShadow: '0 0 10px rgba(6, 182, 212, 0.5)' }}>
                  {value}
               </div>
               <div className="text-xs text-studio-700 font-bold uppercase tracking-widest mt-1">Hz</div>
            </div>
        </div>
        <div 
            className="absolute inset-0 pointer-events-none"
            style={{ transform: `rotate(${angle}deg)` }}
        >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-6 bg-studio-accent rounded-full shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
        </div>
      </div>
      
      {/* Min/Max Labels */}
      <div className="absolute -bottom-2 w-full flex justify-between px-2 pointer-events-none">
          <span className="text-[10px] font-mono text-studio-700 font-bold">{min}Hz</span>
          <span className="text-[10px] font-mono text-studio-700 font-bold">{max / 1000}kHz</span>
      </div>
    </div>
  );
};

export default FrequencyKnob;
