import { beforeEach, describe, expect, it } from 'vitest';
import { DIFFUSION_ITERATIONS } from '../src/data/balance';
import type { TilePoint } from '../src/input/pathGeometry';
import { suitability } from '../src/sim/buildings';
import { createDiffusionScratch, diffuseFields } from '../src/sim/diffusion';
import { hashSeed } from '../src/sim/rng';
import { buildRoad } from '../src/sim/roads';
import { createGameState, type GameState } from '../src/sim/state';
import { Systems } from '../src/sim/systems';
import { ISSUE } from '../src/sim/tiles';
import { index, startingCentre } from '../src/sim/world';
import { paintZone } from '../src/sim/zoning';

/**
 * Pollution and noise exist to make *where* things go a decision. These check
 * that the fields have a shape — a peak, a falloff, an edge — rather than
 * merely being non-zero somewhere.
 */
let game: GameState;
let origin: { x: number; y: number };

function flatten(state: GameState, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const i = index(state.world, x, y);
      state.world.height[i] = 0.5;
      state.world.fertility[i] = 0.3;
      state.world.terrain[i] = 2; // plain, so woodland absorption never confuses a test
    }
  }
}

function row(length: number, dy: number): TilePoint[] {
  return Array.from({ length }, (_, i) => ({ x: origin.x + i, y: origin.y + dy }));
}

function run(systems: Systems, seconds: number): void {
  for (let s = 0; s < seconds; s++) {
    systems.step(game, 1);
    systems.stepEconomy(game, 1);
  }
}

/** A road with industry on one side and housing on the other. */
function industrialTown(): Systems {
  const systems = new Systems(game.world.size);
  buildRoad(game.world, row(20, 0), 'path', 1_000_000);
  paintZone(game.world, row(20, 1), 'ind', 1_000_000);
  paintZone(game.world, row(20, -1), 'res', 1_000_000);
  systems.invalidateFields();
  return systems;
}

function pollutionAt(x: number, y: number): number {
  return game.world.pollution[index(game.world, x, y)] ?? 0;
}

beforeEach(() => {
  game = createGameState(hashSeed('diffusion'), 0);
  const centre = startingCentre(game.world);
  origin = { x: Math.floor(centre.x) - 10, y: Math.floor(centre.y) };
  flatten(game, Math.floor(centre.x), Math.floor(centre.y), 24);
});

describe('pollution', () => {
  it('is zero on an empty map', () => {
    const scratch = createDiffusionScratch(game.world.size);
    diffuseFields(game, scratch);
    expect(Math.max(...game.world.pollution)).toBe(0);
  });

  it('appears where industry is built', () => {
    const systems = industrialTown();
    run(systems, 60);
    expect(pollutionAt(origin.x + 10, origin.y + 1)).toBeGreaterThan(5);
  });

  it('falls off with distance instead of filling the map', () => {
    const systems = industrialTown();
    run(systems, 300);

    const at = (d: number): number => pollutionAt(origin.x + 10, origin.y + 1 + d);
    expect(at(0)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(5));
    // Past the solver's reach there is nothing at all; a field that never
    // reaches zero is a field that stops meaning anything.
    expect(at(DIFFUSION_ITERATIONS + 4)).toBe(0);
  });

  it('stays inside the 0..100 scale suitability expects', () => {
    const systems = industrialTown();
    run(systems, 600);
    for (const value of game.world.pollution) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('clears when the industry that caused it is gone', () => {
    const systems = industrialTown();
    run(systems, 120);
    expect(pollutionAt(origin.x + 10, origin.y + 1)).toBeGreaterThan(5);

    // Demolish: with the buildings gone the field must not keep staining ground
    // nothing stands on any more.
    game.buildings.clear();
    game.world.building.fill(0);
    const scratch = createDiffusionScratch(game.world.size);
    diffuseFields(game, scratch);
    expect(Math.max(...game.world.pollution)).toBe(0);
  });

  it('is reduced by a park between the factory and the houses', () => {
    const systems = industrialTown();
    run(systems, 300);
    const dirty = pollutionAt(origin.x + 10, origin.y + 4);

    paintZone(game.world, row(20, 2), 'park', 1_000_000);
    paintZone(game.world, row(20, 3), 'park', 1_000_000);
    const scratch = createDiffusionScratch(game.world.size);
    diffuseFields(game, scratch);

    expect(pollutionAt(origin.x + 10, origin.y + 4)).toBeLessThan(dirty);
  });
});

describe('noise', () => {
  it('comes off a loud road even with nothing built on it', () => {
    const systems = new Systems(game.world.size);
    // Boulevards carry a noise figure; a dirt path does not.
    buildRoad(game.world, row(20, 0), 'boulevard', 10_000_000);
    systems.invalidateFields();
    run(systems, 30);
    expect(game.world.noise[index(game.world, origin.x + 10, origin.y)] ?? 0).toBeGreaterThan(5);
  });

  it('does not come off a quiet one', () => {
    const systems = new Systems(game.world.size);
    buildRoad(game.world, row(20, 0), 'path', 1_000_000);
    systems.invalidateFields();
    run(systems, 30);
    expect(Math.max(...game.world.noise)).toBe(0);
  });

  it('is tighter than pollution, as smoke travels further than sound', () => {
    const systems = industrialTown();
    run(systems, 300);
    const i = index(game.world, origin.x + 10, origin.y + 4);
    const noise = game.world.noise[i] ?? 0;
    const pollution = game.world.pollution[i] ?? 0;
    expect(noise).toBeLessThan(pollution);
  });
});

describe('the solver itself', () => {
  it('is deterministic — the same city gives the same field', () => {
    const systems = industrialTown();
    run(systems, 120);

    // Solve twice from the same city, with no sim steps between: the sim goes
    // on growing after the scheduler's last solve, so comparing against a
    // snapshot taken mid-run would be testing the clock, not the solver.
    const scratch = createDiffusionScratch(game.world.size);
    diffuseFields(game, scratch);
    const first = Float32Array.from(game.world.pollution);
    diffuseFields(game, scratch);

    expect([...game.world.pollution]).toEqual([...first]);
  });

  it('does not depend on the scratch it is handed', () => {
    const systems = industrialTown();
    run(systems, 120);

    diffuseFields(game, createDiffusionScratch(game.world.size));
    const fresh = Float32Array.from(game.world.pollution);
    // A scratch that has already been used must give the same answer, or a
    // reload would produce a different city from the one that was saved.
    const used = createDiffusionScratch(game.world.size);
    used.buffer.fill(999);
    used.pollutionSource.fill(999);
    diffuseFields(game, used);

    expect([...game.world.pollution]).toEqual([...fresh]);
  });
});

describe('who minds a nuisance', () => {
  /** Puts a fixed amount of pollution under a tile, bypassing the solver. */
  function poison(x: number, y: number, amount: number): void {
    game.world.pollution[index(game.world, x, y)] = amount;
  }

  it('costs housing more than it costs a factory', () => {
    const systems = industrialTown();
    run(systems, 30);
    const fields = systems.fields;

    const x = origin.x + 5;
    poison(x, origin.y - 1, 90);
    poison(x, origin.y + 1, 90);
    const clean = suitability(game, fields, origin.x + 6, origin.y - 1, 'res');
    const dirty = suitability(game, fields, x, origin.y - 1, 'res');
    expect(dirty).toBeLessThan(clean);

    // Industry shrugs it off entirely, so its own smoke cannot stall it.
    const cleanInd = suitability(game, fields, origin.x + 6, origin.y + 1, 'ind');
    const dirtyInd = suitability(game, fields, x, origin.y + 1, 'ind');
    expect(dirtyInd).toBeCloseTo(cleanInd, 6);
  });

  it('does not put a warning mark on the factory making the smoke', () => {
    const systems = industrialTown();
    run(systems, 300);

    const flagged = [...game.buildings.values()].filter(
      (b) => (b.issues & ISSUE.pollution) !== 0,
    );
    // A mark over every factory in the estate tells the player nothing and
    // buries the one over the houses downwind.
    expect(flagged.every((b) => b.zone !== 'ind')).toBe(true);
  });
});
