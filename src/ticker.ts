export type Tick = (dt: number) => void

const ticks = new Set<Tick>()

// ?slow=3 stretches time for tuning/screenshotting the scenes
const SLOW = Math.max(1, Number(new URLSearchParams(location.search).get('slow')) || 1)

export function addTick(tick: Tick): void {
  ticks.add(tick)
}

// Dev-only manual stepper so scenes can be driven deterministically (e.g. from
// a headless/hidden tab where rAF is paused). The first call takes over from
// the rAF loop entirely. Stripped from production builds.
let manual = false
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__tick = (ms: number, stepMs = 16) => {
    manual = true
    let remaining = ms
    while (remaining > 0) {
      const step = Math.min(stepMs, remaining)
      for (const tick of ticks) tick(step / 1000)
      remaining -= step
    }
  }
}

export function startTicker(): void {
  let last = performance.now()
  const frame = (now: number) => {
    // clamp so a backgrounded tab doesn't produce a giant physics step
    const dt = Math.min((now - last) / 1000, 0.032) / SLOW
    last = now
    if (!manual) for (const tick of ticks) tick(dt)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

/** How much of an element is inside the viewport, 0..1 of its own height. */
export function visibleRatio(el: Element): number {
  const r = el.getBoundingClientRect()
  if (r.height <= 0) return 0
  const top = Math.max(0, r.top)
  const bottom = Math.min(window.innerHeight, r.bottom)
  return Math.max(0, (bottom - top) / r.height)
}

/** True once the element has scrolled entirely above the viewport. */
export function scrolledPast(el: Element): boolean {
  return el.getBoundingClientRect().bottom < 0
}

export const easeInQuad = (t: number): number => t * t
export const easeOutQuad = (t: number): number => t * (2 - t)
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
