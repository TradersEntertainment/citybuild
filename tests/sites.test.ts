import { describe, expect, it } from 'vitest';
import { SITE_SIDE } from '../src/data/balance';
import { MISSIONS } from '../src/data/missions';
import { activeSites, measureGoal, settleMissions } from '../src/sim/missions';
import { totalBuildings } from '../src/sim/buildings';
import { hashSeed } from '../src/sim/rng';
import { countOnSite, isOnSite, siteArea, type SiteWant } from '../src/sim/sites';
import { createGameState, type GameState } from '../src/sim/state';
import { decodeTerrain } from '../src/sim/tiles';
import { index } from '../src/sim/world';
import { describeGoal } from '../src/ui/missionText';
import { paintZone } from '../src/sim/zoning';

const SITE_GOALS = MISSIONS.filter((m) => m.goal.measure === 'onSite');

function city(seed = 'sites'): GameState {
  const state = createGameState(hashSeed(seed), 0);
  state.era = 'metropolis';
  return state;
}

describe('the marked square', () => {
  it('is the same square every time it is asked for', () => {
    // The whole reason it is derived: a reload must not move the goalposts.
    const state = city();
    const first = siteArea(state, 'homes');
    expect(first).not.toBeNull();
    for (let i = 0; i < 10; i++) expect(siteArea(state, 'homes')).toEqual(first);
  });

  it('is the same square on a reloaded city with the same seed', () => {
    const a = siteArea(city(), 'homes');
    const b = siteArea(city(), 'homes');
    expect(a).toEqual(b);
  });

  it('puts different goals in different places', () => {
    const state = city();
    const places = new Set(
      SITE_GOALS.map((m) => {
        const area = siteArea(state, (m.goal as { want: SiteWant }).want);
        return area ? `${area.x0},${area.y0}` : 'none';
      }),
    );
    // Five goals stacked on one field would make the marking meaningless.
    expect(places.size).toBeGreaterThan(1);
  });

  it('is the size the constant says, and inside the map', () => {
    const state = city();
    for (const want of ['homes', 'park', 'service', 'shops', 'tall'] as SiteWant[]) {
      const area = siteArea(state, want);
      if (!area) continue;
      expect(area.x1 - area.x0 + 1).toBe(SITE_SIDE);
      expect(area.y1 - area.y0 + 1).toBe(SITE_SIDE);
      expect(area.x0).toBeGreaterThanOrEqual(0);
      expect(area.y0).toBeGreaterThanOrEqual(0);
      expect(area.x1).toBeLessThan(state.world.size);
      expect(area.y1).toBeLessThan(state.world.size);
    }
  });

  it('never marks water — a goal in the sea cannot be finished', () => {
    // Checked across many seeds, because whether a square lands wet is entirely
    // a property of the map the seed generated.
    for (let seed = 0; seed < 40; seed++) {
      const state = city(`wet-${seed}`);
      for (const want of ['homes', 'park', 'tall'] as SiteWant[]) {
        const area = siteArea(state, want);
        if (!area) continue;
        for (let y = area.y0; y <= area.y1; y++) {
          for (let x = area.x0; x <= area.x1; x++) {
            const terrain = decodeTerrain(state.world.terrain[index(state.world, x, y)] ?? 0);
            expect(terrain).not.toBe('water');
          }
        }
      }
    }
  });

  it('carries a name, and the same one each time', () => {
    const state = city();
    const area = siteArea(state, 'homes');
    expect(area?.name.length).toBeGreaterThan(0);
    expect(siteArea(state, 'homes')?.name).toBe(area?.name);
  });
});

describe('counting inside the square', () => {
  it('counts nothing in an empty city', () => {
    const state = city();
    const area = siteArea(state, 'park')!;
    for (const want of ['park', 'homes', 'shops', 'workshops', 'service', 'tall'] as SiteWant[]) {
      expect(countOnSite(state, area, want)).toBe(0);
    }
  });

  it('counts park tiles painted inside it', () => {
    const state = city();
    const area = siteArea(state, 'park')!;
    state.world.parcelsOwned.fill(1);
    const tiles = [];
    for (let x = area.x0; x < area.x0 + 5; x++) tiles.push({ x, y: area.y0 });
    paintZone(state.world, tiles, 'park', 1e9);
    expect(countOnSite(state, area, 'park')).toBeGreaterThan(0);
  });

  it('ignores everything outside it — the boundary is the whole point', () => {
    const state = city();
    const area = siteArea(state, 'homes')!;
    // A building just past the edge must not count toward the goal.
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x: area.x1 + 3, y: area.y1 + 3, zone: 'res', level: 1, score: 0.5,
      growthProgress: 0, decayTimer: 0, population: 20, jobs: 0, issues: 0,
      output: 0, builtAt: 0, variantSeed: 1,
    } as never);
    expect(countOnSite(state, area, 'homes')).toBe(0);
    expect(isOnSite(area, area.x1 + 3, area.y1 + 3)).toBe(false);
    expect(isOnSite(area, area.x0, area.y0)).toBe(true);
  });

  it('counts a building placed inside it', () => {
    const state = city();
    const area = siteArea(state, 'homes')!;
    const id = state.nextBuildingId++;
    state.buildings.set(id, {
      id, x: area.x0 + 2, y: area.y0 + 2, zone: 'res', level: 1, score: 0.5,
      growthProgress: 0, decayTimer: 0, population: 20, jobs: 0, issues: 0,
      output: 0, builtAt: 0, variantSeed: 1,
    } as never);
    expect(countOnSite(state, area, 'homes')).toBe(1);
    // …and not toward a goal asking for something else.
    expect(countOnSite(state, area, 'shops')).toBe(0);
  });
});

describe('the goals themselves', () => {
  it('exist, and each asks for a different thing', () => {
    expect(SITE_GOALS.length).toBeGreaterThan(0);
    const wants = SITE_GOALS.map((m) => (m.goal as { want: SiteWant }).want);
    expect(new Set(wants).size).toBe(wants.length);
  });

  it('says every one in words, naming the marked square', () => {
    for (const mission of SITE_GOALS) {
      const text = describeGoal(mission.goal);
      expect(text).toContain('İşaretli bölge');
      expect(text).not.toContain('undefined');
    }
  });

  it('measures through the ordinary goal path', () => {
    const state = city();
    const totals = totalBuildings(state);
    for (const mission of SITE_GOALS) {
      const have = measureGoal(state, totals, mission.goal);
      expect(Number.isFinite(have)).toBe(true);
      expect(have).toBeGreaterThanOrEqual(0);
    }
  });

  it('is not completed by an empty city', () => {
    const state = city();
    settleMissions(state);
    for (const mission of SITE_GOALS) expect(state.missionsDone).not.toContain(mission.id);
  });
});

describe('what the map is told to mark', () => {
  it('marks the open goals and nothing else', () => {
    const state = city();
    const marked = activeSites(state).map((s) => s.id);
    expect(marked.length).toBeGreaterThan(0);
    for (const id of marked) expect(SITE_GOALS.some((m) => m.id === id)).toBe(true);
  });

  it('stops marking a square once its goal is done', () => {
    // The whole feedback loop: the outline is the ask, and it goes out when the
    // ask is met.
    const state = city();
    const before = activeSites(state).map((s) => s.id);
    expect(before).toContain('siteHomes');
    state.missionsDone.push('siteHomes');
    expect(activeSites(state).map((s) => s.id)).not.toContain('siteHomes');
  });

  it('marks nothing in an era that has opened none', () => {
    const state = city();
    state.era = 'founding';
    expect(activeSites(state)).toHaveLength(0);
  });

  it('hands the renderer a square with real bounds', () => {
    const state = city();
    for (const { area } of activeSites(state)) {
      expect(area.x1).toBeGreaterThan(area.x0);
      expect(area.y1).toBeGreaterThan(area.y0);
      expect(area.x1).toBeLessThan(state.world.size);
      expect(area.y1).toBeLessThan(state.world.size);
    }
  });
});
