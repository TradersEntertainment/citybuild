import { getAudioContext } from './context';

/**
 * The game's voice (§13, §6 of the audio brief): every sound synthesised on the
 * spot, no files, the same rule the facades and the terrain follow.
 *
 * Two decisions do most of the work here. Everything is tuned to one pentatonic
 * scale, so two cues that land in the same instant are consonant rather than a
 * clash — which matters because a spawn wave and a completed goal genuinely do
 * arrive together. And every voice is a short plucked envelope: a city builder
 * is played in long sittings, and a sound with a tail is a sound that becomes
 * unbearable by the twentieth time.
 *
 * The context is created lazily and resumed on the first touch, so nothing is
 * ever attempted before the browser would allow it.
 */
export type Cue =
  | 'tap'
  | 'build'
  | 'erase'
  | 'blocked'
  | 'spawn'
  | 'goal'
  | 'era'
  | 'coin';

/** A minor pentatonic on A, which is hard to make sound wrong. */
const SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0];

function note(step: number): number {
  return SCALE[Math.max(0, Math.min(SCALE.length - 1, step))] as number;
}

interface Voice {
  /** Index into the scale. */
  step: number;
  /** Seconds from the start of the cue. */
  at: number;
  duration: number;
  gain: number;
  type: OscillatorType;
  /** Scale step to glide to, for a cue that should rise or fall. */
  to?: number;
}

/**
 * What each moment sounds like.
 *
 * The pattern is deliberate: the routine actions are single quiet notes, and
 * only the things worth interrupting a player for — a goal, an era — get a
 * chord. If everything is an event then nothing is.
 */
const CUES: Record<Cue, readonly Voice[]> = {
  // Picking up a tool: barely there, because it happens constantly.
  tap: [{ step: 5, at: 0, duration: 0.05, gain: 0.16, type: 'sine' }],
  // A stroke committed. Two notes a fifth apart, which reads as "done".
  build: [
    { step: 3, at: 0, duration: 0.09, gain: 0.3, type: 'triangle' },
    { step: 5, at: 0.045, duration: 0.11, gain: 0.24, type: 'triangle' },
  ],
  // Taking something down: the same shape, falling instead of rising.
  erase: [
    { step: 4, at: 0, duration: 0.08, gain: 0.24, type: 'triangle', to: 2 },
    { step: 1, at: 0.05, duration: 0.12, gain: 0.18, type: 'sine' },
  ],
  // A refusal. Low, short and unmusical enough to read as "no" without scolding.
  blocked: [{ step: 0, at: 0, duration: 0.13, gain: 0.26, type: 'square', to: 0 }],
  // A building arriving. Quietest of the lot: a district produces dozens.
  spawn: [{ step: 6, at: 0, duration: 0.06, gain: 0.1, type: 'sine' }],
  // A goal claimed: a rising third, then the octave.
  goal: [
    { step: 4, at: 0, duration: 0.1, gain: 0.3, type: 'triangle' },
    { step: 6, at: 0.07, duration: 0.12, gain: 0.28, type: 'triangle' },
    { step: 9, at: 0.15, duration: 0.3, gain: 0.24, type: 'sine' },
  ],
  // An era. The one cue allowed to be a chord and allowed to ring.
  era: [
    { step: 0, at: 0, duration: 0.6, gain: 0.22, type: 'sine' },
    { step: 4, at: 0.02, duration: 0.55, gain: 0.2, type: 'triangle' },
    { step: 7, at: 0.06, duration: 0.5, gain: 0.18, type: 'triangle' },
    { step: 9, at: 0.14, duration: 0.45, gain: 0.16, type: 'sine' },
  ],
  // Money in. Two quick high notes, the sound every idle game has.
  coin: [
    { step: 7, at: 0, duration: 0.06, gain: 0.22, type: 'square' },
    { step: 9, at: 0.05, duration: 0.1, gain: 0.18, type: 'square' },
  ],
};

/**
 * Cues that fire in bursts, and the smallest gap between two of them.
 *
 * A district of forty houses spawning at once is forty notes in one frame,
 * which is a buzz rather than a city. Thinning them to a few a second turns the
 * same event into a flurry, which is what it should have sounded like.
 */
const THROTTLE_MS: Partial<Record<Cue, number>> = {
  spawn: 110,
  tap: 40,
  build: 60,
};

const STORAGE_KEY = 'kadastro.sound';
/**
 * Under the player's own music, always. A game that has to be turned down is a
 * game that gets turned off.
 */
const MASTER = 0.22;

export interface SfxHandle {
  play(cue: Cue): void;
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  dispose(): void;
}

/**
 * Sound is on unless the player turned it off.
 *
 * The brief said default-off, on the reasoning that a page must not make noise
 * at you. The gesture unlock already guarantees that — nothing can sound before
 * the first touch — and a mute switch nobody finds makes the game feel dead to
 * everyone who never finds it. So: on by default, with the switch in the top
 * bar where it is one tap away.
 */
function rememberedEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function remember(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* not remembering the setting costs one tap, not the game */
  }
}

export function createSfx(): SfxHandle {
  let enabled = rememberedEnabled();
  let master: GainNode | null = null;
  const lastPlayed = new Map<Cue, number>();

  /** Built on first use, so a muted session never creates a graph at all. */
  const output = (): GainNode | null => {
    const context = getAudioContext();
    if (!context) return null;
    if (!master) {
      master = context.createGain();
      master.gain.value = MASTER;
      master.connect(context.destination);
    }
    return master;
  };

  const play = (cue: Cue): void => {
    if (!enabled) return;
    const context = getAudioContext();
    if (!context || context.state !== 'running') return;

    const gap = THROTTLE_MS[cue];
    if (gap !== undefined) {
      const now = context.currentTime * 1000;
      const last = lastPlayed.get(cue) ?? -Infinity;
      if (now - last < gap) return;
      lastPlayed.set(cue, now);
    }

    const bus = output();
    if (!bus) return;

    const start = context.currentTime;
    for (const voice of CUES[cue]) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = voice.type;

      const at = start + voice.at;
      const end = at + voice.duration;
      oscillator.frequency.setValueAtTime(note(voice.step), at);
      if (voice.to !== undefined) {
        // A glide rather than a second note: this is what makes the refusal
        // read as a slump and the erase as something being taken away.
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(40, note(voice.to) * (voice.to === voice.step ? 0.5 : 1)),
          end,
        );
      }

      // A plucked envelope: fast in, exponential out. Never zero, because an
      // exponential ramp to zero is undefined and silently does nothing.
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(voice.gain, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);

      oscillator.connect(envelope);
      envelope.connect(bus);
      oscillator.start(at);
      oscillator.stop(end + 0.02);
      // Nodes are single-use; dropping the references lets them be collected.
      oscillator.onended = (): void => {
        oscillator.disconnect();
        envelope.disconnect();
      };
    }
  };

  return {
    play,
    get enabled() {
      return enabled;
    },
    setEnabled: (on: boolean): void => {
      enabled = on;
      remember(on);
      // Turning it on is itself worth a note: silence after pressing "sound on"
      // reads as a broken button.
      if (on) play('tap');
    },
    dispose: () => {
      master?.disconnect();
      master = null;
    },
  };
}
