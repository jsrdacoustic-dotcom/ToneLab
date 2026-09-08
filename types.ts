export enum ChannelMode {
  LEFT = 'left',
  RIGHT = 'right',
  MONO = 'mono'
}

export enum WaveformType {
  SINE = 'sine',
  SQUARE = 'square',
  SAWTOOTH = 'sawtooth',
  TRIANGLE = 'triangle',
  WHITE_NOISE = 'white_noise',
  PINK_NOISE = 'pink_noise',
  M_NOISE = 'm_noise',
  EIA_426_B = 'eia_426_b',
  IEC_60268 = 'iec_60268',
  CTA_2034 = 'cta_2034'
}

export interface AudioState {
  isPlaying: boolean;
  frequency: number;
  volume: number;
  channel: ChannelMode;
  waveform: WaveformType;
}

export interface AIInsight {
  title: string;
  description: string;
}