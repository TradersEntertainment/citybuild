import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_PIECE_S, MUSIC_REST_S } from '../src/data/balance';

/**
 * The music talks to WebAudio, which node does not have, so the context is a
 * recording stub — the same shape the ambient bed's tests use.
 *
 * What is worth asserting is not the tune. It is the discipline the tune has to
 * keep: nothing before the first gesture, a graph built once, a rest before the
 * first note, real silence between pieces, every note placed in the future
 * rather than in the past, and a mode that follows the century.
 */
interface Played {
  kind: string;
  frequency: number;
  at: number;
}

let played: Played[];
let created: string[];
let contextState: string;
let currentTime: number;

function param(): Record<string, unknown> {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn(),
  };
}

function node(kind: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  created.push(kind);
  const self: Record<string, unknown> = {
    ...params,
    connect: vi.fn((target: unknown) => target),
    disconnect: vi.fn(),
    start: vi.fn((at: number) => {
      if (kind !== 'osc') return;
      const frequency = self['frequency'] as { value: number };
      played.push({ kind, frequency: frequency.value, at });
    }),
    stop: vi.fn(),
  };
  return self;
}

function stubAudio(): void {
  played = [];
  created = [];
  contextState = 'running';
  currentTime = 0;

  class FakeContext {
    sampleRate = 8000;
    destination = {};
    get state(): string {
      return contextState;
    }
    get currentTime(): number {
      return currentTime;
    }
    createGain(): unknown {
      return node('gain', { gain: param() });
    }
    createBiquadFilter(): unknown {
      return node('filter', { frequency: param(), Q: param(), type: '' });
    }
    createOscillator(): unknown {
      return node('osc', { frequency: param(), detune: param(), type: '' });
    }
    createConvolver(): unknown {
      return node('convolver', { buffer: null });
    }
    createBuffer(channels: number, length: number): unknown {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (i: number) => data[i] as Float32Array };
    }
    resume(): Promise<void> {
      return Promise.resolve();
    }
  }

  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('window', {
    AudioContext: FakeContext,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

beforeEach(() => {
  stubAudio();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function freshMusic() {
  const { createMusic } = await import('../src/audio/music');
  return createMusic();
}

/** Advances the audio clock and lets the scheduler keep up. */
function run(music: { tick(dt: number): void }, seconds: number, step = 0.25): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    currentTime += step;
    music.tick(step);
  }
}

describe('when the music is allowed to play', () => {
  it('builds nothing until it is ticked', async () => {
    await freshMusic();
    expect(created).toHaveLength(0);
  });

  it('stays silent while the context is suspended', async () => {
    contextState = 'suspended';
    const music = await freshMusic();
    run(music, 60);
    expect(created).toHaveLength(0);
    expect(music.running).toBe(false);
  });

  it('opens on a rest rather than a downbeat', async () => {
    const music = await freshMusic();
    music.tick(0.25);
    // The graph exists — but a page that starts playing the instant it loads
    // reads as a jingle, not as a place.
    expect(music.running).toBe(true);
    expect(played).toHaveLength(0);
  });

  it('builds its graph once, not once per tick', async () => {
    const music = await freshMusic();
    run(music, 20);
    expect(created.filter((kind) => kind === 'convolver')).toHaveLength(1);
  });

  it('eventually plays something', async () => {
    const music = await freshMusic();
    run(music, 90);
    expect(played.length).toBeGreaterThan(0);
  });
});

describe('the discipline of it', () => {
  it('never schedules a note in the past', async () => {
    const music = await freshMusic();
    // A note placed behind the audio clock is played immediately and all at
    // once, which is the difference between music and a noise.
    let at = 0;
    for (let i = 0; i < 800; i++) {
      currentTime += 0.25;
      music.tick(0.25);
      for (const note of played) expect(note.at).toBeGreaterThanOrEqual(at);
      at = currentTime;
      played.length = 0;
    }
  });

  it('goes quiet between pieces', async () => {
    const music = await freshMusic();
    // Long enough to cover a piece and the rest after it, whatever they roll.
    const span = (MUSIC_PIECE_S + MUSIC_REST_S) * 2;
    const heard: number[] = [];
    for (let elapsed = 0; elapsed < span; elapsed += 0.25) {
      currentTime += 0.25;
      played.length = 0;
      music.tick(0.25);
      if (played.length > 0) heard.push(currentTime);
    }
    expect(heard.length).toBeGreaterThan(10);

    // Somewhere in there is a gap far longer than any rest inside a piece.
    let longest = 0;
    for (let i = 1; i < heard.length; i++) {
      longest = Math.max(longest, (heard[i] as number) - (heard[i - 1] as number));
    }
    expect(longest).toBeGreaterThan(30);
  });

  it('plays a different mode for a different century', async () => {
    const pitchesFor = async (year: number): Promise<Set<number>> => {
      vi.resetModules();
      stubAudio();
      const music = await freshMusic();
      music.setScene({ year, night: 0 });
      run(music, 200);
      return new Set(played.map((note) => Math.round(note.frequency)));
    };

    const old = await pitchesFor(1910);
    const future = await pitchesFor(2060);
    expect(old.size).toBeGreaterThan(0);
    expect(future.size).toBeGreaterThan(0);
    // Minor pentatonic against a suspended mode: they cannot be the same notes.
    const shared = [...old].filter((f) => future.has(f));
    expect(shared.length).toBeLessThan(Math.min(old.size, future.size));
  });

  it('tears the graph down when it is silenced', async () => {
    const music = await freshMusic();
    run(music, 60);
    expect(music.running).toBe(true);
    music.stop();
    expect(music.running).toBe(false);

    // And starts cleanly rather than resuming mid-phrase: a mute and unmute
    // must not drop the player into the middle of a bar.
    created.length = 0;
    played.length = 0;
    music.tick(0.25);
    expect(created.length).toBeGreaterThan(0);
    expect(played).toHaveLength(0);
  });
});
