import { addTick, clamp, visibleRatio } from './ticker'
import { DROP, hasBall } from './relay'

// The ball falls in from behind the top edge of the window, bounces on the
// apex of the point at (302, 283), and settles resting on it.
const BALL_X = 302
const APEX_Y = 283
const R = 94
const REST_Y = APEX_Y - R // settled center y
const START_Y = -260
const GRAVITY = 1800
const RESTITUTION = 0.38
const SETTLE_SPEED = 160 // impacts slower than this settle instead of bouncing
const CONTACT_MS = 80
const START_DELAY_MS = 120
const TOPPLE_VX = 120 // sideways nudge as it leaves the point
const PERCH_MS = 260 // how long it balances before tipping off on its own
const TOPPLE_VY = 380 // it leaves briskly; lingering half-out of the window reads broken
const HIDE_AFTER_MS = 2000 // hard backstop: this long after first landing, gone for good

type Mode = 'idle' | 'delay' | 'fall' | 'contact' | 'perched' | 'topple' | 'gone'

export interface DropScene {
  /** Tip the ball off the spike so it falls out through the bottom of the
   *  cutout — the window looks onto a layer behind the page, so the ball
   *  leaves by dropping out of sight rather than staying balanced. */
  release(): void
  hasLeft(): boolean
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
  let visible = false
  let x = BALL_X
  let vx = 0
  let perchT = 0
  let sinceLand = -1 // ms since the ball first hit the point; < 0 = not yet
  let hiddenForever = false

  const render = (sx: number, sy: number): void => {
    // keep the ball's bottom edge anchored while squashing
    const ty = y + R - R * sy
    const spin = ((x - BALL_X) / R) * (180 / Math.PI)
    ball.setAttribute('transform', `translate(${x} ${ty}) rotate(${spin}) scale(${sx} ${sy})`)
  }

  const reset = (): void => {
    mode = 'idle'
    x = BALL_X
    vx = 0
    y = START_Y
    v = 0
    t = 0
    settling = false
    render(1, 1)
  }

  const settle = (): void => {
    mode = 'perched'
    x = BALL_X
    vx = 0
    perchT = 0
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
    // Whatever else is going on — mid-bounce, mid-topple, scenes started late
    // because of scroll order — two seconds after the ball first lands in
    // this window it is hidden outright and never shown here again.
    if (sinceLand >= 0 && !hiddenForever && !isReduced()) {
      sinceLand += dt * 1000
      if (sinceLand >= HIDE_AFTER_MS) {
        ball.style.visibility = 'hidden'
        hiddenForever = true
        mode = 'gone'
        return
      }
    }
    if (mode === 'idle') {
      visible = visibleRatio(windowEl) >= 0.5
      // Only once the window above has actually let the ball go, so it can
      // never be falling in here while it is still rolling up there.
      if (visible && !isReduced() && hasBall(DROP)) {
        mode = 'delay'
        t = 0
      }
      return
    }
    if (mode === 'gone') return

    if (mode === 'topple') {
      // Off the point and straight down out of the cutout.
      v += GRAVITY * dt
      y += v * dt
      x += vx * dt
      render(1, 1)
      if (y - R > 460) mode = 'gone'
      return
    }

    if (mode === 'perched') {
      // It balances only for a beat, then tips off by itself — the sooner it
      // drops out of the cutout, the sooner the reader can move on.
      if (!isReduced()) {
        perchT += dt * 1000
        if (perchT >= PERCH_MS) {
          vx = -TOPPLE_VX
          v = TOPPLE_VY
          mode = 'topple'
        }
      }
      return
    }

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
        if (sinceLand < 0) sinceLand = 0
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
        mode = 'perched'
      } else {
        v = -impactSpeed * RESTITUTION
        mode = 'fall'
      }
    }
  })

  return {
    release() {
      if (mode === 'topple' || mode === 'gone') return
      // Only a settled ball tips off, and only an unseen one falls through.
      // A scene the reader is watching is never interrupted mid-fall — that
      // skips the bounce and streaks the ball out the bottom; the perch timer
      // and the hide backstop dismiss it on their own soon enough.
      if (mode === 'perched' || (mode === 'idle' && visibleRatio(windowEl) <= 0.05)) {
        vx = -TOPPLE_VX
        v = TOPPLE_VY
        mode = 'topple'
      }
    },
    hasLeft() {
      return mode === 'gone'
    },
    setReduced(reduced) {
      // Static pose: balanced on the point, before it tips off.
      if (reduced && mode !== 'perched' && mode !== 'gone') settle()
    },
  }
}
