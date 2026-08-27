import { addTick, clamp } from './ticker'

// The ball falls in from behind the top edge of the window, bounces on the
// apex of the point at (302, 283), and settles resting on it.
const BALL_X = 302
const APEX_Y = 283
const R = 94
const REST_Y = APEX_Y - R // settled center y
const START_Y = -260
const GRAVITY = 1800
const RESTITUTION = 0.45
const SETTLE_SPEED = 160 // impacts slower than this settle instead of bouncing
const CONTACT_MS = 80
const START_DELAY_MS = 120

type Mode = 'idle' | 'delay' | 'fall' | 'contact' | 'done'

export interface DropScene {
  setReduced(reduced: boolean): void
}

export function initDrop(windowEl: HTMLElement, isReduced: () => boolean): DropScene {
  const ball = windowEl.querySelector<SVGGElement>('[data-ball]')!

  let mode: Mode = 'idle'
  let y = START_Y // nominal ball-center y
  let v = 0
  let t = 0 // ms into delay/contact
  let impactSpeed = 0
  let settling = false

  const render = (sx: number, sy: number): void => {
    // keep the ball's bottom edge anchored while squashing
    const ty = y + R - R * sy
    ball.setAttribute('transform', `translate(${BALL_X} ${ty}) scale(${sx} ${sy})`)
  }

  const reset = (): void => {
    mode = 'idle'
    y = START_Y
    v = 0
    t = 0
    settling = false
    render(1, 1)
  }

  const settle = (): void => {
    mode = 'done'
    y = REST_Y
    v = 0
    render(1, 1)
  }

  // The markup is authored in the settled pose; under reduced motion it stays
  // there, otherwise the ball starts hidden above the window.
  if (isReduced()) {
    settle()
  } else {
    reset()
  }

  addTick((dt) => {
    if (mode === 'idle' || mode === 'done') return

    if (mode === 'delay') {
      t += dt * 1000
      if (t >= START_DELAY_MS) {
        mode = 'fall'
      }
      return
    }

    if (mode === 'fall') {
      v += GRAVITY * dt
      y += v * dt
      if (y >= REST_Y) {
        y = REST_Y
        impactSpeed = v
        settling = impactSpeed <= SETTLE_SPEED
        mode = 'contact'
        t = 0
      }
      render(1, 1)
      return
    }

    // contact: dwell on the apex with a small squash scaled by impact speed
    t += dt * 1000
    const q = clamp(impactSpeed / 17000, 0.012, 0.075)
    const k = Math.sin(Math.PI * clamp(t / CONTACT_MS, 0, 1))
    render(1 + q * k, 1 - q * k)
    if (t >= CONTACT_MS) {
      if (settling) {
        render(1, 1)
        mode = 'done'
      } else {
        v = -impactSpeed * RESTITUTION
        mode = 'fall'
      }
    }
  })

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.5) {
          if (!isReduced() && mode === 'idle') {
            mode = 'delay'
            t = 0
          }
        } else if (!entry.isIntersecting && mode !== 'idle' && !isReduced()) {
          reset()
        }
      }
    },
    { threshold: [0, 0.5] },
  )
  observer.observe(windowEl)

  return {
    setReduced(reduced) {
      if (reduced) settle()
      else reset()
    },
  }
}
