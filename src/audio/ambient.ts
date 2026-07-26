import { getAudioContext } from './context';

/**
 * The city's room tone (Paket 1 §4).
 *
 * Synthesised, like everything else that makes a sound here — no files. A bed
 * of filtered noise for the traffic hum, a slow pad underneath it, and sparse
 * one-shots on top: birds in the morning, crickets at night.
 *
 * The reason to have it at all is that silence reads as a paused game. The
 * reason to be careful with it is that a loop the player hears for an hour is
 * the fastest way to make them turn the sound off, which also costs you every
 * other cue. So: no melody, nothing that repeats on a period an ear can catch,
 * and quiet enough to sit under the effects rather than beside them.
 *
 * It answers to the same switch as the effects. A player who mutes the game
 * means the game, not the button they happened to press.
 */

/** Overall level. Well under the effects bus, which is itself under the music. */
const BED_GAIN = 0.055;
/** How fast the bed follows a change in the city; slow, so nothing pops. */
const RAMP_S = 1.6;

export interface AmbientScene {
  /** People in the city; drives how much hum there is. */
  population: number;
  /** 0..1 from the day cycle. */
  night: number;
  /** Camera distance, so street level sounds closer than the map view. */
  cameraDistance: number;
}

export interface AmbientHandle {
  /** Re-aims the bed at the city as it now is. Cheap; call freely. */
  setScene(scene: AmbientScene): void;
  /** Silences and tears down the graph; the mute switch calls this. */
  stop(): void;
  readonly running: boolean;
  dispose(): void;
}

export function createAmbient(): AmbientHandle {
  let graph: Graph | null = null;
  let latest: AmbientScene = { population: 0, night: 0, cameraDistance: 60 };
  let birdTimer = 0;

  const setScene = (scene: AmbientScene): void => {
    latest = scene;
    const context = getAudioContext();
    if (!context || context.state !== 'running') return;
    if (!graph) graph = buildGraph(context);

    const now = context.currentTime;
    // A hamlet is quiet and a metropolis is not, but the curve has to be a log:
    // ten times the people is not ten times the noise, and a linear map would
    // put the whole audible range inside the first thousand residents.
    //
    // Floored at zero before the log. The sim can hand over a briefly negative
    // population — a wartime draft drains faster than the census catches up —
    // and log10 of a negative is NaN, which does not make the bed quiet: it
    // poisons the gain node and the audio stays broken for the session.
    const people = Math.max(0, scene.population);
    const size = Math.min(1, Math.log10(1 + people) / 4.6);
    // Standing in the street hears the street; the map view hears a city from
    // a hill. Both are the same bed at different levels and cutoffs.
    const closeness = clamp01((160 - scene.cameraDistance) / 120);

    const hum = BED_GAIN * size * (0.45 + closeness * 0.55) * (1 - scene.night * 0.55);
    ramp(graph.humGain.gain, hum, now);
    // Traffic is a bright noise; heard from far away the top end is gone, which
    // is most of why distance sounds like distance.
    ramp(graph.humFilter.frequency, 320 + closeness * 900 + size * 400, now);

    // The pad is the opposite: it carries the night, when the traffic does not.
    const pad = BED_GAIN * (0.3 + scene.night * 0.7) * (0.35 + size * 0.65);
    ramp(graph.padGain.gain, pad, now);

    // Wind off the water and over open ground, always there, loudest when the
    // city is smallest — an empty map should not be silent.
    ramp(graph.windGain.gain, BED_GAIN * (0.5 - size * 0.3), now);
  };

  /**
   * One-shots. Called from the frame loop with real seconds, so the interval is
   * wall-clock rather than tied to how fast the city is being simulated.
   */
  const tick = (deltaSeconds: number): void => {
    const context = getAudioContext();
    if (!context || context.state !== 'running' || !graph) return;
    birdTimer -= deltaSeconds;
    if (birdTimer > 0) return;
    // Irregular by construction: a call on a fixed period is a metronome, and an
    // ear finds a metronome within about three repeats.
    birdTimer = 2.5 + Math.random() * 7;
    if (latest.night > 0.6) chirp(context, graph.bus, 'cricket');
    else if (latest.night < 0.25) chirp(context, graph.bus, 'bird');
  };

  const stop = (): void => {
    graph?.dispose();
    graph = null;
  };

  return {
    setScene: (scene) => {
      setScene(scene);
      // Piggybacks on the scene update rather than owning a timer of its own;
      // the caller already calls this on a throttle.
      tick(1);
    },
    stop,
    get running() {
      return graph !== null;
    },
    dispose: stop,
  };
}

interface Graph {
  bus: GainNode;
  humGain: GainNode;
  humFilter: BiquadFilterNode;
  padGain: GainNode;
  windGain: GainNode;
  dispose(): void;
}

/**
 * The bed: two noise sources and an oscillator pad.
 *
 * Noise is a looping buffer rather than a ScriptProcessor — the buffer is
 * generated once at start-up and costs nothing thereafter, and the alternative
 * runs JavaScript on the audio thread.
 */
function buildGraph(context: AudioContext): Graph {
  const bus = context.createGain();
  bus.gain.value = 1;
  bus.connect(context.destination);

  const noise = noiseBuffer(context);

  // Traffic hum: noise through a low-pass, which is what a city sounds like
  // from anywhere that is not inside it.
  const hum = context.createBufferSource();
  hum.buffer = noise;
  hum.loop = true;
  const humFilter = context.createBiquadFilter();
  humFilter.type = 'lowpass';
  humFilter.frequency.value = 400;
  humFilter.Q.value = 0.6;
  const humGain = context.createGain();
  humGain.gain.value = 0;
  hum.connect(humFilter).connect(humGain).connect(bus);
  hum.start();

  // Wind: the same noise, higher and much quieter, with a slow sweep so it
  // breathes instead of hissing.
  const wind = context.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const windFilter = context.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 700;
  windFilter.Q.value = 0.8;
  const windGain = context.createGain();
  windGain.gain.value = 0;
  const sweep = context.createOscillator();
  sweep.frequency.value = 0.06;
  const sweepDepth = context.createGain();
  sweepDepth.gain.value = 260;
  sweep.connect(sweepDepth).connect(windFilter.frequency);
  sweep.start();
  wind.connect(windFilter).connect(windGain).connect(bus);
  wind.start();

  // The pad: two detuned sines a fifth apart, which is as close to a chord as
  // this is allowed to get. Anything more becomes music, and music loops.
  const padGain = context.createGain();
  padGain.gain.value = 0;
  padGain.connect(bus);
  for (const frequency of [55, 82.4]) {
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const voice = context.createGain();
    voice.gain.value = 0.5;
    osc.connect(voice).connect(padGain);
    osc.start();
  }

  return {
    bus,
    humGain,
    humFilter,
    padGain,
    windGain,
    dispose: () => {
      try {
        hum.stop();
        wind.stop();
        sweep.stop();
      } catch {
        /* already stopped; tearing down twice is not an error worth raising */
      }
      bus.disconnect();
    },
  };
}

/** A bird or a cricket: two or three quick notes, never the same twice. */
function chirp(context: AudioContext, bus: GainNode, kind: 'bird' | 'cricket'): void {
  const start = context.currentTime + 0.02;
  const notes = kind === 'bird' ? 2 + Math.floor(Math.random() * 2) : 3;
  const base = kind === 'bird' ? 2200 + Math.random() * 1400 : 4200;

  for (let i = 0; i < notes; i++) {
    const osc = context.createOscillator();
    osc.type = kind === 'bird' ? 'sine' : 'triangle';
    const at = start + i * (kind === 'bird' ? 0.09 : 0.05);
    const duration = kind === 'bird' ? 0.07 : 0.03;
    const frequency = base * (kind === 'bird' ? 1 + i * 0.16 : 1);
    osc.frequency.setValueAtTime(frequency, at);
    if (kind === 'bird') {
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.4, at + duration);
    }

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(kind === 'bird' ? 0.05 : 0.022, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    osc.connect(envelope).connect(bus);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    osc.onended = (): void => {
      osc.disconnect();
      envelope.disconnect();
    };
  }
}

/** Four seconds of white noise, generated once and looped. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const length = context.sampleRate * 4;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    // Brown-ish rather than white: a city rumbles, it does not hiss, and white
    // noise through a low-pass still sounds like a switched-on amplifier.
    last = (last + (Math.random() * 2 - 1) * 0.12) * 0.985;
    data[i] = last;
  }
  return buffer;
}

function ramp(param: AudioParam, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, RAMP_S / 3);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
