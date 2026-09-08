import { ChannelMode, WaveformType } from '../types';

class AudioService {
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  
  // Filters for M-Noise
  private highPassFilter: BiquadFilterNode | null = null;
  private lowPassFilter: BiquadFilterNode | null = null;

  // Cached Noise Buffers
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;

  // Custom Noise Settings
  private noiseCf: number = 12; 
  private noiseHpf: number = 20;
  private noiseLpf: number = 20000;

  public setNoiseSettings(cf: number, hpf: number, lpf: number) {
      if (this.noiseCf !== cf) {
          this.noiseCf = cf;
          this.whiteNoiseBuffer = null; // Invalidate buffers
          this.pinkNoiseBuffer = null;
          // If we are currently playing noise, we might need to restart it
          // But that's managed by App.tsx (it will call start again if needed)
      }

      this.noiseHpf = hpf;
      this.noiseLpf = lpf;

      if (this.audioContext && this.highPassFilter) {
          this.highPassFilter.frequency.setTargetAtTime(hpf, this.audioContext.currentTime, 0.05);
      }
      if (this.audioContext && this.lowPassFilter) {
          this.lowPassFilter.frequency.setTargetAtTime(lpf, this.audioContext.currentTime, 0.05);
      }
  }

  private generateGaussian(): number {
      let rand = 0;
      for (let i = 0; i < 6; i++) {
          rand += Math.random();
      }
      return (rand - 3) / 3;
  }

  private applyCrestFactor(data: Float32Array) {
      if (this.noiseCf <= 0) return;
      
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
          sumSq += data[i] * data[i];
      }
      const rms = Math.sqrt(sumSq / data.length);
      
      const targetCfLinear = Math.pow(10, this.noiseCf / 20);
      const targetPeak = rms * targetCfLinear;
      
      let maxPeak = 0;
      for (let i = 0; i < data.length; i++) {
          if (data[i] > targetPeak) data[i] = targetPeak;
          else if (data[i] < -targetPeak) data[i] = -targetPeak;
          
          const abs = Math.abs(data[i]);
          if (abs > maxPeak) maxPeak = abs;
      }
      
      if (maxPeak > 0) {
          for (let i = 0; i < data.length; i++) {
              data[i] /= maxPeak;
          }
      }
  }

  public init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
    }
  }

  private createWhiteNoise(ctx: AudioContext): AudioBuffer {
      const bufferSize = ctx.sampleRate * 5; // 5 seconds loop
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
          data[i] = this.generateGaussian();
      }
      this.applyCrestFactor(data);
      return buffer;
  }

  private createPinkNoise(ctx: AudioContext): AudioBuffer {
      const bufferSize = ctx.sampleRate * 5;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let b0, b1, b2, b3, b4, b5, b6;
      b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;
      for (let i = 0; i < bufferSize; i++) {
          const white = this.generateGaussian();
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
          data[i] *= 0.11; // Rough auto-gain compensation
          b6 = white * 0.115926;
      }
      this.applyCrestFactor(data);
      return buffer;
  }

  private getNoiseBuffer(type: WaveformType): AudioBuffer | null {
      if (!this.audioContext) return null;
      
      if (type === WaveformType.WHITE_NOISE) {
          if (!this.whiteNoiseBuffer) this.whiteNoiseBuffer = this.createWhiteNoise(this.audioContext);
          return this.whiteNoiseBuffer;
      }
      
      if (type === WaveformType.PINK_NOISE || type === WaveformType.M_NOISE || type === WaveformType.EIA_426_B || type === WaveformType.IEC_60268 || type === WaveformType.CTA_2034) {
          if (!this.pinkNoiseBuffer) this.pinkNoiseBuffer = this.createPinkNoise(this.audioContext);
          return this.pinkNoiseBuffer;
      }

      return null;
  }

  public start(frequency: number, volume: number, channel: ChannelMode, waveform: WaveformType) {
    this.init();
    if (!this.audioContext) return;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    this.stop(); // Clean up previous nodes

    // Create infrastructure
    this.gainNode = this.audioContext.createGain();
    this.stereoPanner = this.audioContext.createStereoPanner();
    
    // Configure Gain & Pan
    this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
    this.setChannel(channel);

    // --- Signal Generation Logic ---
    const isNoise = [
        WaveformType.WHITE_NOISE, 
        WaveformType.PINK_NOISE, 
        WaveformType.M_NOISE,
        WaveformType.EIA_426_B,
        WaveformType.IEC_60268,
        WaveformType.CTA_2034
    ].includes(waveform);

    if (isNoise) {
        // Noise Path
        this.bufferSource = this.audioContext.createBufferSource();
        const buffer = this.getNoiseBuffer(waveform);
        if (buffer) {
            this.bufferSource.buffer = buffer;
            this.bufferSource.loop = true;
        }

        let outputNode: AudioNode = this.bufferSource;

        // Apply HPF and LPF to all noise types to match new requirements
        this.highPassFilter = this.audioContext.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = this.noiseHpf; 

        this.lowPassFilter = this.audioContext.createBiquadFilter();
        this.lowPassFilter.type = 'lowpass';
        this.lowPassFilter.frequency.value = this.noiseLpf; 
        
        this.bufferSource.connect(this.highPassFilter);
        this.highPassFilter.connect(this.lowPassFilter);
        outputNode = this.lowPassFilter;

        outputNode.connect(this.gainNode);
    } else {
        // Oscillator Path
        this.oscillator = this.audioContext.createOscillator();
        this.oscillator.type = waveform as OscillatorType;
        this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        this.oscillator.connect(this.gainNode);
        this.oscillator.start();
    }
    
    // --- Output Routing ---
    // Source -> [Filter?] -> Gain -> Panner -> Analyser -> Dest
    
    if (this.bufferSource && isNoise) {
        this.bufferSource.start();
    }

    this.gainNode.connect(this.stereoPanner);
    this.stereoPanner.connect(this.analyser!);
    this.analyser!.connect(this.audioContext.destination);
  }

  public rampFrequency(targetFreq: number, duration: number) {
    if (this.audioContext && this.oscillator) {
      const now = this.audioContext.currentTime;
      this.oscillator.frequency.cancelScheduledValues(now);
      this.oscillator.frequency.setTargetAtTime(targetFreq, now, 0.015);
    }
  }

  public stop() {
    const now = this.audioContext?.currentTime || 0;
    
    if (this.oscillator) {
      try {
        this.oscillator.stop(now);
        this.oscillator.disconnect();
      } catch (e) {}
      this.oscillator = null;
    }
    
    if (this.bufferSource) {
      try {
        this.bufferSource.stop(now);
        this.bufferSource.disconnect();
      } catch(e) {}
      this.bufferSource = null;
    }

    // Disconnect filters if they exist
    if (this.highPassFilter) { this.highPassFilter.disconnect(); this.highPassFilter = null; }
    if (this.lowPassFilter) { this.lowPassFilter.disconnect(); this.lowPassFilter = null; }
  }

  public setFrequency(frequency: number) {
    // Only applies to oscillators
    if (this.audioContext && this.oscillator) {
      try {
          const now = this.audioContext.currentTime;
          // Smooth transition to avoid zipper noise and clicking, with a fast time constant
          this.oscillator.frequency.setTargetAtTime(frequency, now, 0.015);
      } catch(e) {}
    }
  }

  public setVolume(volume: number) {
    if (this.audioContext && this.gainNode) {
      this.gainNode.gain.setTargetAtTime(volume, this.audioContext.currentTime, 0.05);
    }
  }

  public setChannel(channel: ChannelMode) {
    if (this.audioContext && this.stereoPanner) {
      let panValue = 0;
      switch (channel) {
        case ChannelMode.LEFT: panValue = -1; break;
        case ChannelMode.RIGHT: panValue = 1; break;
        case ChannelMode.MONO: panValue = 0; break;
      }
      this.stereoPanner.pan.setValueAtTime(panValue, this.audioContext.currentTime);
    }
  }

  public setWaveform(waveform: WaveformType) {
    // Changing waveform on the fly usually requires restarting logic if switching between Noise <-> Osc
    // For simplicity, App.tsx should likely trigger a restart or we handle "soft" switching here.
    // However, Oscillator type can be switched on the fly. BufferSource cannot.
    // If we are currently an oscillator and switching to another oscillator:
    if (this.oscillator && !this.bufferSource) {
        if ([WaveformType.SINE, WaveformType.SQUARE, WaveformType.TRIANGLE, WaveformType.SAWTOOTH].includes(waveform)) {
             if (this.oscillator.type !== waveform) {
                 this.oscillator.type = waveform as OscillatorType;
             }
             return;
        }
    }
    // If switching domains (Osc <-> Noise), the caller (App.tsx) usually handles restart/state change.
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }
  
  public sweep(currentFreq: number, targetFreq: number, duration: number) {
      if(this.audioContext && this.oscillator) {
           const now = this.audioContext.currentTime;
           this.oscillator.frequency.cancelScheduledValues(now);
           this.oscillator.frequency.setValueAtTime(currentFreq, now);
           this.oscillator.frequency.exponentialRampToValueAtTime(targetFreq, now + duration);
      }
  }
}

export const audioService = new AudioService();