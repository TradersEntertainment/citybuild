/**
 * What was on the road, by year (Paket 2 §5).
 *
 * The city already lives through a century — the buildings restyle, the
 * streetlamps change gas to sodium to LED — and until now the traffic was the
 * one thing that looked the same in 1905 and 2005. A horse cart on a 1900
 * street costs one geometry swap and is the cheapest period detail in the game.
 *
 * Speed is part of the era rather than a separate table. A cart is slow, an
 * early motor car is not much faster, and the reason to care is that a 1910
 * city genuinely takes longer to cross — which is what the road tiers are for.
 */
export type VehicleEra = 'cart' | 'early' | 'modern' | 'flying';

export interface VehicleAge {
  id: VehicleEra;
  /** First year this is what is on the road. */
  from: number;
  /** Multiplies the speed the road tier allows. */
  speed: number;
  /**
   * Body colours. A cart is timber and a Model T is famously any colour you
   * like so long as it is black; the spread only arrives with mass production.
   */
  paints: readonly number[];
}

export const VEHICLE_AGES: readonly VehicleAge[] = [
  {
    id: 'cart',
    from: 0,
    speed: 0.5,
    // Timber, tarpaulin, and the odd painted trap.
    paints: [0x6b4a2f, 0x5a3d28, 0x7c5a38, 0x4a3524, 0x8a6b45],
  },
  {
    id: 'early',
    from: 1920,
    speed: 0.7,
    // Black, black, black, and two that were not.
    paints: [0x1c1c1c, 0x22252a, 0x1a1a1a, 0x3d2b1f, 0x2e3b45],
  },
  {
    id: 'modern',
    from: 1960,
    speed: 1,
    paints: [
      0xb03a2e, 0x2e4053, 0x7d3c98, 0x1d8348, 0xca6f1e, 0xeceded, 0x5d6d7e, 0xf1c40f,
      0x34495e,
    ],
  },
  {
    id: 'flying',
    from: 2050,
    speed: 1.35,
    // Pearl and chrome; the future is not painted in enamel.
    paints: [0xe8eef5, 0xc9d6e4, 0xaebfd0, 0xdfe7ef, 0x9fb3c8],
  },
];

export function vehicleAgeFor(year: number): VehicleAge {
  let chosen = VEHICLE_AGES[0] as VehicleAge;
  for (const age of VEHICLE_AGES) if (year >= age.from) chosen = age;
  return chosen;
}
