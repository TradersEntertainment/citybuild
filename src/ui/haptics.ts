/**
 * Feature-detected haptics (§3). iOS has no navigator.vibrate, so this is a
 * silent no-op there — detection, never browser sniffing. Kept deliberately
 * quiet: the brief bans buzz spam (§24).
 */
const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function tap(): void {
  if (supported) navigator.vibrate(8);
}

export function confirm(): void {
  if (supported) navigator.vibrate([6, 24, 10]);
}
