import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The synth talks to WebAudio, which node does not have — so the context is
 * stood up as a recording stub. What is worth testing here is not the sound but
 * the discipline around it: nothing before the first gesture, nothing while
 * muted, and a spawn wave thinned to a flurry rather than a buzz.
 */
interface Started {
  type: string;
  at: number;
}

let started: Started[];
let currentTime: number;
let contextState: string;

function stubAudio(): void {
  started = [];
  currentTime = 0;
  contextState = 'running';

  const param = (): Record<string, unknown> => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });

  class FakeContext {
    get state(): string {
      return contextState;
    }
    get currentTime(): number {
      return currentTime;
    }
    destination = {};
    createGain(): unknown {
      return { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
    }
    createOscillator(): unknown {
      const node = {
        type: 'sine',
        frequency: param(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: (at: number) => started.push({ type: node.type, at }),
        stop: vi.fn(),
        onended: null,
      };
      return node;
    }
    resume(): Promise<void> {
      return Promise.resolve();
    }
  }

  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('window', {
    AudioContext: FakeContext,
    localStorage: {
      store: new Map<string, string>(),
      getItem(key: string): string | null {
        return (this.store as Map<string, string>).get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        (this.store as Map<string, string>).set(key, value);
      },
    },
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

async function freshSfx() {
  const { createSfx } = await import('../src/audio/sfx');
  return createSfx();
}

describe('when the game is allowed to make a sound', () => {
  it('plays once the context is running', async () => {
    const sfx = await freshSfx();
    sfx.play('build');
    expect(started.length).toBeGreaterThan(0);
  });

  it('stays silent while the context is still suspended', async () => {
    contextState = 'suspended';
    const sfx = await freshSfx();
    sfx.play('build');
    expect(started).toHaveLength(0);
  });

  it('stays silent when the player has muted it', async () => {
    const sfx = await freshSfx();
    sfx.setEnabled(false);
    started = [];
    sfx.play('era');
    expect(started).toHaveLength(0);
  });

  it('starts on, since the gesture unlock already stops it surprising anyone', async () => {
    const sfx = await freshSfx();
    expect(sfx.enabled).toBe(true);
  });

  it('remembers being turned off', async () => {
    const first = await freshSfx();
    first.setEnabled(false);
    // Same page, same storage: a second handle reads the same setting.
    const { createSfx } = await import('../src/audio/sfx');
    expect(createSfx().enabled).toBe(false);
  });

  it('makes a sound when it is switched back on, so the button is not dead', async () => {
    const sfx = await freshSfx();
    sfx.setEnabled(false);
    started = [];
    sfx.setEnabled(true);
    expect(started.length).toBeGreaterThan(0);
  });
});

describe('what it refuses to do', () => {
  it('thins a spawn wave rather than firing a note per house', async () => {
    const sfx = await freshSfx();
    for (let i = 0; i < 40; i++) sfx.play('spawn');
    // Forty houses in one frame is one note, not forty.
    expect(started).toHaveLength(1);
  });

  it('lets the wave through once time has actually passed', async () => {
    const sfx = await freshSfx();
    sfx.play('spawn');
    currentTime += 1; // a second later
    sfx.play('spawn');
    expect(started).toHaveLength(2);
  });

  it('never throttles the cues that mark a real event', async () => {
    const sfx = await freshSfx();
    started = [];
    sfx.play('era');
    sfx.play('era');
    // Two eras cannot arrive in one frame, but nothing should be silently
    // swallowing them if they did.
    expect(started.length).toBeGreaterThan(4);
  });
});

describe('the cues themselves', () => {
  it('gives an era more voices than a tap, because it matters more', async () => {
    const sfx = await freshSfx();
    sfx.play('tap');
    const tap = started.length;
    started = [];
    currentTime += 1;
    sfx.play('era');
    expect(started.length).toBeGreaterThan(tap);
  });

  it('schedules every voice at or after the moment it was asked for', async () => {
    const sfx = await freshSfx();
    currentTime = 12.5;
    sfx.play('goal');
    for (const voice of started) expect(voice.at).toBeGreaterThanOrEqual(12.5);
  });
});
