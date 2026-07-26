import * as THREE from 'three';
import { seasonBlend, snowAmount, type Season } from '../sim/seasons';

/**
 * What each season looks like (Paket 3 §8).
 *
 * The ground and the foliage are both multiplied by a colour, which is the
 * cheapest possible way to move a whole map through a year: no geometry is
 * rebuilt, no instance is touched, and the shared material does the work on the
 * GPU. Values above 1 are deliberate and are the only reason a winter can read
 * as *brighter* than a summer rather than merely colder — a multiply capped at 1
 * can only ever darken, and a darker winter looks like dusk.
 *
 * Kept out of `src/sim` because none of it is a rule. What the calendar does to
 * a harvest is a rule and lives there; what it does to the colour of a hillside
 * is a look, and lives here.
 */
interface SeasonLook {
  /** Multiplied over the ground's own vertex colours. */
  ground: readonly [number, number, number];
  /** Multiplied over the tree crowns. */
  foliage: readonly [number, number, number];
}

const LOOKS: Readonly<Record<Season, SeasonLook>> = {
  // Bare, pale and slightly blue. The snow curve lightens it further on top.
  winter: { ground: [0.96, 0.98, 1.06], foliage: [0.7, 0.76, 0.82] },
  // The one season allowed to be greener than the base palette.
  spring: { ground: [1.02, 1.08, 0.98], foliage: [1.12, 1.16, 0.98] },
  // Bleached by the sun rather than lush: a Turkish August is not an English one.
  summer: { ground: [1.08, 1.04, 0.9], foliage: [1, 0.98, 0.84] },
  // Warm and going over.
  autumn: { ground: [1.06, 0.96, 0.82], foliage: [1.18, 0.9, 0.62] },
};

/** Where the snow takes the ground when it is deepest. */
const SNOW: readonly [number, number, number] = [1.34, 1.36, 1.42];

export interface SeasonTint {
  ground: THREE.Color;
  foliage: THREE.Color;
  /** 0..1, for anything that wants to know how deep the winter is. */
  snow: number;
}

const ground = new THREE.Color();
const foliage = new THREE.Color();

/**
 * The tints for a moment in the year. Reuses two colour objects: this is called
 * every frame and a fresh pair each time would be sixty allocations a second for
 * nothing.
 */
export function seasonTint(playedMs: number): SeasonTint {
  const blend = seasonBlend(playedMs);
  const from = LOOKS[blend.season];
  const to = LOOKS[blend.next];
  const snow = snowAmount(playedMs);

  mix(ground, from.ground, to.ground, blend.t);
  mix(foliage, from.foliage, to.foliage, blend.t);
  // Snow lies on the ground and on the branches, and it lies more thickly on the
  // ground: a dusted hillside is white long before a pine is.
  toward(ground, SNOW, snow);
  toward(foliage, SNOW, snow * 0.55);

  return { ground, foliage, snow };
}

function mix(
  out: THREE.Color,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): void {
  out.setRGB(
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  );
}

function toward(out: THREE.Color, target: readonly [number, number, number], t: number): void {
  if (t <= 0) return;
  out.setRGB(
    out.r + (target[0] - out.r) * t,
    out.g + (target[1] - out.g) * t,
    out.b + (target[2] - out.b) * t,
  );
}
