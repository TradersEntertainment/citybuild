/**
 * Service worker registration (§2). Everything the game needs is cached on
 * first load, so airplane mode is a supported way to play, not a failure mode.
 * Registration is best-effort: a browser without SW support still runs the
 * game, it just loses offline.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return; // dev server caching only causes confusion

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // Offline is a bonus, never a blocker — swallow and carry on.
    });
  });
}
