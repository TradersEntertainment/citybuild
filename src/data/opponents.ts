import type { GroupId } from '../sim/groups';

/**
 * Who is standing against you (§31).
 *
 * Until now an election was a threshold: get half the room and keep your job.
 * That makes a vote a *check* rather than a contest — nothing is on the other
 * side of it, so there is nobody to out-manoeuvre and no reason to campaign
 * anywhere in particular. The promises added in §30 land in that same vacuum: a
 * player can see which factions are cool on them, but not which ones somebody
 * else is working.
 *
 * An opponent fixes that with one idea: **the opposition wins where you have
 * failed.** Each one courts two constituencies, and how much of those
 * constituencies they take is proportional to how badly you are already doing
 * with them. A faction that loves you cannot be poached; a faction you have
 * neglected walks. So the opponent is never a dice roll and never a tax — it is
 * a magnifying glass held over the part of the room you have been ignoring.
 *
 * That composes with the promises for free. Break faith with the greens and your
 * approval there falls, which is exactly what makes the green-courting candidate
 * dangerous — no extra rule needed.
 *
 * ## Why they have names
 *
 * Because "the opposition took 8% of the drivers" is a statistic and "Nuri
 * Balaban is running on potholes" is a story, and the player has to be able to
 * remember which election was which when they read the chronicle back. The
 * platform is stated in the panel before the vote for the same reason the site
 * goals pulse: an opponent the player discovers only in the result is an
 * ambush, and this game does not do those.
 */
export interface OpponentArchetype {
  id: string;
  /** The two constituencies they are working. */
  courts: readonly [GroupId, GroupId];
}

/**
 * The candidates. Each pairing is a real coalition rather than two random
 * factions: a populist runs at drivers and shopkeepers, a reformer at greens
 * and families. A player who has learned what an archetype wants can predict
 * where the pressure will land next time it comes round.
 */
export const OPPONENTS: readonly OpponentArchetype[] = [
  // The pothole candidate: cars and tills, the two most common grievances.
  { id: 'populist', courts: ['drivers', 'shopkeepers'] },
  // The reformer: air and children.
  { id: 'reformer', courts: ['greens', 'families'] },
  // The industrialist: jobs and the workshops that provide them.
  { id: 'industrialist', courts: ['industrialists', 'young'] },
  // The pensioners' candidate: quiet streets and a clinic within walking
  // distance — the two things a growing city is worst at.
  { id: 'traditionalist', courts: ['elders', 'families'] },
  // The technocrat runs on the two constituencies nobody courts, which makes
  // them the hardest to see coming.
  { id: 'technocrat', courts: ['young', 'greens'] },
];

/**
 * Surnames, paired with the archetype by the same hash that picks the
 * archetype. Kept as data rather than generated so no candidate is ever called
 * something unfortunate.
 */
export const OPPONENT_NAMES: readonly string[] = [
  'Nuri Balaban',
  'Semra Aydınlı',
  'Kâzım Ergüder',
  'Bedia Toprak',
  'Selahattin Kuyucu',
  'Hicran Devecі',
  'Orhan Sarıkaya',
  'Nezahat Bulut',
  'Rıfat Özkanlı',
  'Müjgan Serttaş',
];
