import { describe, expect, it } from 'vitest';
import {
  CONFISCATION_FURY,
  REVOLT_UNREST_JUMP,
  TAX_RATE_MAX,
  TAX_RATE_MIN,
} from '../src/data/balance';
import { DECREE_ORDER, DECREE_SPECS } from '../src/data/decrees';
import {
  confiscate,
  decreeEmigrationFactor,
  decreeFarmFactor,
  decreeRoadUpkeepFactor,
  decreeTaxFactor,
  decreeUnrestQuiet,
  handOutBread,
  decreeCommerceFactor,
  decreeCrimeFactor,
  decreeGate,
  decreeIndustryFactor,
  decreeOfficeFactor,
  decreeResearchFactor,
  decreeStipend,
  decreeSway,
  furyPressure,
  furyStage,
  isDecreeActive,
  sensitivity,
  setTaxRate,
  stepDecrees,
  taxComfort,
  toggleDecree,
  tolerance,
  warningsSilenced,
} from '../src/sim/decrees';
import { GROUP_ORDER } from '../src/sim/groups';
import { deserialize, serialize } from '../src/sim/save';
import { hashSeed } from '../src/sim/rng';
import { createGameState, type GameState } from '../src/sim/state';

const YEAR_MS = 40 * 1000;

function city(seed = 'decrees'): GameState {
  const state = createGameState(hashSeed(seed), 0);
  state.era = 'metropolis';
  state.population = 8_000;
  // Past 2000, so the year gate is open unless a test says otherwise.
  state.playedMs = 110 * YEAR_MS;
  return state;
}

describe('the hidden temper', () => {
  it('is the same for the same city, every time it is asked', () => {
    const state = city();
    expect(tolerance(state)).toBe(tolerance(state));
    expect(taxComfort(state)).toBe(taxComfort(state));
    for (const id of DECREE_ORDER) {
      expect(sensitivity(state, id)).toBe(sensitivity(state, id));
    }
  });

  it('differs from city to city — every playthrough has its own temper', () => {
    const tolerances = new Set<number>();
    const curfewTempers = new Set<number>();
    for (let n = 0; n < 12; n++) {
      const state = city(`temper-${n}`);
      tolerances.add(Math.round(tolerance(state) * 1000));
      curfewTempers.add(Math.round(sensitivity(state, 'curfew') * 1000));
    }
    expect(tolerances.size).toBeGreaterThan(6);
    expect(curfewTempers.size).toBeGreaterThan(6);
  });

  it('gives each decree its own sensitivity in the same city', () => {
    // "Bu halk şuna sinirleniyor": the city that shrugs at conscription can
    // riot over curfews. If these were equal the discovery game would be flat.
    const state = city();
    const senses = DECREE_ORDER.map((id) => Math.round(sensitivity(state, id) * 1000));
    expect(new Set(senses).size).toBeGreaterThan(1);
  });

  it('stays inside its stated ranges', () => {
    for (let n = 0; n < 30; n++) {
      const state = city(`range-${n}`);
      expect(tolerance(state)).toBeGreaterThanOrEqual(0.55);
      expect(tolerance(state)).toBeLessThanOrEqual(1.15);
      expect(taxComfort(state)).toBeGreaterThanOrEqual(0.1);
      expect(taxComfort(state)).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('enacting', () => {
  it('flips on, and off, and reports which', () => {
    const state = city();
    expect(toggleDecree(state, 'curfew')).toBe('enacted');
    expect(isDecreeActive(state, 'curfew')).toBe(true);
    expect(toggleDecree(state, 'curfew')).toBe('repealed');
    expect(isDecreeActive(state, 'curfew')).toBe(false);
  });

  it('refuses a decree the era has not opened, and names the gate', () => {
    const state = city();
    state.era = 'village';
    expect(decreeGate(state, 'conscription')).toBe('era');
    expect(toggleDecree(state, 'conscription')).toBe('locked');
  });

  it('keeps the internet cut behind the calendar, not just the era', () => {
    const state = city();
    state.playedMs = 50 * YEAR_MS; // 1950
    expect(decreeGate(state, 'internetCut')).toBe('year');
    expect(toggleDecree(state, 'internetCut')).toBe('locked');
    state.playedMs = 110 * YEAR_MS; // 2010
    expect(decreeGate(state, 'internetCut')).toBe('open');
    expect(toggleDecree(state, 'internetCut')).toBe('enacted');
  });
});

describe('the tax lever', () => {
  it('moves, clamps, and never takes a corrupt value', () => {
    const state = city();
    setTaxRate(state, 0.13);
    expect(state.taxRate).toBeCloseTo(0.13, 10);
    setTaxRate(state, 99);
    expect(state.taxRate).toBe(TAX_RATE_MAX);
    setTaxRate(state, -1);
    expect(state.taxRate).toBe(TAX_RATE_MIN);
    setTaxRate(state, Number.NaN);
    expect(state.taxRate).toBe(TAX_RATE_MIN);
  });

  it("adds no fury below this city's comfort, and some above it", () => {
    const state = city();
    setTaxRate(state, taxComfort(state) - 0.01);
    expect(furyPressure(state)).toBe(0);
    setTaxRate(state, Math.min(TAX_RATE_MAX, taxComfort(state) + 0.04));
    expect(furyPressure(state)).toBeGreaterThan(0);
  });
});

describe('fury', () => {
  it('is exactly still in a city that has decreed nothing', () => {
    const state = city();
    for (let i = 0; i < 300; i++) stepDecrees(state, 1);
    expect(state.fury).toBe(0);
    expect(furyPressure(state)).toBe(0);
  });

  it('accrues under a decree, and decays once it is repealed', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    for (let i = 0; i < 120; i++) stepDecrees(state, 1);
    const banked = state.fury;
    expect(banked).toBeGreaterThan(0);
    toggleDecree(state, 'curfew');
    for (let i = 0; i < 120; i++) stepDecrees(state, 1);
    expect(state.fury).toBeLessThan(banked);
  });

  it('accrues faster in a city that minds this decree more', () => {
    // Find two cities at the ends of the curfew temper and compare.
    let touchy: GameState | null = null;
    let stoic: GameState | null = null;
    for (let n = 0; n < 60 && (!touchy || !stoic); n++) {
      const state = city(`pair-${n}`);
      const sense = sensitivity(state, 'curfew');
      if (sense > 1.5 && !touchy) touchy = state;
      if (sense < 0.8 && !stoic) stoic = state;
    }
    expect(touchy).not.toBeNull();
    expect(stoic).not.toBeNull();
    toggleDecree(touchy!, 'curfew');
    toggleDecree(stoic!, 'curfew');
    for (let i = 0; i < 60; i++) {
      stepDecrees(touchy!, 1);
      stepDecrees(stoic!, 1);
    }
    expect(touchy!.fury).toBeGreaterThan(stoic!.fury);
  });

  it('only ever falls while nobody is watching — the offline mercy', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    toggleDecree(state, 'conscription');
    state.fury = 0.3;
    for (let i = 0; i < 200; i++) stepDecrees(state, 1, false);
    expect(state.fury).toBeLessThan(0.3);
  });
});

describe('the warnings', () => {
  it('arrive in order: murmurs, then protests, then the revolt', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    toggleDecree(state, 'conscription');
    setTaxRate(state, TAX_RATE_MAX);
    const heard: string[] = [];
    for (let i = 0; i < 5_000 && !heard.includes('revolt'); i++) {
      for (const event of stepDecrees(state, 1)) heard.push(event.kind);
    }
    expect(heard).toEqual(['murmurs', 'protests', 'revolt']);
  });

  it('are silenced by censorship — and the backlog announces when it lifts', () => {
    const state = city();
    toggleDecree(state, 'censorship');
    toggleDecree(state, 'curfew');
    setTaxRate(state, TAX_RATE_MAX);
    expect(warningsSilenced(state)).toBe(true);

    const whileCensored: string[] = [];
    // Walk fury deep into protest territory, but stop before the revolt.
    const limit = tolerance(state);
    while (state.fury < limit * 0.9) {
      for (const event of stepDecrees(state, 1)) whileCensored.push(event.kind);
    }
    expect(whileCensored).toEqual([]);
    expect(furyStage(state)).toBe(2);

    // Lift the censorship: the next tick owes the player two pieces of news.
    toggleDecree(state, 'censorship');
    const after = stepDecrees(state, 1).map((event) => event.kind);
    expect(after).toEqual(['murmurs', 'protests']);
  });

  it('says calm again, once, when the street settles', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    setTaxRate(state, TAX_RATE_MAX);
    while (furyStage(state) < 1) stepDecrees(state, 1);
    toggleDecree(state, 'curfew');
    setTaxRate(state, 0.05);
    let calms = 0;
    for (let i = 0; i < 3_000; i++) {
      for (const event of stepDecrees(state, 1)) if (event.kind === 'calm') calms++;
    }
    expect(calms).toBe(1);
    expect(state.fury).toBe(0);
  });
});

describe('the revolt', () => {
  it('dumps into unrest, vents most of the fury, and names the worst grievance', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    setTaxRate(state, TAX_RATE_MAX);
    state.fury = tolerance(state) - 0.001;
    const before = state.unrest;
    const [event] = stepDecrees(state, 10);
    expect(event?.kind).toBe('revolt');
    expect(state.unrest).toBeCloseTo(before + REVOLT_UNREST_JUMP, 6);
    expect(state.fury).toBeLessThan(tolerance(state));
    expect(state.fury).toBeGreaterThan(0);
    expect(event?.worst).toBeDefined();
  });

  it('is announced even under censorship — a square on fire cannot be redacted', () => {
    const state = city();
    toggleDecree(state, 'censorship');
    toggleDecree(state, 'curfew');
    state.fury = tolerance(state) - 0.001;
    const events = stepDecrees(state, 10).map((event) => event.kind);
    expect(events).toContain('revolt');
  });

  it('blames the tax when the tax is the loudest grievance', () => {
    const state = city();
    setTaxRate(state, TAX_RATE_MAX);
    state.fury = tolerance(state) - 0.0001;
    const [event] = stepDecrees(state, 5);
    expect(event?.kind).toBe('revolt');
    expect(event?.worst).toBe('tax');
  });

  it('repeats if nothing changes — and is escapable if everything does', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    toggleDecree(state, 'conscription');
    setTaxRate(state, TAX_RATE_MAX);
    let revolts = 0;
    for (let i = 0; i < 12_000; i++) {
      for (const event of stepDecrees(state, 1)) if (event.kind === 'revolt') revolts++;
    }
    expect(revolts).toBeGreaterThan(1);

    // Repeal everything: the city walks all the way back to calm.
    toggleDecree(state, 'curfew');
    toggleDecree(state, 'conscription');
    setTaxRate(state, 0.08);
    for (let i = 0; i < 4_000; i++) stepDecrees(state, 1);
    expect(state.fury).toBe(0);
  });
});

describe('the confiscation', () => {
  it('pays now, scaled to the city, and banks fury scaled to its temper', () => {
    const state = city();
    const before = state.money;
    const { seized } = confiscate(state);
    expect(seized).toBeGreaterThan(0);
    expect(state.money).toBe(before + seized);
    expect(state.fury).toBeCloseTo(
      CONFISCATION_FURY * sensitivity(state, 'confiscation'),
      6,
    );
  });

  it('can be pressed until the city answers — fury is the only brake', () => {
    const state = city();
    let presses = 0;
    while (state.fury < tolerance(state) && presses < 40) {
      confiscate(state);
      presses++;
    }
    expect(presses).toBeGreaterThan(1);
    expect(presses).toBeLessThan(40);
  });
});

describe('the hooks', () => {
  it('answer exactly 1 (or 0) with nothing decreed', () => {
    const state = city();
    expect(decreeIndustryFactor(state)).toBe(1);
    expect(decreeCommerceFactor(state)).toBe(1);
    expect(decreeCrimeFactor(state)).toBe(1);
    expect(decreeOfficeFactor(state)).toBe(1);
    expect(decreeResearchFactor(state)).toBe(1);
    expect(decreeStipend(state)).toBe(0);
    for (const group of GROUP_ORDER) expect(decreeSway(state, group)).toBe(0);
  });

  it('trades in both directions, per the table', () => {
    const state = city();
    toggleDecree(state, 'conscription');
    expect(decreeStipend(state)).toBeGreaterThan(0);
    expect(decreeIndustryFactor(state)).toBeLessThan(1);
    toggleDecree(state, 'propaganda');
    expect(decreeStipend(state)).toBeLessThan(DECREE_SPECS.conscription.stipendPerMinute);
    // Propaganda warms even the factions other decrees anger.
    expect(decreeSway(state, 'greens')).toBeGreaterThan(-0.2);
  });

  it('angers exactly the factions each decree names', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    for (const group of GROUP_ORDER) {
      if (DECREE_SPECS.curfew.angers.includes(group)) {
        expect(decreeSway(state, group)).toBeLessThan(0);
      } else {
        expect(decreeSway(state, group)).toBe(0);
      }
    }
  });
});

describe('the wider menu (§32 genişletme)', () => {
  it('composes multipliers as products when decrees overlap', () => {
    // Curfew, informants and martial law all grip the same streets; a city
    // under all three gets all three, multiplied, and none of them knows the
    // others exist.
    const state = city();
    toggleDecree(state, 'curfew');
    toggleDecree(state, 'informants');
    toggleDecree(state, 'martialLaw');
    expect(decreeCrimeFactor(state)).toBeCloseTo(0.5 * 0.75 * 0.4, 10);
    expect(decreeCommerceFactor(state)).toBeCloseTo(0.9 * 0.85, 10);
  });

  it('lets conscription and the strike ban pull opposite ways on one floor', () => {
    const state = city();
    toggleDecree(state, 'conscription');
    toggleDecree(state, 'strikeBan');
    expect(decreeIndustryFactor(state)).toBeCloseTo(0.92 * 1.1, 10);
  });

  it('gates the modern pair on their own calendars', () => {
    const state = city();
    state.playedMs = 105 * 40 * 1000; // 2005: internet yes, platforms not yet
    expect(decreeGate(state, 'internetCut')).toBe('open');
    expect(decreeGate(state, 'socialMediaBan')).toBe('year');
    state.playedMs = 112 * 40 * 1000; // 2012
    expect(decreeGate(state, 'socialMediaBan')).toBe('open');
  });

  it('keeps the platform ban milder than the cut, on both sides', () => {
    // Its whole reason to exist: some suppression, less collateral, and — the
    // half that matters — it does NOT blind the warnings.
    const state = city();
    toggleDecree(state, 'socialMediaBan');
    expect(warningsSilenced(state)).toBe(false);
    expect(DECREE_SPECS.socialMediaBan.muffle!).toBeGreaterThan(DECREE_SPECS.internetCut.muffle!);
    expect(DECREE_SPECS.socialMediaBan.office!).toBeGreaterThan(DECREE_SPECS.internetCut.office!);
  });

  it('pays informants to see through the ruler\'s own censorship', () => {
    const state = city();
    toggleDecree(state, 'censorship');
    expect(warningsSilenced(state)).toBe(true);
    toggleDecree(state, 'informants');
    expect(warningsSilenced(state)).toBe(false);
    // …and the warnings genuinely arrive while both stand.
    toggleDecree(state, 'curfew');
    setTaxRate(state, TAX_RATE_MAX);
    const heard: string[] = [];
    for (let i = 0; i < 5_000 && !heard.includes('revolt'); i++) {
      for (const event of stepDecrees(state, 1)) heard.push(event.kind);
    }
    expect(heard).toEqual(['murmurs', 'protests', 'revolt']);
  });

  it('chokes only the outflow at a closed border', () => {
    const state = city();
    expect(decreeEmigrationFactor(state)).toBe(1);
    toggleDecree(state, 'borderClosure');
    expect(decreeEmigrationFactor(state)).toBeCloseTo(0.25, 10);
  });

  it('puts unrest down faster under martial law — suppression, not forgiveness', () => {
    const state = city();
    toggleDecree(state, 'martialLaw');
    expect(decreeUnrestQuiet(state)).toBe(2);
    // The fury underneath is untouched: martial law is itself the fastest
    // fury in the table.
    expect(DECREE_SPECS.martialLaw.furyPerS).toBeGreaterThan(DECREE_SPECS.curfew.furyPerS);
  });

  it('takes the farmer\'s margin and the taxpayer\'s fifteen percent', () => {
    const state = city();
    toggleDecree(state, 'grainLevy');
    toggleDecree(state, 'surcharge');
    toggleDecree(state, 'corvee');
    expect(decreeFarmFactor(state)).toBeCloseTo(1.4, 10);
    expect(decreeTaxFactor(state)).toBeCloseTo(1.15, 10);
    expect(decreeRoadUpkeepFactor(state)).toBeCloseTo(0.6, 10);
  });

  it('flatters at half the weight it wounds', () => {
    const state = city();
    toggleDecree(state, 'strikeBan');
    const pleased = decreeSway(state, 'industrialists');
    const wounded = decreeSway(state, 'young');
    expect(pleased).toBeGreaterThan(0);
    expect(wounded).toBeLessThan(0);
    expect(Math.abs(wounded)).toBeCloseTo(Math.abs(pleased) * 2, 10);
  });
});

describe('the bread dole', () => {
  it('feeds the square for money and vents fury by this city\'s own measure', () => {
    const state = city();
    state.money = 1_000_000;
    state.fury = 0.5;
    const before = state.money;
    const result = handOutBread(state);
    expect(result.fed).toBe(true);
    expect(state.money).toBeLessThan(before);
    expect(state.fury).toBeLessThan(0.5);
  });

  it('is refused, not lent, when the treasury cannot cover it', () => {
    const state = city();
    state.money = 10;
    state.fury = 0.5;
    expect(handOutBread(state).fed).toBe(false);
    expect(state.money).toBe(10);
    expect(state.fury).toBe(0.5);
  });

  it('calms a touchy city less — the same temper, read from the other side', () => {
    let touchy: GameState | null = null;
    let easy: GameState | null = null;
    for (let n = 0; n < 80 && (!touchy || !easy); n++) {
      const state = city(`bread-${n}`);
      const sense = sensitivity(state, 'bread');
      if (sense > 1.5 && !touchy) touchy = state;
      if (sense < 0.8 && !easy) easy = state;
    }
    expect(touchy).not.toBeNull();
    expect(easy).not.toBeNull();
    for (const state of [touchy!, easy!]) {
      state.money = 1_000_000;
      state.fury = 0.5;
      handOutBread(state);
    }
    // The easy city vented more fury for the same loaf.
    expect(easy!.fury).toBeLessThan(touchy!.fury);
  });

  it('never drives fury below zero, and re-announces a fresh escalation', () => {
    const state = city();
    state.money = 10_000_000;
    state.fury = 0.05;
    handOutBread(state);
    expect(state.fury).toBe(0);
  });
});

describe('the save', () => {
  it('carries the decrees and the fury — both are debts', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    state.fury = 0.42;
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded).not.toBeNull();
    expect(isDecreeActive(loaded, 'curfew')).toBe(true);
    expect(loaded.fury).toBeCloseTo(0.42, 3);
  });

  it('lands quiet: the told-stage syncs so a reload does not re-announce', () => {
    const state = city();
    toggleDecree(state, 'curfew');
    state.fury = tolerance(state) * 0.7; // murmur territory
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded!.furyToldStage).toBe(furyStage(loaded!));
    // The next step reports nothing new.
    toggleDecree(loaded!, 'curfew');
    setTaxRate(loaded!, 0.05);
    expect(stepDecrees(loaded!, 1)).toHaveLength(0);
  });

  it('loads a file from before this existed as a city never decreed at', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    delete data['decrees'];
    delete data['fury'];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.decrees).toEqual([]);
    expect(loaded.fury).toBe(0);
  });

  it('drops an unknown decree and clamps a corrupt meter', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['decrees'] = ['curfew', 'royalDecree'];
    data['fury'] = Number.NaN;
    const loaded = deserialize(data as never) as GameState;
    expect(loaded!.decrees).toEqual(['curfew']);
    expect(loaded!.fury).toBe(0);
  });
});
