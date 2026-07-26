import { describe, expect, it } from 'vitest';
import { STR } from '../src/data/strings.tr';
import type { BuildingTotals } from '../src/sim/buildings';
import { guidanceFor, type CityFacts } from '../src/ui/guidance';

/**
 * The hint is the only instruction the game ever gives, and it used to be
 * wrong: it told the player to draw a road and promised the rest would follow,
 * when in fact nothing grows until land is zoned. These pin the chain that
 * replaced it.
 */
function totals(over: Partial<BuildingTotals> = {}): BuildingTotals {
  return {
    housing: 0,
    commercialJobs: 0,
    industrialJobs: 0,
    farmJobs: 0,
    ...over,
  } as BuildingTotals;
}

function facts(over: Partial<CityFacts> = {}): CityFacts {
  return {
    roadTiles: 0,
    zonedTiles: 0,
    buildings: 0,
    population: 0,
    totals: totals(),
    interchanges: 0,
    // The chain below only applies to streets that lead somewhere; the
    // disconnected case gets its own test.
    connectedRoadTiles: 1,
    ...over,
  };
}

describe('player guidance', () => {
  it('opens by asking for a road', () => {
    expect(guidanceFor(facts())).toBe(STR.empty.noRoads);
  });

  it('asks for zoning once a road exists, rather than promising magic', () => {
    expect(guidanceFor(facts({ roadTiles: 20 }))).toBe(STR.empty.noZones);
  });

  it('calls out a road that cannot reach the national highway before anything else', () => {
    expect(guidanceFor(facts({ roadTiles: 20, connectedRoadTiles: 0 }))).toBe(
      STR.empty.disconnected,
    );
  });

  it('says to wait once land is zoned but nothing has grown yet', () => {
    expect(guidanceFor(facts({ roadTiles: 20, zonedTiles: 40 }))).toBe(STR.empty.noPeople);
  });

  it('says nothing while a young settlement finds its feet', () => {
    expect(
      guidanceFor(facts({ roadTiles: 20, zonedTiles: 40, buildings: 6, population: 12 })),
    ).toBeNull();
  });

  it('calls out unemployment once the town is big enough for it to matter', () => {
    expect(
      guidanceFor(
        facts({
          roadTiles: 20,
          zonedTiles: 40,
          buildings: 40,
          population: 200,
          totals: totals({ housing: 240 }),
        }),
      ),
    ).toBe(STR.empty.noJobs);
  });

  it('calls out the mirror case: workplaces with nobody to fill them', () => {
    expect(
      guidanceFor(
        facts({
          roadTiles: 20,
          zonedTiles: 40,
          buildings: 8,
          population: 0,
          totals: totals({ commercialJobs: 30 }),
        }),
      ),
    ).toBe(STR.empty.noHomes);
  });

  it('points at the national highway once the town works but has no junction', () => {
    expect(
      guidanceFor(
        facts({
          roadTiles: 60,
          zonedTiles: 200,
          buildings: 80,
          population: 400,
          totals: totals({ housing: 460, commercialJobs: 120, industrialJobs: 80 }),
          interchanges: 0,
        }),
      ),
    ).toBe(STR.highway.connectHint);
  });

  it('falls silent when the city is working and joined to the motorway', () => {
    expect(
      guidanceFor(
        facts({
          roadTiles: 60,
          zonedTiles: 200,
          buildings: 80,
          population: 400,
          totals: totals({ housing: 460, commercialJobs: 120, industrialJobs: 80 }),
          interchanges: 1,
        }),
      ),
    ).toBeNull();
  });
});
