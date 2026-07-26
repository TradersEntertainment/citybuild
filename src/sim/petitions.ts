import { PETITION_CLEAR_SHARE, PETITION_RAISE_SHARE } from '../data/balance';
import type { GameState } from './state';
import { ISSUE } from './tiles';

/**
 * The city talking back (Paket 3 §7).
 *
 * Every building already carries a bitfield saying what is wrong with where it
 * stands — no water, a jam outside, smoke, no school — and until now that only
 * ever became a small mark floating over a roof. A mark tells a player that one
 * building is unhappy. It does not tell them that a fifth of the city is
 * unhappy about the *same thing*, which is the difference between noise and a
 * problem worth crossing the map for.
 *
 * A petition is that count crossing a line. It is entirely derived: nothing is
 * stored, nothing is saved, and it disappears the moment the city stops
 * complaining. The only state anywhere is the caller's memory of which
 * petitions it has already read out, which is how the goals and the weather
 * work too.
 *
 * Raising and clearing use different thresholds on purpose. One share with one
 * line would have a city hovering at the boundary firing a petition and a
 * resolution every few seconds; the gap between them is what makes "sorted" mean
 * sorted.
 */
export type PetitionKind = 'water' | 'power' | 'traffic' | 'pollution' | 'services' | 'noise';

interface Complaint {
  kind: PetitionKind;
  flag: number;
}

/**
 * Ordered by how much a player can do about it right now, so a city with three
 * problems is asked about the one it can fix.
 */
const COMPLAINTS: readonly Complaint[] = [
  { kind: 'water', flag: ISSUE.noWater },
  { kind: 'power', flag: ISSUE.noPower },
  { kind: 'services', flag: ISSUE.noService },
  { kind: 'traffic', flag: ISSUE.traffic },
  { kind: 'pollution', flag: ISSUE.pollution },
  { kind: 'noise', flag: ISSUE.noise },
];

export interface PetitionReading {
  kind: PetitionKind;
  /** Share of buildings raising this complaint, 0..1. */
  share: number;
}

/**
 * What the city is complaining about, loudest first.
 *
 * Takes both thresholds so a caller can ask two different questions with one
 * pass: which complaints are loud enough to raise, and which are still loud
 * enough to count as unresolved.
 */
export function readPetitions(state: GameState, threshold: number): PetitionReading[] {
  const total = state.buildings.size;
  if (total === 0) return [];

  const counts = new Map<PetitionKind, number>();
  for (const building of state.buildings.values()) {
    if (building.issues === 0) continue;
    for (const complaint of COMPLAINTS) {
      if ((building.issues & complaint.flag) === 0) continue;
      counts.set(complaint.kind, (counts.get(complaint.kind) ?? 0) + 1);
    }
  }

  const readings: PetitionReading[] = [];
  for (const complaint of COMPLAINTS) {
    const share = (counts.get(complaint.kind) ?? 0) / total;
    if (share >= threshold) readings.push({ kind: complaint.kind, share });
  }

  readings.sort((a, b) => b.share - a.share);
  return readings;
}

/** Complaints loud enough to put to the mayor. */
export function activePetitions(state: GameState): PetitionReading[] {
  return readPetitions(state, PETITION_RAISE_SHARE);
}

/**
 * Whether a petition already raised is still standing.
 *
 * The lower bar: a complaint has to fall well below where it was raised before
 * the city calls it settled, or a district on the boundary would file and
 * withdraw the same petition all afternoon.
 */
export function isStillStanding(state: GameState, kind: PetitionKind): boolean {
  return readPetitions(state, PETITION_CLEAR_SHARE).some((p) => p.kind === kind);
}

/** Every kind there is, for a UI that wants to name them all. */
export const PETITION_KINDS: readonly PetitionKind[] = COMPLAINTS.map((c) => c.kind);
