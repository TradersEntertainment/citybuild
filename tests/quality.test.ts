import { describe, expect, it } from 'vitest';
import {
  TIER_HANDHELD_MAX_CSS_PX,
  TIER_MIN_CORES_HIGH,
  TIER_MIN_CORES_MEDIUM,
  TIER_MIN_MEMORY_GB_HIGH,
} from '../src/data/balance';
import {
  decideQualityTier,
  MODULE_TIERS,
  usesOffscreenPasses,
  type DeviceProfile,
  type QualityTier,
} from '../src/render3d/quality';

/**
 * Which devices are allowed to pay for the expensive passes (§36).
 *
 * Six rendering layers landed at once and two of them are genuinely expensive:
 * the post-process chain, which allocates about 99 MB of render targets at a
 * phone's own resolution and adds up to five full-screen passes, and the
 * three-cascade shadow rig, which turns one depth pass a frame into three. The
 * project's standing rule is that a mid-range phone must be able to refuse
 * both, and this file is that rule written down.
 *
 * It is a test of a pure function on purpose. The environment this ships from
 * has no GPU — it runs SwiftShader at one or two frames a second — so there is
 * no honest way to assert that a phone is *fast enough*. What can be asserted,
 * and is asserted here, is that a phone is never *asked*: the decision is a
 * function of numbers a browser reports, and those numbers can be handed to it
 * from a node runner exactly as a handset would.
 *
 * The devices below are real reported values, not invented ones.
 */
function device(profile: Partial<DeviceProfile>): DeviceProfile {
  return {
    width: 1920,
    height: 1080,
    devicePixelRatio: 1,
    hardwareConcurrency: 8,
    ...profile,
  };
}

/** Handsets and tablets, as they actually describe themselves. */
const HANDHELDS: readonly [string, DeviceProfile][] = [
  [
    'iPhone 14 portrait',
    device({ width: 390, height: 844, devicePixelRatio: 3, hardwareConcurrency: 6 }),
  ],
  [
    'iPhone 15 Pro Max portrait',
    device({ width: 430, height: 932, devicePixelRatio: 3, hardwareConcurrency: 6 }),
  ],
  [
    'Android flagship portrait',
    device({
      width: 412,
      height: 915,
      devicePixelRatio: 3.5,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      coarsePointer: true,
    }),
  ],
  [
    'Android flagship landscape',
    device({
      width: 915,
      height: 412,
      devicePixelRatio: 3.5,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      coarsePointer: true,
    }),
  ],
  [
    'mid-range Android portrait',
    device({
      width: 393,
      height: 851,
      devicePixelRatio: 2.75,
      hardwareConcurrency: 8,
      deviceMemory: 4,
      coarsePointer: true,
    }),
  ],
  [
    'budget Android portrait',
    device({
      width: 360,
      height: 780,
      devicePixelRatio: 2,
      hardwareConcurrency: 4,
      deviceMemory: 2,
      coarsePointer: true,
    }),
  ],
  [
    'iPad Air portrait',
    device({ width: 820, height: 1180, devicePixelRatio: 2, coarsePointer: true }),
  ],
  [
    'iPad Pro 12.9 landscape',
    device({ width: 1366, height: 1024, devicePixelRatio: 2, coarsePointer: true }),
  ],
];

describe('the graphics tier a phone is given', () => {
  /**
   * The headline requirement, and the one that would be quietly lost first: a
   * phone at DPR 3 must not be handed the top tier. The dense screen is the
   * trap — it is the signal a naive policy would read as "capable display,
   * therefore capable device", when it is the opposite: the same tier of work
   * over nine times the fragments of a DPR 1 window.
   */
  it('never gives a phone-sized viewport at DPR 3 the high tier', () => {
    const phone = device({
      width: 390,
      height: 780,
      devicePixelRatio: 3,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      coarsePointer: true,
    });
    expect(decideQualityTier(phone)).not.toBe('high');
    // And not by accident of some other veto: strip every excuse the policy
    // has for saying no — sixteen cores, eight gigabytes, a fine pointer — and
    // the size alone must still hold the line.
    const generous = device({
      width: 390,
      height: 780,
      devicePixelRatio: 3,
      hardwareConcurrency: 16,
      deviceMemory: 8,
      coarsePointer: false,
    });
    expect(decideQualityTier(generous)).not.toBe('high');
  });

  it('lands every handheld on low or medium', () => {
    for (const [label, profile] of HANDHELDS) {
      const tier = decideQualityTier(profile);
      expect(['low', 'medium'], label).toContain(tier);
    }
  });

  /**
   * The guarantee the tiers exist for. "Low or medium" would be worth nothing
   * if medium quietly allocated the composer, so the claim is checked against
   * the table rather than against the words.
   */
  it('costs a handheld no off-screen pass, at either tier it can reach', () => {
    for (const [label, profile] of HANDHELDS) {
      expect(usesOffscreenPasses(decideQualityTier(profile)), label).toBe(false);
    }
    expect(usesOffscreenPasses('low')).toBe(false);
    expect(usesOffscreenPasses('medium')).toBe(false);
  });

  /**
   * The other expensive thing, and it is expensive in frames rather than in
   * bytes: three cascades are three depth passes. A handheld gets the single
   * fitted map, which is both cheaper and sharper than what the game shipped
   * before any of this.
   */
  it('never gives a handheld the three-cascade shadow rig', () => {
    for (const [label, profile] of HANDHELDS) {
      expect(MODULE_TIERS[decideQualityTier(profile)].shadows, label).toBe('low');
    }
  });

  it('puts the weakest phones on the floor tier', () => {
    const old = device({
      width: 360,
      height: 640,
      devicePixelRatio: 2,
      hardwareConcurrency: 2,
      deviceMemory: 1,
      coarsePointer: true,
    });
    expect(decideQualityTier(old)).toBe('low');
  });

  /**
   * A tablet is wider than any phone and can only be told apart by its pointer.
   * If that signal is ever dropped from `readDeviceProfile`, this is the test
   * that says what was lost.
   */
  it('recognises a tablet by its pointer rather than by its width', () => {
    const tablet = device({ width: 1024, height: 1366, devicePixelRatio: 2 });
    expect(decideQualityTier({ ...tablet, coarsePointer: true })).toBe('medium');
  });
});

describe('the graphics tier a desktop is given', () => {
  it('gives an ordinary laptop the top tier', () => {
    const laptop = device({
      width: 1920,
      height: 1080,
      devicePixelRatio: 1,
      hardwareConcurrency: 8,
      deviceMemory: 8,
    });
    expect(decideQualityTier(laptop)).toBe('high');
  });

  it('does not punish Safari and Firefox for reporting no memory', () => {
    const noMemory = device({ width: 1680, height: 1050, hardwareConcurrency: 8 });
    expect(decideQualityTier(noMemory)).toBe('high');
  });

  it('holds a four-core desktop at medium however big its screen is', () => {
    const modest = device({ width: 2560, height: 1440, hardwareConcurrency: 4 });
    expect(decideQualityTier(modest)).toBe('medium');
  });

  /**
   * Everything the top tier adds is priced per pixel, so the same machine
   * driving four times the window is not the same machine — and the pixel
   * budget in balance.ts means a 5K window and a Retina laptop panel are the
   * *same* four million pixels, which is why the rule is stated per core rather
   * than per window.
   *
   * This one earns its place by having caught the rule being dead: at the
   * threshold first written, `MAX_DRAWING_PIXELS / TIER_MIN_CORES_HIGH` sat
   * below it, so no eight-core machine could ever trip it whatever the window.
   */
  it('drops a window at the pixel ceiling back to medium unless the cores are there', () => {
    const roomy = device({ width: 1920, height: 1080, hardwareConcurrency: TIER_MIN_CORES_HIGH });
    expect(decideQualityTier(roomy)).toBe('high');

    const vast = { width: 5120, height: 2880, devicePixelRatio: 1 };
    expect(decideQualityTier({ ...vast, hardwareConcurrency: TIER_MIN_CORES_HIGH })).toBe('medium');
    expect(decideQualityTier({ ...vast, hardwareConcurrency: 16 })).toBe('high');

    // A Retina laptop panel is the same ceiling reached a different way.
    const retina = { width: 1920, height: 1080, devicePixelRatio: 2 };
    expect(decideQualityTier({ ...retina, hardwareConcurrency: TIER_MIN_CORES_HIGH })).toBe(
      'medium',
    );
  });

  it('takes an explicit statement of little memory as a veto', () => {
    const thin = device({ deviceMemory: TIER_MIN_MEMORY_GB_HIGH / 2 });
    expect(decideQualityTier(thin)).toBe('medium');
    const thinner = device({ deviceMemory: 2 });
    expect(decideQualityTier(thinner)).toBe('low');
  });

  it('treats a desktop window dragged to phone width as a phone', () => {
    const narrow = device({ width: TIER_HANDHELD_MAX_CSS_PX, height: 1080 });
    expect(decideQualityTier(narrow)).toBe('medium');
    const wider = device({ width: TIER_HANDHELD_MAX_CSS_PX + 1, height: 1080 });
    expect(decideQualityTier(wider)).toBe('high');
  });
});

describe('the decision function itself', () => {
  it('always answers with a tier, whatever nonsense it is handed', () => {
    const nonsense: DeviceProfile[] = [
      device({ width: 0, height: 0 }),
      device({ width: Number.NaN, height: Number.NaN }),
      device({ width: -100, height: -100 }),
      device({ hardwareConcurrency: 0 }),
      device({ hardwareConcurrency: Number.NaN }),
      device({ deviceMemory: Number.NaN }),
      device({ devicePixelRatio: 0 }),
      device({ devicePixelRatio: Number.NaN }),
    ];
    const tiers: readonly QualityTier[] = ['low', 'medium', 'high'];
    for (const profile of nonsense) {
      expect(tiers).toContain(decideQualityTier(profile));
    }
  });

  /**
   * A browser that reports nothing at all is not evidence of a good machine.
   * The assumed core count is deliberately at the medium floor, so silence
   * buys the middle of the ladder and never the top of it.
   */
  it('assumes a modest machine when the browser will not say', () => {
    const silent: DeviceProfile = { width: 1440, height: 900, devicePixelRatio: 1 };
    expect(decideQualityTier(silent)).toBe('medium');
    expect(TIER_MIN_CORES_MEDIUM).toBeLessThan(TIER_MIN_CORES_HIGH);
  });

  it('depends on nothing but its argument', () => {
    const profile = device({ width: 1280, height: 800, hardwareConcurrency: 8 });
    const first = decideQualityTier(profile);
    for (let i = 0; i < 5; i++) expect(decideQualityTier(profile)).toBe(first);
  });
});

describe('what a tier means to each layer', () => {
  it('spells out all three tiers for all six layers', () => {
    for (const tier of ['low', 'medium', 'high'] as const) {
      const tiers = MODULE_TIERS[tier];
      expect(Object.keys(tiers).sort()).toEqual([
        'atmosphere',
        'facadeMaps',
        'post',
        'shadows',
        'terrainDetail',
        'water',
      ]);
    }
  });

  /** A ladder that goes down somewhere is not a ladder. */
  it('never asks for less work at a higher tier', () => {
    const rank = { off: 0, low: 1, medium: 2, high: 3 } as const;
    const order: readonly QualityTier[] = ['low', 'medium', 'high'];
    const layers = ['post', 'shadows', 'terrainDetail', 'water', 'facadeMaps', 'atmosphere'] as const;
    for (const layer of layers) {
      for (let i = 1; i < order.length; i++) {
        const lower = rank[MODULE_TIERS[order[i - 1] as QualityTier][layer]];
        const upper = rank[MODULE_TIERS[order[i] as QualityTier][layer]];
        expect(upper, `${layer} ${order[i - 1]}->${order[i]}`).toBeGreaterThanOrEqual(lower);
      }
    }
  });

  it('reserves the composer for the top tier alone', () => {
    expect(usesOffscreenPasses('high')).toBe(true);
  });
});
