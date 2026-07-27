import { describe, expect, it } from 'vitest';
import {
  LOBBY_ORDER,
  LOBBY_SPECS,
  isLobbyUnlocked,
  type LobbyId,
} from '../src/data/lobbies';
import { LOBBY_OFFER_INTERVAL_S, LOBBY_OFFER_WINDOW_S } from '../src/data/balance';
import { GROUP_ORDER, readGroups } from '../src/sim/groups';
import {
  currentOffer,
  dealRemaining,
  hasDeal,
  lobbyGrowthFactor,
  lobbyHappiness,
  lobbyOutputFactor,
  lobbyPollutionFactor,
  lobbyPullFactor,
  lobbyResearchFactor,
  lobbyRubbishFactor,
  lobbySchoolingFactor,
  lobbyStipend,
  lobbyValueFactor,
  offerIndex,
  signLobby,
  stepLobbies,
} from '../src/sim/lobbies';
import { deserialize, serialize } from '../src/sim/save';
import { createGameState } from '../src/sim/state';
import type { GameState } from '../src/sim/state';

const SECOND = 1000;

function city(): GameState {
  const state = createGameState(7, 0);
  state.era = 'metropolis';
  state.money = 5_000_000;
  return state;
}

/** Puts the clock inside the window of a given offer, without any dice. */
function intoWindow(state: GameState, index: number): void {
  state.playedMs = index * LOBBY_OFFER_INTERVAL_S * SECOND + SECOND;
}

/** Signs a deal directly, bypassing the offer window the player would need. */
function forceSign(state: GameState, id: LobbyId): void {
  state.lobbies.push({ id, until: state.playedMs + LOBBY_SPECS[id].termS * SECOND });
}

describe('the lobby table', () => {
  it('lists every lobby in the save order, exactly once', () => {
    const ids = Object.keys(LOBBY_SPECS) as LobbyId[];
    expect([...LOBBY_ORDER].sort()).toEqual([...ids].sort());
    expect(new Set(LOBBY_ORDER).size).toBe(LOBBY_ORDER.length);
  });

  it('never offers a deal that is pure gain or pure loss', () => {
    // The design contract: the money and the effect point opposite ways. A deal
    // that paid the city and cost it nothing would be a button labelled "yes".
    for (const id of LOBBY_ORDER) {
      const spec = LOBBY_SPECS[id];
      const pays = spec.signing > 0 || spec.stipend > 0;
      const costs = spec.signing < 0 || spec.stipend < 0;
      expect(pays || costs).toBe(true);
      // …and every one of them splits the room.
      expect(spec.pleases.length).toBeGreaterThan(0);
      expect(spec.angers.length).toBeGreaterThan(0);
    }
  });

  it('names only factions that exist, and never both ways at once', () => {
    for (const id of LOBBY_ORDER) {
      const spec = LOBBY_SPECS[id];
      for (const group of [...spec.pleases, ...spec.angers]) {
        expect(GROUP_ORDER).toContain(group);
      }
      for (const group of spec.pleases) expect(spec.angers).not.toContain(group);
    }
  });

  it('gives every deal a term longer than an election, so a mayor faces it', () => {
    // TERM_YEARS × SECONDS_PER_YEAR = 200s. A deal that expired before the next
    // vote would be free money with no ballot-box consequence.
    for (const id of LOBBY_ORDER) expect(LOBBY_SPECS[id].termS).toBeGreaterThan(200);
  });
});

describe('who is at the door', () => {
  it('offers nobody in a village, whatever the clock says', () => {
    const state = city();
    state.era = 'village';
    intoWindow(state, 3);
    expect(currentOffer(state)).toBeNull();
  });

  it('offers nobody at the founding', () => {
    const state = city();
    state.playedMs = 0;
    expect(currentOffer(state)).toBeNull();
  });

  it('shuts the window partway through each stretch', () => {
    const state = city();
    state.playedMs = (2 * LOBBY_OFFER_INTERVAL_S + LOBBY_OFFER_WINDOW_S + 5) * SECOND;
    expect(currentOffer(state)).toBeNull();
  });

  it('is the same offer however many times it is asked', () => {
    // The whole reason it is derived rather than rolled: a reload must not be a
    // re-roll, or the decision becomes "reload until a better lobby arrives".
    const state = city();
    intoWindow(state, 4);
    const first = currentOffer(state);
    expect(first).not.toBeNull();
    for (let i = 0; i < 20; i++) expect(currentOffer(state)).toBe(first);
  });

  it('survives a save and a load with the same offer waiting', () => {
    const state = city();
    intoWindow(state, 6);
    const before = currentOffer(state);
    const loaded = deserialize(serialize(state));
    expect(loaded).not.toBeNull();
    expect(currentOffer(loaded as GameState)).toBe(before);
  });

  it('never offers a lobby the city has already signed', () => {
    const state = city();
    intoWindow(state, 5);
    const offered = currentOffer(state);
    expect(offered).not.toBeNull();
    forceSign(state, offered as LobbyId);
    expect(currentOffer(state)).not.toBe(offered);
  });

  it('offers nobody once every lobby is signed', () => {
    const state = city();
    intoWindow(state, 5);
    for (const id of LOBBY_ORDER) forceSign(state, id);
    expect(currentOffer(state)).toBeNull();
  });

  it('only ever offers something the era has unlocked', () => {
    const state = city();
    state.era = 'town';
    // Every window across a long game: not one of them may name a city-era lobby.
    for (let index = 1; index < 200; index++) {
      intoWindow(state, index);
      const offer = currentOffer(state);
      if (offer) expect(isLobbyUnlocked(offer, 'town')).toBe(true);
    }
  });
});

describe('signing', () => {
  it('refuses a lobby that is not the one at the door', () => {
    const state = city();
    intoWindow(state, 3);
    const offered = currentOffer(state) as LobbyId;
    const other = LOBBY_ORDER.find((id) => id !== offered) as LobbyId;
    expect(signLobby(state, other)).toBe('noOffer');
    expect(state.lobbies).toHaveLength(0);
  });

  it('takes the cheque and starts the term', () => {
    const state = city();
    intoWindow(state, 3);
    const id = currentOffer(state) as LobbyId;
    const spec = LOBBY_SPECS[id];
    const before = state.money;
    expect(signLobby(state, id)).toBe('signed');
    expect(state.money).toBe(before + spec.signing);
    expect(hasDeal(state, id)).toBe(true);
    expect(dealRemaining(state, id)).toBeCloseTo(spec.termS, 5);
  });

  it('refuses a fee the city cannot cover rather than overdrawing it', () => {
    // Borrowing lives in the bank; a lobby quietly pushing a city into debt
    // would be the one purchase in the game that could.
    const state = city();
    // Walk the windows until a lobby that charges a fee comes up.
    let index = 1;
    let id: LobbyId | null = null;
    while (index < 400 && !id) {
      intoWindow(state, index);
      const offer = currentOffer(state);
      if (offer && LOBBY_SPECS[offer].signing < 0) id = offer;
      index++;
    }
    expect(id).not.toBeNull();
    state.money = 10;
    expect(signLobby(state, id as LobbyId)).toBe('tooDear');
    expect(state.money).toBe(10);
    expect(state.lobbies).toHaveLength(0);
  });

  it('refuses the same lobby twice', () => {
    const state = city();
    intoWindow(state, 3);
    const id = currentOffer(state) as LobbyId;
    expect(signLobby(state, id)).toBe('signed');
    expect(signLobby(state, id)).toBe('alreadySigned');
    expect(state.lobbies).toHaveLength(1);
  });

  it('refuses a lobby the era has not unlocked', () => {
    const state = city();
    state.era = 'village';
    expect(signLobby(state, 'oil')).toBe('locked');
  });
});

describe('the term running down', () => {
  it('reports nothing while the deal stands', () => {
    const state = city();
    forceSign(state, 'oil');
    state.playedMs += 10 * SECOND;
    expect(stepLobbies(state)).toHaveLength(0);
    expect(hasDeal(state, 'oil')).toBe(true);
  });

  it('retires the deal exactly once when the term is up', () => {
    const state = city();
    forceSign(state, 'oil');
    state.playedMs += (LOBBY_SPECS.oil.termS + 1) * SECOND;
    expect(stepLobbies(state).map((l) => l.id)).toEqual(['oil']);
    expect(hasDeal(state, 'oil')).toBe(false);
    expect(stepLobbies(state)).toHaveLength(0);
  });

  it('retires several at once after a long absence', () => {
    // The offline catch-up arrives here with playedMs already across the whole
    // gap; two terms ending in it is two lapses, not one.
    const state = city();
    forceSign(state, 'oil');
    forceSign(state, 'tourism');
    state.playedMs += 60 * 60 * SECOND;
    expect(stepLobbies(state)).toHaveLength(2);
    expect(state.lobbies).toHaveLength(0);
  });

  it('spends the term while the player is away rather than pausing it', () => {
    const state = city();
    forceSign(state, 'oil');
    const half = LOBBY_SPECS.oil.termS / 2;
    state.playedMs += half * SECOND;
    expect(dealRemaining(state, 'oil')).toBeCloseTo(half, 5);
  });
});

describe('the effects', () => {
  const HOOKS = [
    lobbyGrowthFactor,
    lobbyValueFactor,
    lobbyOutputFactor,
    lobbyPollutionFactor,
    lobbyPullFactor,
    lobbyRubbishFactor,
    lobbySchoolingFactor,
    lobbyResearchFactor,
  ];

  it('is exactly nothing with nothing signed', () => {
    // The contract every caller multiplies by unconditionally.
    const state = city();
    for (const hook of HOOKS) expect(hook(state)).toBe(1);
    expect(lobbyHappiness(state)).toBe(0);
    expect(lobbyStipend(state)).toBe(0);
  });

  it('is still exactly nothing for the lobbies that are not signed', () => {
    const state = city();
    forceSign(state, 'oil');
    expect(lobbyGrowthFactor(state)).toBe(1);
    expect(lobbyPullFactor(state)).toBe(1);
    expect(lobbySchoolingFactor(state)).toBe(1);
    expect(lobbyHappiness(state)).toBe(0);
  });

  it('trades gain against cost in each direction', () => {
    const state = city();
    forceSign(state, 'oil');
    expect(lobbyOutputFactor(state)).toBeGreaterThan(1);
    expect(lobbyPollutionFactor(state)).toBeGreaterThan(1);

    const green = city();
    forceSign(green, 'ngo');
    expect(lobbyPollutionFactor(green)).toBeLessThan(1);

    const built = city();
    forceSign(built, 'builder');
    expect(lobbyGrowthFactor(built)).toBeGreaterThan(1);
    expect(lobbyValueFactor(built)).toBeLessThan(1);
  });

  it('lets two deals pull against each other rather than one winning', () => {
    const state = city();
    forceSign(state, 'oil');
    forceSign(state, 'ngo');
    const both = lobbyPollutionFactor(state);
    const oilOnly = city();
    forceSign(oilOnly, 'oil');
    expect(both).toBeLessThan(lobbyPollutionFactor(oilOnly));
    expect(both).toBeGreaterThan(0);
  });

  it('sums the stipends, in both directions', () => {
    const state = city();
    forceSign(state, 'oil');
    forceSign(state, 'union');
    expect(lobbyStipend(state)).toBe(LOBBY_SPECS.oil.stipend + LOBBY_SPECS.union.stipend);
  });

  it('goes back to nothing once the terms lapse', () => {
    const state = city();
    forceSign(state, 'oil');
    forceSign(state, 'builder');
    state.playedMs += 60 * 60 * SECOND;
    stepLobbies(state);
    for (const hook of HOOKS) expect(hook(state)).toBe(1);
    expect(lobbyStipend(state)).toBe(0);
  });
});

describe('the room it splits', () => {
  it('moves the factions it names, in the direction it names', () => {
    const state = city();
    state.population = 5_000;
    const before = new Map(readGroups(state).map((g) => [g.id, g.approval]));
    forceSign(state, 'oil');
    const after = new Map(readGroups(state).map((g) => [g.id, g.approval]));

    // Only groups at an extreme can fail to move, so compare directionally.
    for (const group of LOBBY_SPECS.oil.angers) {
      expect(after.get(group) ?? 0).toBeLessThanOrEqual(before.get(group) ?? 0);
    }
    for (const group of LOBBY_SPECS.oil.pleases) {
      expect(after.get(group) ?? 0).toBeGreaterThanOrEqual(before.get(group) ?? 0);
    }
    // …and at least one of them really did move, or the sway does nothing.
    const moved = [...after].some(([id, value]) => value !== before.get(id));
    expect(moved).toBe(true);
  });

  it('keeps every approval inside 0..1 with every deal signed at once', () => {
    const state = city();
    state.population = 5_000;
    for (const id of LOBBY_ORDER) forceSign(state, id);
    for (const group of readGroups(state)) {
      expect(group.approval).toBeGreaterThanOrEqual(0);
      expect(group.approval).toBeLessThanOrEqual(1);
      expect(Number.isFinite(group.approval)).toBe(true);
    }
  });
});

describe('the save', () => {
  it('carries a signed deal and what is left of it', () => {
    const state = city();
    state.playedMs = 5_000;
    forceSign(state, 'oil');
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded).not.toBeNull();
    expect(hasDeal(loaded, 'oil')).toBe(true);
    expect(dealRemaining(loaded, 'oil')).toBeCloseTo(LOBBY_SPECS.oil.termS, 1);
  });

  it('loads a file from before the lobbies existed as a city nobody approached', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    delete data['lobbies'];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.lobbies).toEqual([]);
    expect(lobbyStipend(loaded)).toBe(0);
    expect(lobbyPollutionFactor(loaded)).toBe(1);
  });

  it('drops a lobby index this build does not know, rather than failing', () => {
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['lobbies'] = [999, 10_000_000, LOBBY_ORDER.indexOf('oil'), 10_000_000];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.lobbies.map((d) => d.id)).toEqual(['oil']);
  });

  it('drops a deal whose term already ran out while the tab was shut', () => {
    const state = city();
    state.playedMs = 500_000;
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['lobbies'] = [LOBBY_ORDER.indexOf('oil'), 1_000];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.lobbies).toEqual([]);
  });

  it('does not let a corrupt expiry poison the arithmetic', () => {
    // NaN in, nothing out — the documented worst case for this save format.
    const state = city();
    const data = serialize(state) as unknown as Record<string, unknown>;
    data['lobbies'] = [LOBBY_ORDER.indexOf('oil'), Number.NaN];
    const loaded = deserialize(data as never) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.lobbies).toEqual([]);
    expect(Number.isFinite(lobbyStipend(loaded))).toBe(true);
  });

  it('round-trips every lobby at once', () => {
    const state = city();
    state.playedMs = 1_000;
    for (const id of LOBBY_ORDER) forceSign(state, id);
    const loaded = deserialize(serialize(state)) as GameState;
    expect(loaded).not.toBeNull();
    expect(loaded.lobbies.map((d) => d.id).sort()).toEqual([...LOBBY_ORDER].sort());
  });
});

describe('the offer clock', () => {
  it('counts windows from the founding', () => {
    expect(offerIndex(0)).toBe(0);
    expect(offerIndex(LOBBY_OFFER_INTERVAL_S * SECOND)).toBe(1);
    expect(offerIndex(LOBBY_OFFER_INTERVAL_S * SECOND * 3.5)).toBe(3);
  });

  it('opens a window the player can actually reach', () => {
    // A window shorter than the frame budget would be a decision nobody is
    // offered; one as long as the interval would never close.
    expect(LOBBY_OFFER_WINDOW_S).toBeGreaterThan(5);
    expect(LOBBY_OFFER_WINDOW_S).toBeLessThan(LOBBY_OFFER_INTERVAL_S);
  });
});
