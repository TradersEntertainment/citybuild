import * as THREE from 'three';
import { nightAmount, sunHeight } from '../sim/daytime';
import type { WeatherKind } from '../sim/weather';
import { CAMERA_FOV, SEA_Y, WORLD_SIZE } from './constants';

/**
 * The air between the camera and the city, and the sky behind it.
 *
 * Two halves of one idea. The dome draws what the atmosphere looks like when
 * nothing is in the way; the aerial-perspective patch draws what it does to
 * everything that is. They share one function — `atmSkyColour` below is
 * compiled into both — so a hillside at the far edge of the map fades toward
 * *exactly* the pixel the dome would have drawn behind it. That is the whole
 * reason this file exists as one unit rather than as a sky and a fog: the seam
 * between them is the thing that was visible, a grey band under a navy sky,
 * and a seam can only be closed by the two sides agreeing on a number.
 *
 * **It composes, it does not replace.** The day is still the sim's
 * (`sim/daytime.ts`), the weather is still the sim's (`sim/weather.ts`), the
 * lights and the funded-night coupling are still the sky rig's
 * (`render3d/sky.ts`). Nothing here reads a clock of its own or writes a watt.
 * Everything it needs arrives in `update()`, and the one number it could
 * plausibly disagree with the rig about — where the sun is — has a setter so
 * the drawn sun and the shadow-casting key light can be pinned together.
 *
 * **Colour pipeline.** The dome is a `ShaderMaterial`, not a raw one, so
 * three's fragment prefix hands it `toneMapping()` and `linearToOutputTexel()`
 * for free; the shader ends with `#include <tonemapping_fragment>` and
 * `#include <colorspace_fragment>` and therefore lands on the same curve as
 * every lit surface in the city. Every colour uniform here is linear working
 * space, which is what `THREE.Color` stores while `ColorManagement` is on. The
 * aerial mix happens *before* tone mapping — in-scattered light is light, and
 * light rolls off through ACES with everything else — which is why the patch
 * hooks `<opaque_fragment>` rather than `<fog_fragment>`.
 *
 * **Cost.** No render target, no second pass, no texture, no asset. The dome is
 * one full-screen fill *at most*: it is drawn last with `LEQUAL` depth testing
 * against a far-plane pin, so the 60–95% of the frame the ground covers is
 * never shaded. The aerial patch is a few dozen ALU on opaque surfaces and
 * replaces the built-in fog mix it displaces. None of that is a measured frame
 * rate — this repository's environment runs SwiftShader at one or two frames a
 * second and cannot honestly claim one.
 */

// --- Quality -----------------------------------------------------------------

/**
 * The graphics tier. There is no shared tier enum in the project yet; when one
 * lands in src/data/balance.ts this type should become an alias of it and the
 * numbers in this file should move there with it (AGENTS.md: tunables are not
 * inline). The spellings match the other render3d layers that grew their own.
 *
 * - `off`  the dome only. Nothing is patched — a city that starts here never
 *          compiles a patched program at all — and if the setting is lowered to
 *          `off` later, the block that was already compiled skips itself on a
 *          uniform the whole frame agrees about. Nothing is recompiled either
 *          way.
 * - `low`  aerial perspective as distance extinction toward one haze colour,
 *          with the density derived per frame from the camera's own altitude
 *          so it still tracks zoom. No per-fragment sky evaluation.
 * - `high` the full model: the haze layer integrated along the view ray, so a
 *          valley pools and a tower's top floor stands clear of it, and the
 *          in-scattered colour evaluated per fragment so the haze is warm
 *          toward the sun and blue away from it.
 */
export type AtmosphereQuality = 'off' | 'low' | 'high';

/**
 * Where a fresh install starts.
 *
 * `low`, not `off`. The rule is that anything *expensive* hides behind a tier,
 * and `low` is not expensive: it allocates nothing, adds no pass and no
 * texture, and the arithmetic it adds to a fragment (one length, one exp, one
 * mix) is smaller than the built-in fog mix it replaces. `off` exists for a
 * phone that cannot spare even that, and for anyone who needs to prove a
 * regression is not ours.
 */
export const DEFAULT_ATMOSPHERE_QUALITY: AtmosphereQuality = 'low';

// --- The air -----------------------------------------------------------------
//
// Every distance here is in world units, and one world unit is one tile is
// about eight metres. The map is 256 tiles across — two kilometres — and the
// camera sits 34 units out at zoom 1, so the haze has to read across a district
// and not across a continent. The old fog began at 128 units, which is further
// than the top edge of the frustum can see at the zoom the game is played at:
// it contributed exactly nothing, measured, for the whole normal play range.

/**
 * Altitude the haze layer is thickest at. Sea level, because that is where the
 * water and the low ground are and it is a constant rather than a per-frame
 * lookup — haze that chased the terrain under the camera would slide about as
 * the player panned over a hill.
 */
const HAZE_BASE_Y = SEA_Y;

/**
 * How fast the haze thins with altitude, in world units of e-folding.
 *
 * A real aerosol layer has a scale height near 1.2 km, which at this world's
 * scale is 150 units — far taller than the 26 units of relief `HEIGHT_SCALE`
 * allows, so a physically-faithful figure would give a perfectly uniform slab
 * and no pooling at all. 16 units (about 128 m) is chosen against the terrain
 * instead of against the sky: it halves every 11 units, so a valley floor sits
 * in noticeably thicker air than the ridge above it and the top of a level-five
 * tower stands a little clear of the murk its lobby is in.
 */
const HAZE_SCALE_HEIGHT = 16;
const HAZE_FALLOFF = 1 / HAZE_SCALE_HEIGHT;

/**
 * Extinction per world unit at the base altitude, in clear air.
 *
 * Derived from the shot the game is actually played in rather than picked. At
 * zoom 1 the camera is 34 units out at the default polar angle, so it floats
 * about 22 units above the ground and the far ground in frame is roughly 70
 * units away. Through that geometry this density puts about 26% haze on the
 * far ground and about 11% on the near ground — enough separation to read as
 * depth, little enough that nobody would call the day misty. The same number
 * gives about a third at the widest zoom and under a tenth at the tightest,
 * which is the right direction on both counts and costs no zoom term.
 */
const HAZE_DENSITY = 0.008;

/**
 * Ceiling on optical depth before the exponential.
 *
 * Purely a guard. Looking down from the widest zoom the height term is a ratio
 * of two large exponentials that cancel correctly, but a NaN there would paint
 * the whole city one colour, and beyond about 8 the difference between "hazed"
 * and "hazed" is below a bit of colour anyway.
 */
const AERIAL_MAX_OPTICAL_DEPTH = 8;

/**
 * Master multiplier on the haze, and the switch the `off` tier throws.
 *
 * Zero makes the whole block early-out on a uniform the entire frame agrees
 * about, which is the cheap kind of branch — every fragment takes the same
 * side, so there is no divergence to pay for.
 */
const AERIAL_STRENGTH = 1;

/**
 * How much of the way to the ground is left in clear air, as a share of the
 * camera's own height above the haze base.
 *
 * The reason there is a near plane at all: extinction that starts at the lens
 * fogs the foreground, and a fogged foreground is not depth, it is a dirty
 * lens. Aerial perspective is a *comparison* — the eye reads distance from the
 * difference between the near thing and the far thing — so the near thing has
 * to keep its colour or there is nothing to compare against.
 *
 * Scaled from the camera's altitude rather than fixed in world units, because
 * that is the only term available here that tracks zoom: at the default
 * three-quarter view the nearest ground in frame sits at about 1.13 camera
 * heights and the farthest at about 3.2, so 0.55 of a camera height clears the
 * whole first third of the visible ground at every zoom and still leaves two
 * thirds of the far ray in hazy air. At zoom 1 that is 18 units — 145 m — and
 * at the map-wide view 74.
 *
 * Measured through the same geometry as HAZE_DENSITY above, in clear air: the
 * near ground falls from 9.8% haze to 3.5% and the far ground from 25.6% to
 * 20%, so the *separation* the density was chosen for is 16.4 points where it
 * was 15.8. The depth survives; the wash on the foreground does not. Held at
 * every zoom and in every weather by tests/aerial.test.ts.
 */
const HAZE_NEAR_SHARE = 0.75;

/**
 * The most of any surface the air is ever allowed to take, 0..1.
 *
 * Not physics — physics says a hillside 300 units into a fog bank is gone —
 * but this is a game whose subject is a map, and a district that has dissolved
 * completely cannot be played. It is also the only guard that holds when
 * somebody later adds a weather spell, a bigger map or a wider zoom: every
 * other number here is a rate, and rates multiply.
 *
 * 0.62 leaves the far edge of the map recognisably itself — a fifth of a
 * ridge's contrast against the sky, which is enough to see where the coast is
 * — while still reading as distance. In the thickest weather the frame's far
 * band lands here and stops.
 */
const HAZE_MAX_EXTINCTION = 0.62;

/**
 * The share of the haze the sea takes.
 *
 * The one deliberate departure from the model in this file, and it is a
 * framing argument rather than a physical one. Aerial perspective works
 * because the hazed thing is compared against the *sky it fades into*; over
 * land the horizon is in frame, or nearly, and the two resolve. This game's
 * camera looks down, and a coastal shot is two thirds open water running from
 * the shoreline to the top of the frame with no horizon anywhere in it — so
 * the sea has nothing to resolve against and the correct answer, a sheet of
 * sky colour, reads as milk rather than as distance. Measured on the coast
 * frame: the sea's mean saturation goes 152 to 25 at full weight, and the beach
 * beside it ends up *darker* than the water, which is a thing no sea does.
 *
 * Half, so distance still tells on the water and the shoreline still recedes.
 */
export const WATER_HAZE_WEIGHT = 0.5;

/**
 * How far the scene's own linear fog is pushed out relative to the haze curve.
 *
 * `THREE.Fog` is a smoothstep, not an exponential, and it is only what the
 * layers nobody patched will see. Matching the two at the halfway point is the
 * closest a two-parameter ramp gets to a one-parameter curve: `smoothstep`
 * passes 0.5 at the midpoint of its range, and the exponential passes 0.5 at
 * ln 2 over the density — so measured from wherever extinction starts, which
 * is now the near plane rather than the lens, this is 2·ln 2.
 */
const FOG_FAR_FACTOR = 1.386;

// --- The sky -----------------------------------------------------------------
//
// A single-scattering model with the expensive half done on the CPU. What the
// shader keeps is what varies per pixel — the vertical ramp, the Rayleigh phase
// and the Mie lobe around the sun. What moves to `computeAtmosphere` is
// everything that only varies with the sun's height, which is once a frame.
//
// These are colours and the physics that produces them rather than tunables in
// the balance sense, which is the same exception sky.ts:5-9 claims for its
// palette. The difference is that this palette is *derived*: the golden hour is
// not an authored colour that gets lerped in, it is what a low sun does to a
// beam that has to cross six times as much air to reach the eye.

/**
 * Rayleigh scattering strength at 680/550/440 nm, normalised so blue is one.
 *
 * The 1/λ⁴ law, and the only physical constant in the file that is not a
 * choice. It is doing two jobs at once and they are the same job: it is why the
 * sky overhead is blue, and it is why a sun low enough to shine through six air
 * masses arrives red — the light missing from the beam is exactly the light
 * that went into the sky.
 */
const RAYLEIGH: readonly [number, number, number] = [0.1753, 0.4096, 1.0];

/**
 * Floor under the 1/cos air-mass term.
 *
 * The true curve runs to about 38 at the horizon; this tops out at 6.7. Two
 * reasons for the clamp beyond the divide-by-zero: at 38 air masses the sun's
 * blue channel is extinguished to one part in a million, which reads as a
 * bruise rather than a sunset, and the last degree of a real horizon is hidden
 * behind terrain in any case.
 */
const AIRMASS_FLOOR = 0.15;
const AIRMASS_ZENITH = 1 / (1 + AIRMASS_FLOOR);
const AIRMASS_HORIZON = 1 / AIRMASS_FLOOR;

/**
 * How much the beam is extinguished per air mass.
 *
 * Set so noon lands near the colour the project already believed in: at the
 * zenith it gives a sun of #FFF6DF against sky.ts's authored #FFEDC4 — the same
 * warm near-white, arrived at from the air mass rather than picked. What
 * matters more is the other end. At nine degrees of elevation the same term
 * gives (1, 0.73, 0.33) and at the horizon (1, 0.52, 0.10), with no second
 * curve and no special case for dusk. That is the entire point: there is a
 * golden hour now because there is a reason for one.
 */
const SUN_EXTINCTION = 0.42;

/**
 * How much light the view ray scatters into the eye per air mass.
 *
 * The saturation knob of the whole sky. Low values leave the untouched
 * Rayleigh ratio, which is a pale wash; high values saturate every channel
 * toward white and flatten the gradient. 1.2 puts the noon zenith at #3C8AB5
 * against sky.ts's authored #3574B4 — the same blue, half a step lighter and
 * arrived at from the scattering rather than from a colour picker. It is also
 * no longer a constant: the same term walks the zenith to #4185A2 as the sun
 * drops to nine degrees, which is a sky changing rather than a sky fading.
 */
const RAYLEIGH_DEPTH = 1.2;

/**
 * How much of the sun's own air mass the sky *overhead* is lit through.
 *
 * One air mass for the whole dome is the model's biggest simplification and the
 * only one that produced a visibly wrong colour: at sunset it lit the zenith
 * with the same six-air-mass beam that reddens the horizon, and since blue is
 * extinguished harder than green while blue scatters harder than green, the
 * product peaked in the middle and the sky went pond-green ten minutes before
 * dusk. It is wrong because the light reaching the zenith at sunset never
 * crossed the low path — it grazed the top of the atmosphere, where there is
 * hardly any. A fifth of the way is enough to fix it and leaves the noon sky
 * where it was, because at noon the two paths are the same length anyway.
 */
const ZENITH_BEAM_SHARE = 0.2;

/** Overall brightness of the scattered sky. Trims the model to the palette. */
const SKY_GAIN = 0.82;

/**
 * Saturation applied to the sky body and to the horizon, separately.
 *
 * They differ because the physics differs. The zenith is nearly pure single
 * scattering, which is the saturated part, and the model under-reads it because
 * it integrates one bounce; the horizon is dominated by multiple scattering and
 * by aerosols, both of which are close to achromatic. One saturation figure for
 * both put a green cast on the horizon, which is the sky's own luminance peak
 * being amplified where there was no hue to amplify.
 */
const ZENITH_SATURATION = 1.85;
const HORIZON_SATURATION = 0.9;

/**
 * A blue lean on the horizon band.
 *
 * The correction for the bounce this model does not integrate: multiple
 * scattering is blue-weighted, so a single-scatter horizon comes out slightly
 * too warm. Small, and the only hand-placed colour in the daytime sky.
 */
const HORIZON_TINT: readonly [number, number, number] = [0.92, 0.985, 1.16];

/**
 * How much of the horizon band is aerosol rather than sky, and how much
 * brighter the aerosol is than the sky it sits in front of.
 *
 * The band that makes the map's edge stop being an edge, and the band a sunset
 * happens in. Its colour is taken from the *beam* rather than from the sky,
 * which is the one non-obvious thing in this file and the reason it works:
 * Mie scattering barely depends on wavelength, so an aerosol layer returns the
 * spectrum it was handed — white at noon because the sun is white, amber at
 * dusk because the sun is amber. Deriving it from the Rayleigh horizon instead,
 * which is what an authored dusk colour does by hand, gives a khaki band at
 * sunset: the horizon sky's own red is the one channel a long path has not
 * finished saturating, so it is the one that comes up short exactly when it is
 * needed most. Measured across the change, at two degrees of sun elevation:
 * #918763 before, #A48A62 after, and the Mie lobe then takes the sunward side
 * of it well past display white.
 */
const MIE_ACHROMA = 0.7;
const MIE_GAIN = 1.12;

/** Asymmetry of the Mie phase function: strongly forward, as aerosols are. */
const MIE_G = 0.76;

/**
 * Strength of the forward lobe in the sky.
 *
 * Small, because the Henyey-Greenstein peak is worth thirty at zero degrees.
 * This is the term that makes the sky brighter *toward* the sun and bluer away
 * from it — the difference between a sunset and an orange filter over the whole
 * dome, which is what a single horizon colour can only ever be.
 */
const MIE_GLOW = 0.03;

/**
 * How far up the dome the haze band reaches, as a sine of elevation.
 *
 * Peaks at the horizon and decays both ways, because the band is a layer seen
 * edge-on rather than a floor: it thins going up into clear air and going down
 * into ground that is nearer and therefore less of it.
 *
 * Tight — about three degrees — because of how little sky this camera ever
 * shows. The rig looks down at 40.7° at its default polar angle and 16.7° at
 * its lowest, against a 45° vertical field: the top edge of the frame is
 * eighteen degrees *below* the horizon in normal play and less than six degrees
 * above it at full tilt. A band lifted any higher than this would be the only
 * sky the map view ever sees, and every clear noon would read as overcast. Walk
 * mode is the exception that proves it — there the horizon is centred, the band
 * sits where a real one does, and the blue above it is finally in frame.
 */
const HAZE_LIFT = 0.06;
/** How completely the haze takes over where it is thickest. */
const HAZE_MIX = 0.72;

/** Where the dome's ground half takes over from its sky half. */
const GROUND_FADE = 0.12;
/** The ground half is the sky's own luminance, darkened and warmed by earth. */
const GROUND_DARKEN = 0.42;
const GROUND_WARM: readonly [number, number, number] = [1.14, 1.02, 0.84];

/**
 * The stretch of sun height over which the sky keeps its daylight colour.
 *
 * Not `daylightAmount` from the sim, deliberately: that saturates at a sun
 * height of 0.3 because it answers "how much of the sun's light reaches the
 * ground", and a sky is still plainly lit long after the ground is not. Civil
 * twilight ends around six degrees below the horizon and astronomical twilight
 * around eighteen; -0.30 is the latter, and it is why the sky here goes on
 * glowing after sunset instead of switching off with the key light.
 *
 * It moves colours only. No light intensity in this project is computed from
 * it, so it cannot argue with the night rig or with what the ledger pays.
 */
const SKY_LIGHT_FLOOR = -0.3;
const SKY_LIGHT_CEIL = 0.04;

/**
 * Radiance of the sun's disc, in linear working space.
 *
 * Well above one on purpose. Under ACES at the renderer's exposure a value of
 * one is barely on the shoulder, which is how the sun ended up as a flat cream
 * dot while every other bright thing in the frame rolled off; at twelve it
 * clips the way a source clips, with a falloff at its edge. It is also the one
 * value in the scene a bloom threshold could separate from sunlit ground
 * without guessing, should a composer ever arrive.
 */
const SUN_DISC_RADIANCE = 12;

/**
 * Angular radius of the sun and the moon, in radians.
 *
 * Both are about 0.0047 rad from Earth, which at this game's 45° field over a
 * 780-pixel-tall phone is under five pixels — too small to read as anything.
 * These are roughly two and a half times life size, which is the usual lie, and
 * the halo does the rest of the work.
 */
const SUN_ANGULAR_RADIUS = 0.012;
const MOON_ANGULAR_RADIUS = 0.014;

/** Width of the tight bloom hugging the disc, and of the wide glare beyond it. */
const SUN_HALO_SIGMA = 0.06;
const SUN_GLARE_SIGMA = 0.34;

/** How far the sun has to sink before the moon is at full strength. */
const MOON_RISE = 0.25;

/**
 * The night palette, carried over from sky.ts unchanged.
 *
 * Scattering gives black once the sun is eighteen degrees down, which is
 * correct and unplayable. These three colours are the ones the game was
 * playtested against and they are not this file's to re-pick; see the note at
 * sky.ts:26-42 for why the night's legibility is a baseline rather than a
 * reward. What is new is only that the day now arrives at its own colours
 * rather than lerping toward these from an authored pair.
 */
const NIGHT_ZENITH = new THREE.Color('#0A1330');
const NIGHT_HORIZON = new THREE.Color('#2A3A63');
const NIGHT_GROUND = new THREE.Color('#151C2C');
/** The haze band after dark: the horizon band, lifted, as a layer seen edge-on. */
const NIGHT_HAZE = new THREE.Color('#3B4C78');
const MOON_COLOUR = new THREE.Color('#C4D2F0');

/**
 * Light pollution: the sodium dome a lit city puts over itself.
 *
 * The funded night, seen from outside. `lightingShare` already drives the sky
 * bounce and the lamps and the ledger; this is the same number reaching the one
 * place it obviously should and did not — the sky above the city it paid to
 * light. It touches the horizon and the haze only, never the zenith, because
 * the source is on the ground.
 */
const LIGHT_POLLUTION = new THREE.Color('#7A4C22');
const LIGHT_POLLUTION_MIX = 0.4;

// --- Weather -----------------------------------------------------------------

interface WeatherLook {
  /** Cloud cover the dome draws, 0..1. */
  cloud: number;
  /** Multiplier on the haze density: what the air is carrying. */
  haze: number;
  /** How far the whole dome falls toward grey. A storm has no hue to speak of. */
  drain: number;
}

/**
 * What each spell does to the air.
 *
 * The sim owns which spell it is and what it costs (sim/weather.ts); this is
 * only what it looks like. Heat is the interesting one: it is the clearest sky
 * in the table and also the second haziest, because a hot afternoon has no
 * cloud and a great deal of dust — which is exactly the look a Turkish August
 * has and the reason the season tint bleaches rather than saturates.
 *
 * **The multipliers were cut hard, and here is why.** They were authored
 * against the old scene fog, which began at 128 world units — further than the
 * top of the frustum can see at the zoom the game is played at — so a factor of
 * 4.5 multiplied something that was contributing nothing and never showed up.
 * Against the model in this file they multiply a curve that is doing real work,
 * and a factor of 4.5 is a whiteout: measured on the city frame in fog weather,
 * extinction reached 38% on the *nearest* geometry in shot and 73% at the top
 * of the frame, and the whole district came out a flat grey card. Nobody who
 * looked at that picture could tell it was meant to be a foggy day — which is
 * the tell that it had stopped being weather and started being a fault.
 *
 * So the ceiling is now two, and the ladder keeps its order and its spacing:
 * fog is still the thickest air in the game and clear is still clear. What a
 * spell buys is a legible change in depth, not the loss of the city.
 */
const WEATHER_LOOKS: Readonly<Record<WeatherKind, WeatherLook>> = {
  clear: { cloud: 0.22, haze: 1, drain: 0 },
  rain: { cloud: 0.86, haze: 1.35, drain: 0.45 },
  storm: { cloud: 0.97, haze: 1.5, drain: 0.62 },
  heat: { cloud: 0.06, haze: 1.25, drain: 0.1 },
  fog: { cloud: 0.55, haze: 2, drain: 0.35 },
};

/**
 * Hard ceiling on the weather multiplier, applied to whatever the table says.
 *
 * Belt as well as braces. The numbers above are a judgement about how a spell
 * should look and somebody will reasonably want to move one; this is the
 * separate promise that no spell, however it is retuned, can multiply the air
 * past the point where the city stops being readable. Together with
 * HAZE_MAX_EXTINCTION it bounds the worst frame the weather can produce
 * without anyone having to re-derive the geometry.
 */
const MAX_HAZE_GAIN = 2;

/**
 * Fraction of a spell spent arriving and leaving.
 *
 * The same 0.08 the rain streaks use (weatherFx.ts:95), and it has to be the
 * same: the drops and the air they fall through are one weather, and two fades
 * of different lengths would have the sky clear while it was still raining.
 */
const WEATHER_EDGE = 0.08;

// --- Clouds ------------------------------------------------------------------

/** Value-noise octaves per tier. The dominant per-pixel cost of the dome. */
const CLOUD_OCTAVES: Readonly<Record<AtmosphereQuality, number>> = {
  off: 2,
  low: 3,
  high: 4,
};

/** Drift, in dome units per second. Slow enough to notice only if you watch. */
const CLOUD_DRIFT_X = 0.0062;
const CLOUD_DRIFT_Z = 0.0024;

/**
 * Drawn last, with depth testing on.
 *
 * The dome's vertex shader pins it to the far plane, so with `LEQUAL` every
 * pixel the city already covers fails the test and is never shaded. In the
 * captured frames the ground covers between 60% and 95% of the screen, so this
 * is most of the sky's cost given back for one line — and it is what pays for
 * the aerial-perspective patch on the surfaces that did cover it. Two
 * preconditions, both true here and both worth knowing if they ever change: the
 * depth buffer must be cleared to 1.0 (three's `autoClear`), and the renderer
 * must not be in reversed-depth or logarithmic-depth mode.
 */
const SKY_RENDER_ORDER = 1000;

// --- Shared GLSL -------------------------------------------------------------
//
// Everything the dome and the aerial patch both need, so the two cannot drift
// apart. Every identifier is prefixed `atm`: these strings are spliced into
// materials that other layers have already injected their own helpers into
// (terrain.ts's water is the standing precedent), and a second `hash21` in the
// same translation unit is a redefinition error rather than a wrong pixel.

/** GLSL has no integer/float coercion in expressions; write every number out. */
function glsl(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

const SKY_UNIFORMS = /* glsl */ `
uniform vec3 atmSunDirection;
uniform vec3 atmSunColour;
uniform vec3 atmZenith;
uniform vec3 atmHorizon;
uniform vec3 atmHaze;
uniform vec3 atmHazeAway;
uniform vec3 atmGround;
uniform float atmGlow;
uniform float atmHazeLift;
`;

/**
 * The scattered sky in one direction, without the sun's disc, the moon, the
 * stars or the clouds.
 *
 * Split out at exactly this line because it is what an aerial-perspective
 * lookup wants. The dome starts from it and adds the objects in the sky; a
 * hazed fragment ends at it. Fully hazed ground and open sky therefore come out
 * of the same expression with the same uniforms, and the band that used to sit
 * between them cannot exist.
 *
 * The two callers differ in exactly two terms, which is why they are arguments
 * rather than a copy of the function:
 *
 * - `bandAmount` — how much of the aerosol layer this ray is looking through.
 *   The dome looks *across* the band, so it peaks at the horizon and falls away
 *   both up and down. A ray from the camera down to the ground is *inside* it
 *   for its whole length, so it never falls away at all.
 * - `groundAmount` — the dome's below-horizon half, which is the far side of
 *   the map. It is a thing being looked at, not a source, so it has no business
 *   in an in-scattering term: leaving it in made distant ground fade toward a
 *   dark khaki instead of washing out, which is aerial perspective backwards.
 */
const SKY_FUNCTION = /* glsl */ `
vec3 atmScatter(vec3 dir, float bandAmount, float groundAmount) {
  float up = dir.y;

  // How much air this direction looks through, relative to straight up.
  float airMass = 1.0 / (max(up, 0.0) + ${glsl(AIRMASS_FLOOR)});
  float band = clamp(
    (airMass - ${glsl(AIRMASS_ZENITH)}) / ${glsl(AIRMASS_HORIZON - AIRMASS_ZENITH)},
    0.0,
    1.0
  );
  // Curved past linear so the pale band stays where the air mass actually runs
  // away — the last ten degrees — instead of climbing the whole dome. This is
  // the term the camera angle argues with hardest: at the rig's lowest tilt the
  // frame tops out under six degrees of elevation, so anything that pushes
  // horizon colour further up is a sky the player only ever sees the washed-out
  // bottom of.
  vec3 colour = mix(atmZenith, atmHorizon, band * sqrt(band));
  colour = mix(colour, atmGround, groundAmount);

  // Rayleigh's own phase function. Symmetric, so it deepens the sky both toward
  // the sun and directly away from it and takes its minimum at a right angle —
  // which is where a clear sky really is at its most saturated.
  float mu = dot(dir, atmSunDirection);
  colour *= mix(1.0, 0.75 * (1.0 + mu * mu), 0.35);

  // The aerosol layer: warm on the sun's side and cool on the other, because
  // forward-scattered sunlight travels in one direction. One horizon colour for
  // the whole ring is an orange filter over the dome rather than a sunset, and
  // it is why the sky behind the player used to be as orange as the sky in
  // front of them. Cubed, so the warmth stays in roughly the near half.
  float toward = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
  toward = toward * toward * toward;
  colour = mix(colour, mix(atmHazeAway, atmHaze, toward), bandAmount * ${glsl(HAZE_MIX)});

  // Mie forward scattering. The reason the sky near a setting sun is a glow
  // rather than a ring, and the reason the sky behind the player stays blue.
  float denom = 1.0 + ${glsl(MIE_G * MIE_G)} - ${glsl(2 * MIE_G)} * mu;
  float mie = ${glsl(1 - MIE_G * MIE_G)} / (denom * sqrt(max(denom, 1e-4)));
  colour += atmSunColour * mie * atmGlow;

  return colour;
}

/** Looking out at the sky: across the haze band, and down onto the far map. */
vec3 atmDomeColour(vec3 dir) {
  return atmScatter(
    dir,
    exp(-abs(dir.y) / atmHazeLift),
    smoothstep(0.0, ${glsl(GROUND_FADE)}, -dir.y)
  );
}

/** Looking along a ray through the air at something: inside the band, no ground. */
vec3 atmAerialColour(vec3 dir) {
  return atmScatter(dir, exp(-max(dir.y, 0.0) / atmHazeLift), 0.0);
}
`;

// --- The dome ----------------------------------------------------------------

const DOME_VERTEX = /* glsl */ `
  varying vec3 vAtmDirection;
  void main() {
    vAtmDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Pin to the far plane. With LEQUAL depth this is what lets the dome be
    // drawn after the city and shade only what the city did not cover.
    gl_Position.z = gl_Position.w;
  }
`;

/**
 * The dome's fragment shader, built per tier because the cloud octave count is
 * a loop bound and a loop bound is source, not a uniform.
 *
 * Ends on the two includes that were missing from the sky this replaces. The
 * dome was writing linear values straight into an sRGB drawing buffer while
 * every other surface went through ACES and the encode, which is why the same
 * hex came out as two different pixels and why the fog could not possibly match
 * the horizon it was copied from.
 */
function domeFragment(quality: AtmosphereQuality): string {
  const octaves = CLOUD_OCTAVES[quality];
  // Amplitude halves each octave; normalising by the sum keeps a given cover
  // value meaning the same thing at every tier, so changing the graphics
  // setting cannot change the weather.
  let amplitudeSum = 0;
  for (let i = 0; i < octaves; i++) amplitudeSum += 0.55 * Math.pow(0.5, i);

  return /* glsl */ `
  ${SKY_UNIFORMS}
  uniform vec3 atmMoonDirection;
  uniform vec3 atmMoonColour;
  uniform vec2 atmSunDisc;
  uniform vec2 atmMoonDisc;
  uniform float atmSunUp;
  uniform float atmMoon;
  uniform float atmNight;
  uniform float atmCloud;
  uniform float atmTime;
  varying vec3 vAtmDirection;

  float atmHash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float atmVnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(atmHash21(i), atmHash21(i + vec2(1.0, 0.0)), u.x),
      mix(atmHash21(i + vec2(0.0, 1.0)), atmHash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float atmFbm(vec2 p) {
    float v = 0.0;
    float a = 0.55;
    for (int i = 0; i < ${octaves}; i++) {
      v += a * atmVnoise(p);
      p = p * 2.03 + vec2(17.0, 9.0);
      a *= 0.5;
    }
    return v / ${glsl(amplitudeSum)};
  }

  ${SKY_FUNCTION}

  void main() {
    vec3 dir = normalize(vAtmDirection);
    vec3 colour = atmDomeColour(dir);

    // The sun. Its edge is softened by one pixel's worth of angle rather than
    // by a fixed number, so the disc is the same crispness on a phone at
    // devicePixelRatio 3 as on a desktop window.
    float mu = dot(dir, atmSunDirection);
    float disc = smoothstep(atmSunDisc.x, atmSunDisc.y, mu);
    // Two Gaussians in angle: a tight bloom hugging the disc and a wide glare
    // beyond it. Written against (1 - mu), which is half the squared angle for
    // any angle small enough to matter, so neither needs an acos.
    float bloom = exp(-2.0 * (1.0 - mu) / ${glsl(SUN_HALO_SIGMA * SUN_HALO_SIGMA)});
    float glare = exp(-2.0 * (1.0 - mu) / ${glsl(SUN_GLARE_SIGMA * SUN_GLARE_SIGMA)});
    // The disc and its bloom set with the sun; the wide glare does not, because
    // a sun just under the horizon is exactly when the sky above it burns.
    colour += atmSunColour * ((disc + bloom * 0.35) * atmSunUp + glare * 0.10);

    // The moon rides the anti-sun, so it is exactly as far above the horizon as
    // the sun is below it and needs no second clock to stay in step. It ramps
    // from zero at the crossing because the shared direction flips through 180°
    // there, and a lit moon at that instant would jump across the sky.
    if (atmMoon > 0.001) {
      float moonMu = dot(dir, atmMoonDirection);
      float moonDisc = smoothstep(atmMoonDisc.x, atmMoonDisc.y, moonMu);
      float moonHalo = exp(-2.0 * (1.0 - moonMu) / 0.0225);
      colour += atmMoonColour * (moonDisc + moonHalo * 0.22) * atmMoon;
    }

    // Stars, before the clouds so a cloud can cover them. Hashed on a coarse
    // grid of the view direction: a real starfield is a texture or a point
    // cloud, and both cost more than a game nobody plays looking up can spend.
    if (atmNight > 0.01 && dir.y > 0.0) {
      vec2 grid = dir.xz / (dir.y + 0.35) * 34.0;
      vec2 cell = floor(grid);
      vec2 within = fract(grid) - 0.5;
      float pick = atmHash21(cell);
      if (pick > 0.86) {
        // Jittered inside its cell, or the night sky is graph paper.
        vec2 offset = vec2(atmHash21(cell + 3.1), atmHash21(cell + 7.7)) - 0.5;
        float star = smoothstep(0.09, 0.0, length(within - offset * 0.6));
        float twinkle = 0.65 + 0.35 * sin(atmTime * 1.7 + pick * 40.0);
        // Faded out toward the horizon, where the haze owns the view.
        star *= smoothstep(0.03, 0.3, dir.y);
        colour += vec3(0.85, 0.9, 1.0) * star * twinkle * atmNight * (pick - 0.86) * 7.0;
      }
    }

    // Clouds: the view direction projected onto a plane overhead, drifting.
    // A clear sky is a screensaver; moving weather is a place.
    if (dir.y > 0.015 && atmCloud > 0.005) {
      vec2 cloudUv = dir.xz / (dir.y + 0.22);
      cloudUv = cloudUv * 1.15 + vec2(atmTime * ${glsl(CLOUD_DRIFT_X)}, atmTime * ${glsl(CLOUD_DRIFT_Z)});
      float cover = atmFbm(cloudUv);
      // The threshold walks with the weather rather than the opacity: an
      // overcast sky is more cloud, not the same cloud painted harder.
      float edge = mix(0.72, 0.22, atmCloud);
      float cloud = smoothstep(edge, edge + 0.2, cover);
      cloud *= smoothstep(0.02, 0.2, dir.y);
      float shade = atmFbm(cloudUv * 2.31 + 4.7);
      vec3 cloudColour = mix(vec3(0.55, 0.57, 0.62), vec3(1.15, 1.12, 1.06), shade);
      // Lit from the sun's side, so a cloud between the player and a low sun
      // has a bright rim rather than the same grey it had at noon.
      cloudColour += atmSunColour * 0.18 * pow(clamp(mu, 0.0, 1.0), 3.0);
      cloudColour = mix(cloudColour, vec3(0.07, 0.09, 0.15), atmNight);
      colour = mix(colour, cloudColour, cloud * 0.85);
    }

    gl_FragColor = vec4(colour, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

// --- Aerial perspective ------------------------------------------------------

/**
 * Uniforms only the patched materials read. Kept separate from the sky's so the
 * dome does not carry six uniforms it has no use for.
 */
const AERIAL_UNIFORMS = /* glsl */ `
uniform float atmDensity;
uniform float atmLinearDensity;
uniform float atmStrength;
uniform float atmNear;
uniform vec3 atmFlatHaze;
varying vec3 vAtmWorld;

// How much of the haze this material takes. One unless the patch wrote a
// weight, which only the sea does — see WATER_HAZE_WEIGHT.
#ifndef ATM_HAZE_WEIGHT
  #define ATM_HAZE_WEIGHT 1.0
#endif
`;

/**
 * The world position of the fragment, mirroring three's own `worldpos_vertex`.
 *
 * Written out rather than reused because three only declares `worldPosition`
 * when the material happens to need it for an env map, a shadow or a spot
 * light, and this has to work on a road surface that needs none of them. The
 * batching and instancing branches are three's, in three's order: almost every
 * caster in this city is an `InstancedMesh`, and dropping the instance matrix
 * would put every building in a district at the same depth in the haze.
 */
const AERIAL_VERTEX_BODY = /* glsl */ `
vec4 atmWorld = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  atmWorld = batchingMatrix * atmWorld;
#endif
#ifdef USE_INSTANCING
  atmWorld = instanceMatrix * atmWorld;
#endif
vAtmWorld = (modelMatrix * atmWorld).xyz;
`;

/**
 * The mix itself, spliced in after `<opaque_fragment>` — before tone mapping,
 * not after it.
 *
 * `<fog_fragment>`, where three puts its own fog, runs after
 * `<colorspace_fragment>`: the built-in mix happens in display space on an
 * already-encoded colour. That is self-consistent for a flat colour and wrong
 * for this, because in-scattered light is light. Mixing here means the haze
 * rolls through ACES with the surface it is covering, which is the only way a
 * fully hazed hillside and the open dome above it can resolve to the same
 * pixel. The built-in chunk is emptied in the same patch so nothing fogs twice.
 */
function aerialFragmentBody(quality: AtmosphereQuality): string {
  const heightIntegrated = quality === 'high';
  return /* glsl */ `
if (atmStrength > 0.0) {
  vec3 atmDelta = vAtmWorld - cameraPosition;
  float atmRange = length(atmDelta);
  // Distance *through hazy air*, which starts at the near plane and not at the
  // lens. Everything closer than that is drawn in clear air, so the foreground
  // keeps the colour the far field is going to be compared against. Kept apart
  // from atmRange because the direction below still needs the real one: a
  // fragment inside the near plane has zero optical path and a perfectly good
  // bearing.
  float atmDist = max(0.0, atmRange - atmNear);
  ${
    heightIntegrated
      ? /* glsl */ `
  // The analytic integral of an exponential-in-altitude density along the view
  // ray. The bracket is (1 - e^-T)/T, which tends to one as the ray flattens —
  // guarded rather than branched because the guard is a compare and the branch
  // would be a divergence across every silhouette in the frame.
  float atmT = atmDelta.y * ${glsl(HAZE_FALLOFF)};
  float atmRamp = abs(atmT) < 1e-4 ? 1.0 : (1.0 - exp(-atmT)) / atmT;
  float atmTau = atmDensity
    * exp(-(cameraPosition.y - ${glsl(HAZE_BASE_Y)}) * ${glsl(HAZE_FALLOFF)})
    * atmDist * atmRamp;`
      : /* glsl */ `
  // Uniform density, at the strength the height-integrated form would give
  // along the ray the camera is actually looking down. Same curve for a
  // horizontal ray, and no per-fragment altitude term.
  float atmTau = atmLinearDensity * atmDist;`
  }
  // Clamped, so no surface anywhere ever dissolves completely into the air —
  // see HAZE_MAX_EXTINCTION. The weight is one for everything but the sea.
  float atmExtinction = min(
    ${glsl(HAZE_MAX_EXTINCTION)},
    (1.0 - exp(-min(atmTau, ${glsl(AERIAL_MAX_OPTICAL_DEPTH)}))) * atmStrength
  ) * ATM_HAZE_WEIGHT;
  ${
    heightIntegrated
      ? `vec3 atmIn = atmAerialColour(atmDelta / max(atmRange, 1e-4));`
      : `vec3 atmIn = atmFlatHaze;`
  }
  #ifdef ATM_EMISSIVE_SURFACE
    // An additively blended surface is a source, not a lit surface: the air in
    // front of it takes light out of it and puts none back, because whatever
    // the haze scatters in was already counted by the surface behind it.
    gl_FragColor.rgb *= 1.0 - atmExtinction;
  #else
    gl_FragColor.rgb = mix(gl_FragColor.rgb, atmIn, atmExtinction);
  #endif
}
`;
}

// --- The derived look --------------------------------------------------------

/** What one frame of sky looks like, before any of it reaches the GPU. */
export interface AtmosphereLook {
  /** Straight up. */
  readonly zenith: THREE.Color;
  /** The band at eye level. */
  readonly horizon: THREE.Color;
  /**
   * The aerosol band on the sun's side of the sky, and what distance in that
   * direction fades into.
   */
  readonly haze: THREE.Color;
  /** The same band on the opposite side, where no sunlight is scattering forward. */
  readonly hazeAway: THREE.Color;
  /** Below the horizon, which is only ever seen past the edge of the map. */
  readonly ground: THREE.Color;
  /** The disc, in linear radiance: reddened and dimmed by its own air mass. */
  readonly sun: THREE.Color;
  /**
   * Whether the disc itself is above the horizon, 0..1.
   *
   * Separate from `glow` because the two outlive each other in opposite
   * directions: the sky goes on glowing for a good while after the sun has set,
   * and the disc must not — the dome's ground half is visible past the edge of
   * the map, and without this a sun sat in it after dark.
   */
  sunUp: number;
  /** Strength of the Mie lobe around the sun. Zero once the sun is well down. */
  glow: number;
  /** How high up the dome the haze band reaches. */
  hazeLift: number;
  /** Cloud cover the dome should draw, 0..1. */
  cloud: number;
  /** The moon's strength, 0..1. Rises as the sun sets, on the anti-sun. */
  moon: number;
  /** 0..1 from the sim's clock, shared with the lamps and the lit windows. */
  night: number;
  /** Extinction per world unit at the haze base, weather included. */
  density: number;
  /** Extinction per world unit along the ray the camera is looking down. */
  linearDensity: number;
  /**
   * How much of the view ray is drawn in clear air, in world units.
   *
   * Derived from the camera's own height rather than fixed, so it widens with
   * the zoom the same way the visible ground does — see HAZE_NEAR_SHARE.
   */
  nearOffset: number;
}

export interface AtmosphereInput {
  /** 0..1 from sim/daytime.ts. */
  dayFraction: number;
  /** The spell the sim is in, and how far through it (sim/weather.ts). */
  weather: WeatherKind;
  weatherProgress: number;
  /** 0..1 from sim/investments.ts: what the city paid to light itself. */
  lighting: number;
  /** Camera altitude in world units. Sets how much haze is between it and the ground. */
  cameraAltitude: number;
}

/**
 * Everything about the sky that depends only on the clock, the weather and
 * where the camera is — which is to say, everything that would be wasted work
 * in a fragment shader.
 *
 * Pure and allocation-free: it writes into the `look` it is handed. Exported
 * because the arithmetic is the part of a renderer a test runner with no GPU
 * can actually check, which is the same bargain tests/night.test.ts strikes
 * with the light rig.
 */
export function computeAtmosphere(input: AtmosphereInput, look: AtmosphereLook): void {
  const height = sunHeight(input.dayFraction);
  const night = nightAmount(input.dayFraction);
  look.night = night;
  look.moon = clamp01(-height / MOON_RISE);

  // Weather arrives and leaves rather than switching, on the same edge the rain
  // streaks use — the drops and the air they fall through are one weather.
  const spell = WEATHER_LOOKS[input.weather];
  const edge = Math.min(1, Math.min(input.weatherProgress, 1 - input.weatherProgress) / WEATHER_EDGE);
  const cloud = lerp(WEATHER_LOOKS.clear.cloud, spell.cloud, edge);
  const hazeGain = Math.min(
    MAX_HAZE_GAIN,
    lerp(WEATHER_LOOKS.clear.haze, spell.haze, edge),
  );
  const drain = lerp(0, spell.drain, edge);
  look.cloud = cloud;

  // How much sunlight the sky is still receiving. The colours below are all
  // scattered sunlight, so they fade together and the night takes over beneath.
  const skyLight = smoothstep(SKY_LIGHT_FLOOR, SKY_LIGHT_CEIL, height);

  // The beam, after crossing however much air its own elevation demands. Both
  // the sun's colour and the sky's start here, which is why the golden hour and
  // the pink horizon that goes with it cannot get out of step.
  const airMass = 1 / (Math.max(height, 0) + AIRMASS_FLOOR);
  const beamR = Math.exp(-RAYLEIGH[0] * SUN_EXTINCTION * airMass);
  const beamG = Math.exp(-RAYLEIGH[1] * SUN_EXTINCTION * airMass);
  const beamB = Math.exp(-RAYLEIGH[2] * SUN_EXTINCTION * airMass);

  // The sky overhead is lit through a shorter path than the horizon is.
  const highAir = lerp(1, airMass, ZENITH_BEAM_SHARE) * SUN_EXTINCTION;
  scatter(
    look.zenith,
    AIRMASS_ZENITH,
    Math.exp(-RAYLEIGH[0] * highAir),
    Math.exp(-RAYLEIGH[1] * highAir),
    Math.exp(-RAYLEIGH[2] * highAir),
  );
  look.zenith.multiplyScalar(SKY_GAIN * skyLight);
  saturate(look.zenith, ZENITH_SATURATION);

  scatter(look.horizon, AIRMASS_HORIZON, beamR, beamG, beamB);
  look.horizon.multiply(tint(HORIZON_TINT));
  look.horizon.multiplyScalar(SKY_GAIN * skyLight);
  saturate(look.horizon, HORIZON_SATURATION);

  // The aerosol band: the beam's hue at the sky's brightness. Dividing out the
  // beam's own luminance is what leaves only the hue, so the band tracks the
  // sun's colour without also tracking how much of it there is — which the
  // Rayleigh term has already accounted for.
  const beamLuminance = Math.max(1e-4, luminance(beamR, beamG, beamB));
  const bandLuminance =
    luminance(look.horizon.r, look.horizon.g, look.horizon.b) * MIE_GAIN;
  look.haze.setRGB(beamR, beamG, beamB).multiplyScalar(bandLuminance / beamLuminance);
  look.haze.lerp(look.horizon, 1 - MIE_ACHROMA);

  // The same band away from the sun, where there is no forward scattering to
  // colour it: the sky's own hue, drained and lifted. At noon the two are
  // within a shade of each other; at sunset one is amber and the other is the
  // cold blue-grey that sits opposite it, which is the whole difference between
  // a sunset and a filter.
  look.hazeAway.copy(look.horizon);
  saturate(look.hazeAway, 1 - MIE_ACHROMA);
  look.hazeAway.multiplyScalar(MIE_GAIN);

  // The ground half of the dome: the horizon's luminance, darkened and warmed
  // by the earth it is bouncing off.
  look.ground.copy(look.horizon);
  saturate(look.ground, 0.25);
  look.ground.multiply(tint(GROUND_WARM)).multiplyScalar(GROUND_DARKEN);

  // Night. Blended rather than switched, on the same curve the lamps come up
  // on, so the sky finishes going dark exactly when the windows finish lighting.
  look.zenith.lerp(NIGHT_ZENITH, night);
  look.horizon.lerp(NIGHT_HORIZON, night);
  look.haze.lerp(NIGHT_HAZE, night);
  look.hazeAway.lerp(NIGHT_HAZE, night);
  look.ground.lerp(NIGHT_GROUND, night);

  // What the city paid for, seen from outside: a sodium dome over a lit town.
  // Horizon and haze only — the source is on the ground.
  // Added rather than mixed in, because that is what it is: the lamps are
  // putting light into the air, not repainting it. Lerping toward the sodium
  // colour turned a blue night brown; adding it lifts the horizon and warms it
  // while leaving the sky a night sky, which is what a lit city looks like from
  // the far side of the valley.
  const glowPaid = clamp01(input.lighting) * night * LIGHT_POLLUTION_MIX;
  if (glowPaid > 0) {
    add(look.horizon, LIGHT_POLLUTION, glowPaid);
    add(look.haze, LIGHT_POLLUTION, glowPaid * 0.7);
    add(look.hazeAway, LIGHT_POLLUTION, glowPaid * 0.7);
  }

  // A storm has very little hue. Applied last so it drains the night as well.
  if (drain > 0) {
    saturate(look.zenith, 1 - drain);
    saturate(look.horizon, 1 - drain);
    saturate(look.haze, 1 - drain);
    saturate(look.hazeAway, 1 - drain);
    saturate(look.ground, 1 - drain);
  }

  // The disc. Un-normalised, so it dims as it reddens: a sun you can look at is
  // a sun that has lost most of its light on the way in.
  look.sun.setRGB(beamR, beamG, beamB).multiplyScalar(SUN_DISC_RADIANCE * skyLight);
  // Over about two of its own diameters, so it sets rather than switches off.
  look.sunUp = smoothstep(-SUN_ANGULAR_RADIUS * 2, SUN_ANGULAR_RADIUS, height);
  look.glow = MIE_GLOW * skyLight;
  // Thicker air stacks the haze higher up the dome as well as making it denser.
  look.hazeLift = HAZE_LIFT * (1 + (hazeGain - 1) * 0.35);

  // The air itself.
  look.density = HAZE_DENSITY * hazeGain;
  // The low tier's uniform density: the height-integrated strength along the
  // ray the camera is looking down, evaluated once here instead of per
  // fragment. Exact for a ray that descends from the camera to the haze base,
  // which is the shot the game is played in.
  const drop = input.cameraAltitude - HAZE_BASE_Y;
  const t = -drop * HAZE_FALLOFF;
  const ramp = Math.abs(t) < 1e-4 ? 1 : (1 - Math.exp(-t)) / t;
  look.linearDensity = look.density * Math.exp(-drop * HAZE_FALLOFF) * ramp;
  // The clear-air lead-in. Floored at zero for walk mode, where the camera is
  // a person standing on a beach and `drop` can go slightly negative.
  look.nearOffset = Math.max(0, drop) * HAZE_NEAR_SHARE;
}

/** A fresh, zeroed look. One per renderer; `computeAtmosphere` writes into it. */
export function createAtmosphereLook(): AtmosphereLook {
  return {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    haze: new THREE.Color(),
    hazeAway: new THREE.Color(),
    ground: new THREE.Color(),
    sun: new THREE.Color(),
    sunUp: 0,
    glow: 0,
    hazeLift: HAZE_LIFT,
    cloud: 0,
    moon: 0,
    night: 0,
    density: HAZE_DENSITY,
    linearDensity: HAZE_DENSITY,
    nearOffset: 0,
  };
}

// --- The layer ---------------------------------------------------------------

export interface AtmosphereFrame {
  /** 0..1 from sim/daytime.ts — the same clock the sky rig and the windows read. */
  dayFraction: number;
  /** The camera being drawn from. The dome rides it; the haze is measured from it. */
  camera: THREE.Camera;
  /** The spell the sim is in (sim/weather.ts) and how far through it. */
  weather: WeatherKind;
  weatherProgress: number;
  /** 0..1 from sim/investments.ts. A funded night glows above the city it lit. */
  lighting: number;
  /**
   * Wall-clock seconds. Render time rather than sim time, deliberately: the
   * clouds should go on drifting and the stars go on twinkling while the city
   * is paused, for the same reason the site outline goes on pulsing.
   */
  seconds: number;
}

export interface Atmosphere {
  /** The dome. Add it to the scene; it holds no other geometry. */
  readonly group: THREE.Group;
  readonly quality: AtmosphereQuality;
  /** What the last `update` derived, for anyone who wants to read the sky. */
  readonly look: Readonly<AtmosphereLook>;
  /**
   * Where the sun is, as a unit vector.
   *
   * The one number this file could disagree with the light rig about. Call it
   * with `sky.ts`'s own sun direction and the drawn sun and the shadows the key
   * light casts stay pinned together; leave it alone and the same arc is
   * derived here from the same `sunHeight`, which is correct today and would
   * quietly stop being correct the moment that arc is retuned in one place.
   */
  setSunDirection(x: number, y: number, z: number): void;
  /**
   * Registers layers whose materials should receive aerial perspective.
   *
   * Opt-in per layer rather than a sweep of the whole scene, because the data
   * lens and the zone overlays must not be hazed: they are a readout in a
   * governance game and their colours have to mean what the legend says at any
   * distance. Roots are remembered, so `refresh()` picks up materials the
   * layers create later.
   */
  attach(...roots: readonly THREE.Object3D[]): void;
  /**
   * The same, for a layer that should take only part of the haze.
   *
   * One caller, and it is meant to stay that way: the sea (WATER_HAZE_WEIGHT).
   * The weight is compiled into the material, so a root registered here and a
   * root registered through `attach` must not share one.
   */
  attachDamped(weight: number, ...roots: readonly THREE.Object3D[]): void;
  /**
   * Re-walks the registered roots for materials created since the last call.
   *
   * Buildings mint a facade material the first time an archetype appears, so a
   * one-shot attach in the constructor would leave a district unhazed until the
   * next tier change. Cheap — a few hundred objects, and already-patched
   * materials are recognised and skipped — but not free, so it belongs on the
   * same throttle the zone rebuild already runs on.
   */
  refresh(): void;
  /** Per frame, after the sky rig and after the weather layer. */
  update(frame: AtmosphereFrame): void;
  /**
   * The drawing buffer's height in device pixels.
   *
   * The sun's disc is antialiased against one pixel's worth of angle, so it has
   * to know how big a pixel is. Call it from `Renderer.resize`, after `setSize`.
   */
  resize(pixelHeight: number): void;
  setQuality(quality: AtmosphereQuality): void;
  /** Recompiles everything this file injected. Call on `webglcontextrestored`. */
  invalidate(): void;
  dispose(): void;
}

/** What a material looked like before it was patched, so it can be handed back. */
interface Original {
  onBeforeCompile: THREE.Material['onBeforeCompile'];
  customProgramCacheKey: THREE.Material['customProgramCacheKey'];
  defines: Record<string, unknown> | undefined;
}

/** Material families whose shaders carry the two seams the patch splices into. */
interface Patchable {
  isMeshStandardMaterial?: boolean;
  isMeshPhysicalMaterial?: boolean;
  isMeshBasicMaterial?: boolean;
  isMeshLambertMaterial?: boolean;
  isMeshPhongMaterial?: boolean;
}

export function createAtmosphere(
  scene: THREE.Scene,
  quality: AtmosphereQuality = DEFAULT_ATMOSPHERE_QUALITY,
): Atmosphere {
  let tier = quality;

  const group = new THREE.Group();
  group.name = 'atmosphere';

  // One set of uniform objects, shared by reference between the dome and every
  // patched material. Writing a value once therefore moves the whole sky, and
  // there is no list of shaders to keep in step.
  const uniforms = {
    atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    atmSunColour: { value: new THREE.Color() },
    atmZenith: { value: new THREE.Color() },
    atmHorizon: { value: new THREE.Color() },
    atmHaze: { value: new THREE.Color() },
    atmHazeAway: { value: new THREE.Color() },
    atmGround: { value: new THREE.Color() },
    atmGlow: { value: 0 },
    atmHazeLift: { value: HAZE_LIFT },
    atmMoonDirection: { value: new THREE.Vector3(0, -1, 0) },
    atmMoonColour: { value: MOON_COLOUR.clone() },
    // x is the cosine of the outer edge, y of the inner: a smoothstep between
    // them is a disc with a one-pixel skirt, and no acos in the fragment.
    atmSunDisc: { value: new THREE.Vector2() },
    atmMoonDisc: { value: new THREE.Vector2() },
    atmSunUp: { value: 0 },
    atmMoon: { value: 0 },
    atmNight: { value: 0 },
    atmCloud: { value: 0 },
    atmTime: { value: 0 },
    atmDensity: { value: HAZE_DENSITY },
    atmLinearDensity: { value: HAZE_DENSITY },
    atmNear: { value: 0 },
    atmStrength: { value: tier === 'off' ? 0 : AERIAL_STRENGTH },
    atmFlatHaze: { value: new THREE.Color() },
  };

  const domeMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DOME_VERTEX,
    fragmentShader: domeFragment(tier),
    side: THREE.BackSide,
    // Tested but not written: the dome must not occlude the transparent layers
    // that draw after it, and it has nothing to occlude anyway.
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
  });

  // Radius one, ridden by the camera, and pinned to the far plane by the vertex
  // shader — so the geometry is only a way of getting a direction per fragment
  // and 32×16 is as much as it needs to be.
  const domeGeometry = new THREE.SphereGeometry(1, 32, 16);
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.name = 'sky';
  dome.frustumCulled = false;
  dome.renderOrder = SKY_RENDER_ORDER;
  group.add(dome);

  const look = createAtmosphereLook();

  /** Set from outside when the light rig owns the arc; derived here if not. */
  let sunOverride = false;
  const sunDirection = new THREE.Vector3(0, 1, 0);
  const moonDirection = new THREE.Vector3(0, -1, 0);
  const viewDirection = new THREE.Vector3();

  /**
   * Half the angle one device pixel covers, vertically.
   *
   * The field of view is fixed, so this only moves on resize. Starts at a
   * phone's worth so the first frame drawn before any resize is still right.
   */
  let pixelAngle = THREE.MathUtils.degToRad(CAMERA_FOV) / 1560;

  const refreshDiscs = (): void => {
    // cos is monotonically decreasing, so the outer edge is the smaller cosine.
    uniforms.atmSunDisc.value.set(
      Math.cos(SUN_ANGULAR_RADIUS + pixelAngle),
      Math.cos(Math.max(0, SUN_ANGULAR_RADIUS - pixelAngle)),
    );
    uniforms.atmMoonDisc.value.set(
      Math.cos(MOON_ANGULAR_RADIUS + pixelAngle),
      Math.cos(Math.max(0, MOON_ANGULAR_RADIUS - pixelAngle)),
    );
  };
  refreshDiscs();

  // --- The aerial-perspective patch ------------------------------------------

  /**
   * The layers taking aerial perspective, and how much of it each takes.
   *
   * A weight rather than a flat list because exactly one layer wants less than
   * all of it — the sea, for the framing reason set out at WATER_HAZE_WEIGHT.
   * It is baked into the shader as a `#define` rather than uploaded as a
   * uniform: it never changes for a given material, three already folds
   * `defines` into its own program cache key, and a compile-time one keeps the
   * common case free of a multiply.
   */
  const roots: { node: THREE.Object3D; weight: number }[] = [];
  /**
   * Weak on purpose. A layer that rebuilds its meshes drops its materials
   * without telling anyone, and a strong set here would hold every one of them
   * alive for the life of the renderer — which is the shape of the leak
   * tests/meshLeaks.test.ts exists to catch, arriving through a different door.
   */
  const patched = new WeakSet<THREE.Material>();
  const originals = new WeakMap<THREE.Material, Original>();

  const patchable = (material: THREE.Material): boolean => {
    const kind = material as THREE.Material & Patchable;
    return (
      kind.isMeshStandardMaterial === true ||
      kind.isMeshPhysicalMaterial === true ||
      kind.isMeshBasicMaterial === true ||
      kind.isMeshLambertMaterial === true ||
      kind.isMeshPhongMaterial === true
    );
  };

  const patch = (material: THREE.Material, weight = 1): void => {
    if (patched.has(material) || !patchable(material)) return;

    const previous = material.onBeforeCompile;
    // Captured before the swap, because three's default implementation returns
    // the source of whatever `onBeforeCompile` is at the time it is asked.
    const previousKey = material.customProgramCacheKey();
    originals.set(material, {
      onBeforeCompile: previous,
      customProgramCacheKey: material.customProgramCacheKey,
      defines: material.defines,
    });

    // Additively blended surfaces are sources rather than lit ones — the
    // streetlight pools, the hazard glows — and mixing one toward a bright haze
    // would make a lamp *brighter* the further away it got. Named explicitly
    // rather than "anything that is not normal blending", because a multiply
    // decal genuinely does want the normal path (fading it toward a pale haze is
    // fading it out) and an opaque material set to `NoBlending` wants it too.
    const emissiveSurface =
      material.blending === THREE.AdditiveBlending ||
      material.blending === THREE.SubtractiveBlending;
    material.defines = { ...(material.defines ?? {}) };
    if (emissiveSurface) material.defines['ATM_EMISSIVE_SURFACE'] = 1;
    if (weight !== 1) material.defines['ATM_HAZE_WEIGHT'] = glsl(weight);

    material.onBeforeCompile = (shader, renderer) => {
      // Whatever the layer already injected runs first and keeps its seams:
      // the water's wave normals and the terrain's detail fetch both splice
      // into `<common>`, and String.replace only touches the first match.
      previous.call(material, shader, renderer);

      for (const [name, uniform] of Object.entries(uniforms)) {
        shader.uniforms[name] = uniform;
      }

      // Two candidate seams, tried in order. `<worldpos_vertex>` is the natural
      // one, but this splices into shaders another layer has already rewritten,
      // and a hook that *replaced* that chunk rather than appending to it would
      // leave the varying unwritten — which is not a compile error, it is a
      // frame full of garbage distances. `<project_vertex>` is the fallback:
      // every mesh vertex shader has it and `transformed` is in scope at both.
      const seam = shader.vertexShader.includes('#include <worldpos_vertex>')
        ? '#include <worldpos_vertex>'
        : '#include <project_vertex>';
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAtmWorld;')
        .replace(seam, `${seam}\n${AERIAL_VERTEX_BODY}`);

      const declarations =
        tier === 'high'
          ? `${SKY_UNIFORMS}${AERIAL_UNIFORMS}${SKY_FUNCTION}`
          : AERIAL_UNIFORMS;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${declarations}`)
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>\n${aerialFragmentBody(tier)}`,
        )
        // Emptied rather than left alone: three's own fog would otherwise mix a
        // second time, in display space, over the top of this one.
        .replace('#include <fog_fragment>', '');
    };

    // The default cache key is the source of `onBeforeCompile`, which is now
    // one closure shared by every patched material — so without this, a road
    // and the water would be handed each other's program. The tier is in here
    // too, so changing it compiles rather than silently reusing.
    material.customProgramCacheKey = () => `atm:${tier}:${previousKey}`;
    material.needsUpdate = true;
    patched.add(material);
  };

  const unpatch = (material: THREE.Material): void => {
    const before = originals.get(material);
    if (!before) return;
    material.onBeforeCompile = before.onBeforeCompile;
    material.customProgramCacheKey = before.customProgramCacheKey;
    material.defines = before.defines;
    material.needsUpdate = true;
    originals.delete(material);
    patched.delete(material);
  };

  /** Every material hanging off the registered roots, patched or not. */
  const walk = (visit: (material: THREE.Material, weight: number) => void): void => {
    for (const root of roots) {
      root.node.traverse((object) => {
        const mesh = object as THREE.Mesh;
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (!material) return;
        if (Array.isArray(material)) {
          for (const entry of material) visit(entry, root.weight);
        } else {
          visit(material, root.weight);
        }
      });
    }
  };

  /**
   * Patching is one-way, and that is not laziness.
   *
   * three only runs `onBeforeCompile` when it *builds* a program
   * (WebGLRenderer.js:2191-2221). When it finds one in the material's own cache
   * it reuses it and leaves `materialProperties.uniforms` exactly as it was —
   * and that object is what `getUniformList` walks to decide which values to
   * upload. So if a material is un-patched (rebuilding `uniforms` from the
   * plain set, which has none of the names below) and then re-patched onto a
   * program it had already compiled, none of this file's uniforms are ever
   * uploaded again. They do not read as zero either: the locations keep
   * whatever the last program to use them wrote, so the haze quietly becomes a
   * constant taken from somebody else's shader. Measured, before this rule
   * existed: an extinction of 0.0202 per unit where the uniform said 0.0043,
   * every surface in the city four times too hazy, and nothing in the console.
   *
   * Going the other way — patched to plain — is safe, because the patched
   * uniform set is a superset of the plain one. So `dispose` may un-patch and
   * nothing else may.
   *
   * The tiers therefore switch by uniform (`off`) or by recompiling *between
   * two patched bodies* (`low` and `high`), which share a uniform set and can
   * be swapped freely.
   */
  const refresh = (): void => {
    if (tier === 'off') return;
    walk(patch);
  };

  const add = (weight: number, more: readonly THREE.Object3D[]): void => {
    for (const node of more) if (!roots.some((root) => root.node === node)) roots.push({ node, weight });
    refresh();
  };
  const attach = (...more: readonly THREE.Object3D[]): void => add(1, more);
  const attachDamped = (weight: number, ...more: readonly THREE.Object3D[]): void =>
    add(weight, more);

  // --- Per frame -------------------------------------------------------------

  /**
   * The scene's own linear fog, for the layers nobody attached.
   *
   * Kept as a `THREE.Fog` rather than promoted to `FogExp2` on purpose: the
   * weather layer tests for exactly that class before it tightens the
   * distances (weatherFx.ts:130), and a swap here would silently stop a fog
   * spell from doing anything at all.
   */
  const ownFog = (): THREE.Fog | null => {
    if (scene.fog instanceof THREE.Fog) return scene.fog;
    if (scene.fog === null) {
      scene.fog = new THREE.Fog('#D8E4EC', 0, WORLD_SIZE);
      return scene.fog as THREE.Fog;
    }
    return null;
  };

  const update = (frame: AtmosphereFrame): void => {
    const camera = frame.camera;
    camera.getWorldPosition(dome.position);

    computeAtmosphere(
      {
        dayFraction: frame.dayFraction,
        weather: frame.weather,
        weatherProgress: frame.weatherProgress,
        lighting: frame.lighting,
        cameraAltitude: dome.position.y,
      },
      look,
    );

    if (!sunOverride) {
      // The same arc sky.ts builds at sky.ts:335-336, so the sun this file
      // draws stands where the light rig's shadows say it does. If that arc is
      // ever retuned there, `setSunDirection` is the seam to use rather than a
      // second copy of the formula drifting away from the first.
      const travel = (frame.dayFraction - 0.5) * Math.PI;
      sunDirection
        .set(Math.sin(travel) * 0.85, sunHeight(frame.dayFraction), Math.cos(travel) * 0.34)
        .normalize();
    }
    moonDirection.copy(sunDirection).negate();

    uniforms.atmSunDirection.value.copy(sunDirection);
    uniforms.atmMoonDirection.value.copy(moonDirection);
    uniforms.atmSunColour.value.copy(look.sun);
    uniforms.atmZenith.value.copy(look.zenith);
    uniforms.atmHorizon.value.copy(look.horizon);
    uniforms.atmHaze.value.copy(look.haze);
    uniforms.atmHazeAway.value.copy(look.hazeAway);
    uniforms.atmGround.value.copy(look.ground);
    uniforms.atmGlow.value = look.glow;
    uniforms.atmHazeLift.value = look.hazeLift;
    uniforms.atmSunUp.value = look.sunUp;
    uniforms.atmMoon.value = look.moon;
    uniforms.atmNight.value = look.night;
    uniforms.atmCloud.value = look.cloud;
    uniforms.atmTime.value = frame.seconds;
    uniforms.atmDensity.value = look.density;
    uniforms.atmLinearDensity.value = look.linearDensity;
    uniforms.atmNear.value = look.nearOffset;

    // The low tier's single haze colour, sampled in the direction the camera is
    // pointing. It is a poor man's directional scattering and it costs one
    // vector: look toward a setting sun and the whole frame's haze goes warm,
    // turn away and it goes blue, which is most of what the per-fragment
    // version buys and none of what it costs.
    camera.getWorldDirection(viewDirection);
    sampleAerial(viewDirection, look, sunDirection, uniforms.atmFlatHaze.value);

    // The scene's own fog, matched to the same curve at its halfway point so
    // an unattached layer at least fades in the same direction as its
    // neighbours. Written here rather than in the sky rig because this is the
    // last word on the air, and it must be written *after* the weather layer:
    // weatherFx scales from a base it cached on its first frame, so its result
    // is overwritten without accumulating.
    const fog = ownFog();
    if (fog) {
      // The same colour the low tier fades into, so an attached layer and an
      // unattached one standing side by side agree about what the air looks
      // like even though they arrive at it by different arithmetic.
      fog.color.copy(uniforms.atmFlatHaze.value);
      // Extinction begins at the near plane in both models, so the linear one
      // starts there too — otherwise an unpatched layer in the foreground fogs
      // while the patched surface it is standing on does not, which is the one
      // disagreement a player would actually see.
      fog.near = look.nearOffset;
      fog.far = look.nearOffset + FOG_FAR_FACTOR / Math.max(look.linearDensity, 1e-6);
    }
  };

  // --- Lifecycle -------------------------------------------------------------

  const setQuality = (next: AtmosphereQuality): void => {
    if (next === tier) return;
    tier = next;
    uniforms.atmStrength.value = tier === 'off' ? 0 : AERIAL_STRENGTH;

    // The dome is this file's own ShaderMaterial, so its source is free to move
    // with the tier: three keys a ShaderMaterial's program on the source text
    // itself and reads its uniforms straight off the material, so none of the
    // caching hazard above applies to it.
    domeMaterial.fragmentShader = domeFragment(tier);
    domeMaterial.needsUpdate = true;

    // At `off` nothing is patched that was not patched already, and what was
    // stays put with its strength at zero — see the note on `refresh`. A city
    // that starts at `off` therefore never compiles a patched program at all.
    if (tier === 'off') return;

    refresh();
    // `low` and `high` are different fragments. The tier is in the cache key,
    // so this lands on the other program rather than silently reusing the one
    // built for the tier being left; both carry the same uniforms, so the swap
    // is safe in either direction.
    walk((material) => {
      if (patched.has(material)) material.needsUpdate = true;
    });
  };

  return {
    group,
    look,
    get quality(): AtmosphereQuality {
      return tier;
    },
    setSunDirection: (x, y, z) => {
      sunOverride = true;
      sunDirection.set(x, y, z).normalize();
    },
    attach,
    attachDamped,
    refresh,
    update,
    resize: (pixelHeight) => {
      // Half a pixel: a smoothstep between cos(r + a) and cos(r - a) spans two
      // of these, which is one pixel of skirt on the disc's edge.
      pixelAngle = THREE.MathUtils.degToRad(CAMERA_FOV) / Math.max(2, pixelHeight) / 2;
      refreshDiscs();
    },
    setQuality,
    invalidate: () => {
      // Programs die with the context. three rebuilds its own on the next draw,
      // but a material whose shader was assembled in `onBeforeCompile` has to be
      // told, or the city comes back unhazed and the sky comes back untiered.
      domeMaterial.needsUpdate = true;
      walk((material) => {
        if (patched.has(material)) material.needsUpdate = true;
      });
    },
    dispose: () => {
      // Materials this file did not create are handed back the way they were
      // found, so a renderer that outlives this layer keeps its fog and its
      // shaders. Only the dome is ours to destroy. This is the one place
      // un-patching is allowed, and it is allowed because it is terminal: see
      // the note on `refresh` for what happens if anything re-patches after it.
      walk(unpatch);
      roots.length = 0;
      group.remove(dome);
      domeGeometry.dispose();
      domeMaterial.dispose();
      group.clear();
    },
  };
}

// --- Maths -------------------------------------------------------------------

/**
 * The CPU's copy of `atmAerialColour`, for the one place a colour is needed
 * without a fragment to compute it in.
 *
 * Deliberately the same expression in the same order. It is used for the low
 * tier's single haze colour and for the scene's own fog, where an approximation
 * would be defensible — but the moment it stopped matching, the low and high
 * tiers would disagree about what the same air looks like, which is exactly the
 * class of bug this whole file is built around not having.
 */
function sampleAerial(
  dir: THREE.Vector3,
  look: AtmosphereLook,
  sun: THREE.Vector3,
  out: THREE.Color,
): void {
  const up = dir.y;
  const airMass = 1 / (Math.max(up, 0) + AIRMASS_FLOOR);
  const band = clamp01((airMass - AIRMASS_ZENITH) / (AIRMASS_HORIZON - AIRMASS_ZENITH));
  out.copy(look.zenith).lerp(look.horizon, band * Math.sqrt(band));

  const mu = dir.dot(sun);
  out.multiplyScalar(lerp(1, 0.75 * (1 + mu * mu), 0.35));
  const toward = clamp01(mu * 0.5 + 0.5) ** 3;
  scratchBand.copy(look.hazeAway).lerp(look.haze, toward);
  out.lerp(scratchBand, Math.exp(-Math.max(up, 0) / look.hazeLift) * HAZE_MIX);

  const denom = 1 + MIE_G * MIE_G - 2 * MIE_G * mu;
  const mie = (1 - MIE_G * MIE_G) / (denom * Math.sqrt(Math.max(denom, 1e-4)));
  out.r += look.sun.r * mie * look.glow;
  out.g += look.sun.g * mie * look.glow;
  out.b += look.sun.b * mie * look.glow;
}

/**
 * Rayleigh scattering into the eye along a view ray of the given air mass.
 *
 * `1 - e^-τ` rather than `τ`: a long path does not go on getting bluer for
 * ever, it saturates, and the saturation is exactly why the horizon is pale and
 * the zenith is not. The beam is what is left of the sunlight after its own
 * journey, so a red sun scatters a red sky and needs no separate dusk colour.
 */
function scatter(out: THREE.Color, viewAirMass: number, r: number, g: number, b: number): void {
  const depth = RAYLEIGH_DEPTH * viewAirMass;
  out.setRGB(
    (1 - Math.exp(-RAYLEIGH[0] * depth)) * r,
    (1 - Math.exp(-RAYLEIGH[1] * depth)) * g,
    (1 - Math.exp(-RAYLEIGH[2] * depth)) * b,
  );
}

/**
 * Pushes a colour away from its own luminance, or toward it below one.
 *
 * Luminance-preserving, so it changes how colourful the sky is without changing
 * how bright it is — which matters because brightness here is scattered
 * sunlight and has already been accounted for.
 */
/** `colour += other * scale`. three's Color adds whole colours but not scaled ones. */
function add(colour: THREE.Color, other: THREE.Color, scale: number): void {
  colour.setRGB(
    colour.r + other.r * scale,
    colour.g + other.g * scale,
    colour.b + other.b * scale,
  );
}

function saturate(colour: THREE.Color, amount: number): void {
  const grey = luminance(colour.r, colour.g, colour.b);
  colour.setRGB(
    grey + (colour.r - grey) * amount,
    grey + (colour.g - grey) * amount,
    grey + (colour.b - grey) * amount,
  );
}

/** Rec. 709 luminance, which is the working space these colours are already in. */
function luminance(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

/** Scratch colours; a fresh one per frame is sixty allocations a second for nothing. */
const scratchTint = new THREE.Color();
const scratchBand = new THREE.Color();
function tint(rgb: readonly [number, number, number]): THREE.Color {
  return scratchTint.setRGB(rgb[0], rgb[1], rgb[2]);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
