import type { WeaponId } from '../../shared/constants';
import type { SfxName } from '../view';
import type { Voice } from './synth';

/** Recipes return their true end through Voice.end, including delayed echoes and fanfares. */
export function sound(voice: Voice, name: SfxName, weapon: WeaponId = 'pistol'): void {
  const v = voice;
  if (name === 'shot') {
    switch (weapon) {
      case 'pistol':
        v.noise(0, 0.085, 0.48, 5200, 'highpass', 1600);
        v.tone(0, 230, 0.12, 0.35, 'triangle', 65);
        v.tone(0, 1900, 0.025, 0.16, 'square', 420);
        return;
      case 'smg':
        v.noise(0, 0.045, 0.24, 3400, 'bandpass', 1200);
        v.tone(0, 170, 0.055, 0.17, 'triangle', 60);
        v.noise(0.018, 0.025, 0.10, 6200, 'highpass');
        return;
      case 'shotgun':
        v.noise(0, 0.35, 0.68, 6000, 'lowpass', 180, true);
        v.noise(0, 0.12, 0.42, 3600, 'highpass');
        v.tone(0, 135, 0.32, 0.62, 'sine', 32);
        v.noise(0.11, 0.16, 0.12, 1700, 'bandpass');
        return;
      case 'ar':
        v.noise(0, 0.10, 0.40, 7400, 'highpass', 1400);
        v.tone(0, 190, 0.095, 0.29, 'triangle', 50);
        v.tone(0.008, 2400, 0.025, 0.12, 'square', 750);
        return;
      case 'sniper':
        v.noise(0, 0.13, 0.70, 6200, 'highpass', 900);
        v.tone(0, 180, 0.48, 0.70, 'sine', 28);
        v.noise(0.05, 1.25, 0.48, 1700, 'lowpass', 130, true);
        v.noise(0.24, 0.7, 0.15, 1200, 'bandpass', 300);
        return;
      case 'rocket':
        v.tone(0, 100, 0.23, 0.44, 'triangle', 28);
        v.noise(0, 0.72, 0.65, 450, 'bandpass', 3600, true, 0.065);
        v.noise(0.03, 0.34, 0.27, 2200, 'highpass', 850);
        return;
      case 'laser':
        v.tone(0, 380, 0.085, 0.20, 'sine', 2100, 0.03);
        v.tone(0.045, 2900, 0.28, 0.28, 'sawtooth', 180);
        v.tone(0.065, 3400, 0.42, 0.20, 'sine', 320);
        v.noise(0.055, 0.055, 0.16, 8000, 'highpass');
        return;
      case 'minigun':
        v.tone(0, 105, 0.065, 0.14, 'sawtooth', 65);
        v.tone(0, 55, 0.055, 0.12, 'sine', 40);
        v.noise(0, 0.04, 0.20, 2400, 'bandpass', 1300);
        return;
    }
  }
  switch (name) {
    case 'hit':
      v.noise(0, 0.10, 0.38, 700, 'lowpass', 150, true);
      v.tone(0, 135, 0.09, 0.25, 'triangle', 48);
      break;
    case 'hitArmor':
      v.tone(0, 1700, 0.22, 0.22, 'sine', 1450);
      v.tone(0, 2741, 0.13, 0.11, 'sine');
      v.noise(0, 0.025, 0.25, 6000, 'highpass');
      break;
    case 'hitmarker':
      v.tone(0, 2100, 0.038, 0.28, 'triangle', 1700);
      v.noise(0, 0.02, 0.08, 8000, 'highpass');
      break;
    case 'kill':
      v.noise(0, 0.035, 0.20, 6500, 'highpass');
      v.tone(0, 1318.5, 0.22, 0.23, 'triangle');
      v.tone(0.09, 1975.5, 0.42, 0.26, 'sine');
      v.tone(0.09, 2637, 0.30, 0.11, 'sine');
      v.tone(0.16, 3951, 0.22, 0.07, 'sine');
      break;
    case 'death':
      v.tone(0, 260, 0.65, 0.27, 'sawtooth', 35);
      v.noise(0, 0.40, 0.26, 900, 'lowpass', 100, true);
      v.tone(0.08, 78, 0.55, 0.32, 'sine', 25);
      break;
    case 'explosion':
      explosion(v, 0, 1);
      break;
    case 'impact':
      v.noise(0, 0.065, 0.26, 2900, 'bandpass', 900);
      v.tone(0, 480, 0.045, 0.13, 'triangle', 120);
      break;
    case 'pickup':
      v.tone(0, 1046.5, 0.07, 0.18, 'sine');
      v.tone(0.045, 1568, 0.19, 0.18, 'sine');
      break;
    case 'pickupRare':
      for (let i = 0; i < 6; i++) {
        v.tone(i * 0.065, [659, 831, 988, 1319, 1661, 1976][i], 0.34, 0.14, 'sine');
      }
      v.noise(0.1, 0.58, 0.08, 7600, 'highpass', 10000, false, 0.08);
      break;
    case 'reload':
      v.noise(0, 0.045, 0.26, 2100, 'bandpass');
      v.tone(0, 340, 0.035, 0.15, 'square', 180);
      v.noise(0.22, 0.065, 0.22, 3500, 'bandpass');
      v.noise(0.39, 0.08, 0.28, 1700, 'highpass');
      v.tone(0.39, 540, 0.065, 0.15, 'triangle', 160);
      break;
    case 'empty':
      v.noise(0, 0.025, 0.19, 1600, 'bandpass');
      v.tone(0, 220, 0.035, 0.15, 'square', 140);
      break;
    case 'dash':
      v.noise(0, 0.27, 0.37, 3400, 'bandpass', 180, false, 0.018);
      v.tone(0, 280, 0.18, 0.18, 'triangle', 45);
      break;
    case 'ability':
      v.tone(0, 220, 0.48, 0.19, 'sawtooth', 1320, 0.06);
      v.tone(0.05, 330, 0.48, 0.17, 'sine', 1980, 0.05);
      v.noise(0.05, 0.48, 0.19, 350, 'bandpass', 6500, false, 0.12);
      v.tone(0.40, 1760, 0.3, 0.15, 'sine');
      break;
    case 'heal':
      v.tone(0, 523.25, 0.7, 0.15, 'sine', 523.25, 0.02);
      v.tone(0.14, 659.25, 0.7, 0.13, 'sine', 659.25, 0.02);
      v.tone(0.28, 783.99, 0.7, 0.11, 'sine', 783.99, 0.02);
      break;
    case 'chest':
      v.noise(0, 0.065, 0.28, 1800, 'bandpass');
      v.tone(0, 170, 0.10, 0.20, 'triangle', 65);
      for (let i = 0; i < 5; i++) v.tone(0.13 + i * 0.06, 660 * 2 ** (i / 3), 0.45, 0.14);
      v.noise(0.14, 0.55, 0.08, 6400, 'highpass', 10000, false, 0.06);
      break;
    case 'rug':
      v.tone(0, 440, 0.29, 0.25, 'sawtooth', 250, 0.02);
      v.tone(0.29, 330, 0.53, 0.29, 'sawtooth', 70, 0.02);
      v.tone(0.31, 337, 0.50, 0.11, 'sawtooth', 73, 0.02);
      explosion(v, 0.62, 0.85);
      break;
    case 'airdrop':
      v.noise(0, 2.25, 0.24, 320, 'bandpass', 150, true, 0.3);
      v.tone(0, 74, 2.2, 0.15, 'sawtooth', 51, 0.28, 0.8);
      v.tone(0, 77, 2.2, 0.10, 'sawtooth', 54, 0.28, 0.8);
      v.tone(0.25, 740, 0.17, 0.18, 'sine', 980);
      v.tone(0.65, 980, 0.17, 0.15, 'sine', 740);
      break;
    case 'zoneWarn':
      for (let i = 0; i < 3; i++) {
        v.tone(i * 0.42, 440, 0.30, 0.20, 'square', 570, 0.018, 0.08);
        v.tone(i * 0.42, 660, 0.30, 0.09, 'sawtooth', 855, 0.018, 0.08);
      }
      break;
    case 'land':
      v.tone(0, 110, 0.25, 0.42, 'sine', 32);
      v.noise(0, 0.18, 0.25, 800, 'lowpass', 180, true);
      break;
    case 'emote':
      v.tone(0, 420, 0.095, 0.24, 'sine', 1050);
      v.tone(0.035, 1300, 0.095, 0.10, 'sine', 750);
      break;
    case 'click':
      v.tone(0, 1250, 0.035, 0.13, 'triangle', 740);
      break;
    case 'hover':
      v.tone(0, 1800, 0.026, 0.065, 'sine', 2200);
      break;
    case 'countdown':
      v.tone(0, 660, 0.16, 0.22, 'square', 660, 0.004, 0.06);
      break;
    case 'go':
      for (const frequency of [523.25, 659.25, 783.99, 1046.5]) {
        v.tone(0, frequency, 0.60, 0.12, 'triangle', frequency, 0.008);
      }
      v.noise(0, 0.12, 0.12, 5500, 'highpass');
      break;
    case 'victory': {
      const melody = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      for (let i = 0; i < melody.length; i++) {
        const offset = i < 4 ? i * 0.18 : 0.82 + (i - 4) * 0.28;
        v.tone(offset, melody[i], i === 5 ? 1.10 : 0.32, 0.18, 'triangle');
        v.tone(offset, melody[i] / 2, 0.32, 0.07, 'sawtooth');
      }
      for (const frequency of [261.63, 329.63, 392]) v.tone(1.10, frequency, 1.1, 0.09, 'triangle');
      v.noise(1.1, 0.8, 0.12, 6500, 'highpass');
      break;
    }
    case 'defeat':
      for (let i = 0; i < 4; i++) {
        const frequency = [392, 349.23, 311.13, 196][i];
        v.tone(i * 0.28, frequency, 0.72, 0.18, 'triangle', frequency * 0.985, 0.018);
        v.tone(i * 0.28, frequency / 2, 0.7, 0.06, 'sine');
      }
      break;
    case 'notify':
      v.tone(0, 880, 0.18, 0.14, 'sine');
      v.tone(0.12, 1174.66, 0.25, 0.14, 'sine');
      break;
    case 'whoosh':
      v.noise(0, 0.42, 0.32, 450, 'bandpass', 6500, false, 0.10);
      break;
  }
}

function explosion(v: Voice, offset: number, volume: number): void {
  v.noise(offset, 0.78, 0.72 * volume, 5200, 'lowpass', 110, true);
  v.noise(offset, 0.18, 0.44 * volume, 3700, 'highpass', 1100);
  v.tone(offset, 115, 0.73, 0.68 * volume, 'sine', 24);
  for (let i = 0; i < 6; i++) {
    v.noise(offset + 0.10 + i * 0.09, 0.04 + i * 0.009, 0.12 * volume, 900 + i * 630, 'bandpass');
  }
}
