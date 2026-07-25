/**
 * WebAudio unlock (§3). iOS starts the audio context suspended and only lets
 * it resume inside a user gesture, so the first touch anywhere resumes it. The
 * context is created lazily and stays silent until Phase 6 gives it something
 * to play; audio ships default-off (§15).
 */
let context: AudioContext | null = null;
let unlockBound = false;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

export function getAudioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** Binds a one-shot resume to the first pointer/key interaction. */
export function bindAudioUnlock(target: EventTarget = window): void {
  if (unlockBound) return;
  unlockBound = true;

  const unlock = (): void => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
    target.removeEventListener('pointerdown', unlock);
    target.removeEventListener('keydown', unlock);
  };

  target.addEventListener('pointerdown', unlock);
  target.addEventListener('keydown', unlock);
}
