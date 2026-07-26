import { getAudioContext } from './context';
import { MUSIC_GAIN, MUSIC_PIECE_S, MUSIC_REST_S, MUSIC_TEMPO } from '../data/balance';

/**
 * The city's music.
 *
 * Synthesised like everything else that makes a sound here — there are no audio
 * files in this game and there is not going to be. What that costs is a real
 * instrument; what it buys is a soundtrack that never repeats, weighs nothing,
 * and can follow the century the city is living through.
 *
 * The model is the quiet kind of game music: a soft keyboard tone, a long tail
 * on it, a pad far underneath, notes chosen from a pentatonic scale so nothing
 * can land wrong, and — the part that matters most — a great deal of silence.
 * Music that plays continuously stops being heard within ten minutes and starts
 * being resented within twenty. So a piece runs for a couple of minutes and then
 * the city is quiet for a couple more, and coming back is the effect.
 *
 * The scale moves with the era. A 1910 city gets a minor pentatonic and a 2060
 * one gets a bright suspended mode, which is a decade of character for the cost
 * of five numbers in a table.
 */
export interface MusicScene {
  /** Calendar year, which chooses the mode. */
  year: number;
  /** 0..1 from the day cycle; the night is played lower and slower. */
  night: number;
}

export interface MusicHandle {
  /** Re-aims the music at the city as it now is. Cheap; call freely. */
  setScene(scene: MusicScene): void;
  /** Call once per frame with real seconds; schedules what is about to play. */
  tick(deltaSeconds: number): void;
  /** Silences and tears down the graph; the mute switch calls this. */
  stop(): void;
  readonly running: boolean;
  dispose(): void;
}

/** Modes by era, as semitone offsets from the root. All five-note. */
interface Mode {
  from: number;
  /** Semitones above the root; five notes, so no interval can be wrong. */
  steps: readonly number[];
  /** MIDI note of the root. Lower for the old city, brighter for the new. */
  root: number;
  /** Semitones of the pad chord under it. */
  chord: readonly number[];
}

const MODES: readonly Mode[] = [
  // Minor pentatonic: the oldest and saddest thing you can play on five notes.
  { from: 0, steps: [0, 3, 5, 7, 10], root: 57, chord: [0, 7, 15] },
  // Major pentatonic from mid-century: the city is going somewhere.
  { from: 1950, steps: [0, 2, 4, 7, 9], root: 60, chord: [0, 7, 16] },
  // Suspended and open, which is what the future has always sounded like.
  { from: 2020, steps: [0, 2, 5, 7, 9], root: 60, chord: [0, 7, 14] },
];

function modeFor(year: number): Mode {
  let chosen = MODES[0] as Mode;
  for (const mode of MODES) if (year >= mode.from) chosen = mode;
  return chosen;
}

/** How far ahead of the audio clock notes are scheduled. */
const LOOKAHEAD_S = 0.6;

export function createMusic(): MusicHandle {
  let graph: Graph | null = null;
  let scene: MusicScene = { year: 1900, night: 0 };
  /** Audio-clock time the next note is due. */
  let nextNote = 0;
  /** Audio-clock time the piece in progress ends, or the rest ends. */
  let until = 0;
  let resting = true;
  /** Where the melody's walk currently stands, as an index into the scale. */
  let degree = 0;
  let bar = 0;

  const setScene = (next: MusicScene): void => {
    scene = next;
  };

  const tick = (): void => {
    const context = getAudioContext();
    if (!context || context.state !== 'running') return;
    if (!graph) {
      graph = buildGraph(context);
      // Opens on a rest rather than a downbeat: music that starts the instant
      // the page loads reads as a jingle, not as a place.
      until = context.currentTime + 4 + Math.random() * 10;
    }

    const now = context.currentTime;
    if (resting) {
      if (now < until) return;
      resting = false;
      const mode = modeFor(scene.year);
      degree = Math.floor(Math.random() * mode.steps.length);
      bar = 0;
      nextNote = now + 0.2;
      until = now + MUSIC_PIECE_S * (0.7 + Math.random() * 0.6);
      return;
    }

    if (now > until && nextNote > until) {
      resting = true;
      until = now + MUSIC_REST_S * (0.6 + Math.random() * 0.8);
      return;
    }

    // Schedule everything due inside the lookahead window, then leave. The
    // frame loop's own jitter never reaches the notes this way: they are placed
    // on the audio clock, which does not stutter when a mesh rebuilds.
    while (nextNote < now + LOOKAHEAD_S) {
      nextNote = playStep(context, graph, nextNote);
    }
  };

  /** Places one beat's worth of music and returns when the next one is due. */
  const playStep = (context: AudioContext, g: Graph, at: number): number => {
    const mode = modeFor(scene.year);
    // The night is played slower and lower, which is most of what makes a night
    // sound like one.
    const beat = 60 / (MUSIC_TEMPO * (1 - scene.night * 0.18));

    // A chord every four bars, held under whatever the melody does over it.
    if (bar % 16 === 0) {
      const shift = CHORD_WALK[(bar / 16) % CHORD_WALK.length] as number;
      pad(context, g, mode, shift, at, beat * 16);
    }
    bar++;

    // Roughly a third of beats are rests. This is the single most important
    // number in the file: notes on every beat is a tune, and a tune loops in
    // the ear whether or not it loops in the code.
    if (Math.random() < 0.34) return at + beat;

    // A random walk rather than a sequence, kept inside two octaves. Small
    // steps most of the time and the occasional leap, which is what stops it
    // sounding like a scale exercise.
    const leap = Math.random() < 0.16;
    degree += leap ? (Math.random() < 0.5 ? -3 : 3) : Math.random() < 0.5 ? -1 : 1;
    degree = Math.max(-4, Math.min(9, degree));

    const velocity = (0.55 + Math.random() * 0.45) * (1 - scene.night * 0.25);
    note(context, g, midiOf(mode, degree) - scene.night * 12, at, velocity, beat * 3.4);
    // Now and then a second note a scale-third above, which is the whole of the
    // harmony and is worth more than any amount of extra melody.
    if (Math.random() < 0.22) {
      note(context, g, midiOf(mode, degree + 2), at + 0.02, velocity * 0.6, beat * 3);
    }
    return at + beat;
  };

  const stop = (): void => {
    graph?.dispose();
    graph = null;
    resting = true;
    until = 0;
  };

  return {
    setScene,
    tick,
    stop,
    get running() {
      return graph !== null;
    },
    dispose: stop,
  };
}

/** Where the pad walks over sixteen bars. Four chords, and back. */
const CHORD_WALK: readonly number[] = [0, 5, -3, 3];

interface Graph {
  dry: GainNode;
  wet: GainNode;
  dispose(): void;
}

function buildGraph(context: AudioContext): Graph {
  const master = context.createGain();
  master.gain.value = MUSIC_GAIN;
  master.connect(context.destination);

  const dry = context.createGain();
  dry.gain.value = 0.55;
  dry.connect(master);

  // The tail is what makes this sound like a place rather than a synthesiser.
  // The impulse is generated here — decaying noise, which is what a room is —
  // because a convolution file would be the one asset in the game.
  const reverb = context.createConvolver();
  reverb.buffer = roomImpulse(context, 3.2);
  const wet = context.createGain();
  wet.gain.value = 0.85;
  wet.connect(reverb).connect(master);

  return {
    dry,
    wet,
    dispose: () => {
      try {
        master.disconnect();
        dry.disconnect();
        wet.disconnect();
        reverb.disconnect();
      } catch {
        // Already torn down; nothing to do.
      }
    },
  };
}

/**
 * One keyboard note.
 *
 * A triangle for the body and a quiet sine an octave up for the strike, through
 * a low-pass that closes as the note decays. That closing filter is what an ear
 * hears as "a struck string" rather than "an oscillator with a volume envelope":
 * real notes lose their top end long before they lose their volume.
 */
function note(
  context: AudioContext,
  g: Graph,
  midi: number,
  at: number,
  velocity: number,
  duration: number,
): void {
  const frequency = 440 * Math.pow(2, (midi - 69) / 12);
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(frequency * 6 + 800, at);
  filter.frequency.exponentialRampToValueAtTime(frequency * 1.6 + 120, at + duration);

  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(velocity, at + 0.014);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  filter.connect(gain);
  gain.connect(g.dry);
  gain.connect(g.wet);

  for (const [type, ratio, level] of VOICES) {
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency * ratio;
    // A couple of cents off, so two notes struck together beat slightly
    // against each other instead of phasing into one thin tone.
    osc.detune.value = (Math.random() - 0.5) * 6;
    const voice = context.createGain();
    voice.gain.value = level;
    osc.connect(voice).connect(filter);
    osc.start(at);
    osc.stop(at + duration + 0.1);
  }
}

const VOICES: readonly [OscillatorType, number, number][] = [
  ['triangle', 1, 0.5],
  ['sine', 2, 0.12],
  ['sine', 3.01, 0.05],
];

/** The chord underneath: three sines, very quiet, in and out over the bar. */
function pad(
  context: AudioContext,
  g: Graph,
  mode: Mode,
  shift: number,
  at: number,
  duration: number,
): void {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.09, at + duration * 0.3);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  gain.connect(g.dry);
  gain.connect(g.wet);

  for (const interval of mode.chord) {
    const midi = mode.root - 12 + shift + interval;
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    osc.detune.value = (Math.random() - 0.5) * 8;
    const voice = context.createGain();
    voice.gain.value = 0.33;
    osc.connect(voice).connect(gain);
    osc.start(at);
    osc.stop(at + duration + 0.2);
  }
}

/** MIDI note for a scale degree, wrapping into octaves above and below. */
function midiOf(mode: Mode, degree: number): number {
  const size = mode.steps.length;
  const octave = Math.floor(degree / size);
  const within = degree - octave * size;
  return mode.root + octave * 12 + (mode.steps[within] as number);
}

/**
 * A room, as decaying noise. Stereo, with the two channels generated
 * separately so the tail is wide rather than a mono blob in the middle.
 */
function roomImpulse(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2.6);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buffer;
}
