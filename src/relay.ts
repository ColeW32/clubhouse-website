// There is exactly one ball on this page. It leaves the hero, rolls through
// the first window, and lands in the second — so a stage may only animate it
// once every stage above has let it go. That makes it impossible for the ball
// to appear in two windows at the same time, however fast the reader scrolls.
//
// The baton only ever moves forward: each stage runs once per session, so
// scrolling back up does not rewind the cascade and replay it.
export const HERO = 0
export const RAMP = 1
export const DROP = 2

let released = 0

/** True once every earlier stage has handed the ball on. */
export function hasBall(stage: number): boolean {
  return released >= stage
}

/** Hand the ball to the next stage. Ignored if this stage already passed it. */
export function releaseBall(stage: number): void {
  if (released === stage) released = stage + 1
}
