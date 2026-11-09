/** Shared simulation-time contacts for work poses and discrete sound events. */
export const harvestTiming = { duration: 6, period: 0.9, impact: 0.6 } as const;
export const hammerTiming = { period: 1.05, impact: 0.68 } as const;
export const treeFallTiming = { duration: 0.8, impact: 0.64 } as const;
export const titleAutoplayRate = 4;
export const workElapsed = (time: number, person: number): number => time + person * 0.17;

/** The fixed simulation step is shorter than a work cycle. Return its contact, if any. */
export function workImpactBetween(
  before: number,
  after: number,
  timing: { period: number; impact: number },
): number | null {
  const cycle = (time: number) => Math.floor((time - timing.impact) / timing.period + 1e-8);
  const current = cycle(after);
  return current > cycle(before) ? timing.impact + current * timing.period : null;
}
