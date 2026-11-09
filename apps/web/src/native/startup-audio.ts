/** Capture the first trusted gesture before the larger audio module has downloaded. */
export function captureStartupAudio(hint: HTMLElement) {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext({ sampleRate: 44100 });
  } catch {
    // Audio availability must not prevent the game from opening.
  }
  const updateHint = () => {
    hint.hidden = !context || context.state !== 'suspended';
  };
  const unlock = (event: Event) => {
    if (event.type === 'pointerdown' && (event as PointerEvent).pointerType !== 'mouse') return;
    if (event.type === 'pointerup' && (event as PointerEvent).pointerType === 'mouse') return;
    if (context && (context.state === 'suspended' || (context.state as string) === 'interrupted'))
      void context.resume().catch(() => {});
  };
  const events = ['pointerdown', 'pointerup', 'keydown'] as const;
  for (const event of events) document.addEventListener(event, unlock);
  context?.addEventListener('statechange', updateHint);
  updateHint();
  const handoff = () => {
    for (const event of events) document.removeEventListener(event, unlock);
  };
  return {
    context,
    handoff,
    dispose() {
      handoff();
      context?.removeEventListener('statechange', updateHint);
      hint.remove();
    },
  };
}
