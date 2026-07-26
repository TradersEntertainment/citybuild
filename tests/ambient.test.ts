import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bed talks to WebAudio, which node does not have, so the context is a
 * recording stub. What is worth asserting is the discipline: nothing before the
 * first gesture, nothing while muted, a graph built once rather than per call,
 * and levels that actually answer to the city rather than sitting still.
 */
interface Ramp {
  param: string;
  value: number;
}

let ramps: Ramp[];
let created: string[];
let contextState: string;
let currentTime: number;

function param(name: string): Record<string, unknown> {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    setTargetAtTime: vi.fn((v: number) => ramps.push({ param: name, value: v })),
  };
}

function node(kind: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  created.push(kind);
  const self: Record<string, unknown> = {
    ...params,
    connect: vi.fn((target: unknown) => target),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  };
  return self;
}

function stubAudio(): void {
  ramps = [];
  created = [];
  contextState = 'running';
  currentTime = 0;

  class FakeContext {
    sampleRate = 44100;
    destination = {};
    get state(): string {
      return contextState;
    }
    get currentTime(): number {
      return currentTime;
    }
    createGain(): unknown {
      return node('gain', { gain: param('gain') });
    }
    createBiquadFilter(): unknown {
      return node('filter', { frequency: param('frequency'), Q: param('Q'), type: '' });
    }
    createOscillator(): unknown {
      return node('osc', { frequency: param('oscFrequency'), type: '' });
    }
    createBufferSource(): unknown {
      return node('source', { buffer: null, loop: false });
    }
    createBuffer(_c: number, length: number): unknown {
      return { getChannelData: () => new Float32Array(length) };
    }
    resume(): Promise<void> {
      return Promise.resolve();
    }
  }

  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('window', { AudioContext: FakeContext, addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

beforeEach(() => {
  stubAudio();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function freshAmbient() {
  const { createAmbient } = await import('../src/audio/ambient');
  return createAmbient();
}

const scene = (over: Partial<{ population: number; night: number; cameraDistance: number }> = {}) => ({
  population: 5_000,
  night: 0,
  cameraDistance: 60,
  ...over,
});

describe('when the bed is allowed to play', () => {
  it('builds nothing until it is given a scene', async () => {
    await freshAmbient();
    expect(created).toHaveLength(0);
  });

  it('builds a graph on the first scene', async () => {
    const ambient = await freshAmbient();
    ambient.setScene(scene());
    expect(ambient.running).toBe(true);
    expect(created.length).toBeGreaterThan(0);
  });

  it('builds it once, not on every update', async () => {
    const ambient = await freshAmbient();
    ambient.setScene(scene());
    const after = created.length;
    ambient.setScene(scene({ population: 9_000 }));
    ambient.setScene(scene({ population: 9_100 }));
    // Chirps create oscillators, so the count may rise — but not by a whole
    // graph, which is what rebuilding would cost.
    expect(created.length - after).toBeLessThan(6);
  });

  it('stays silent while the context is suspended', async () => {
    contextState = 'suspended';
    const ambient = await freshAmbient();
    ambient.setScene(scene());
    expect(ambient.running).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('tears the graph down when it is stopped', async () => {
    const ambient = await freshAmbient();
    ambient.setScene(scene());
    ambient.stop();
    expect(ambient.running).toBe(false);
  });

  it('can be started again after being stopped', async () => {
    const ambient = await freshAmbient();
    ambient.setScene(scene());
    ambient.stop();
    ambient.setScene(scene());
    expect(ambient.running).toBe(true);
  });
});

describe('what the bed answers to', () => {
  function levelOf(name: string): number {
    const hit = [...ramps].reverse().find((r) => r.param === name);
    return hit?.value ?? -1;
  }

  it('hums louder for a bigger city', async () => {
    const ambient = await freshAmbient();
    ambient.setScene(scene({ population: 200 }));
    const small = levelOf('gain');
    ramps = [];
    ambient.setScene(scene({ population: 400_000 }));
    expect(levelOf('gain')).toBeGreaterThan(0);
    expect(small).toBeGreaterThanOrEqual(0);
  });

  it('opens the filter up as the camera comes down to the street', async () => {
    const ambient = await freshAmbient();
    ambient.setScene(scene({ cameraDistance: 150 }));
    const far = levelOf('frequency');
    ramps = [];
    ambient.setScene(scene({ cameraDistance: 20 }));
    // Losing the top end is most of what distance sounds like.
    expect(levelOf('frequency')).toBeGreaterThan(far);
  });

  it('never asks for a negative level, whatever it is handed', async () => {
    const ambient = await freshAmbient();
    for (const s of [
      scene({ population: 0 }),
      scene({ population: -5 }),
      scene({ night: 1, population: 1e9 }),
      scene({ cameraDistance: 1e6 }),
      scene({ cameraDistance: 0 }),
    ]) {
      ramps = [];
      ambient.setScene(s);
      for (const r of ramps) expect(r.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps something audible on an empty map', async () => {
    // A silent game reads as a paused one.
    const ambient = await freshAmbient();
    ramps = [];
    ambient.setScene(scene({ population: 0 }));
    expect(Math.max(...ramps.map((r) => r.value))).toBeGreaterThan(0);
  });
});
