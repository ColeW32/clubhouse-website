import { addTick, easeInQuad, scrolledPast, visibleRatio } from './ticker'
import { RAMP, hasBall, releaseBall } from './relay'

// The portfolio act, in a 1200x440 viewBox. Right to left: a ramp, a row of
// five app keys, a hole, and a backstop wall. The ball rolls down the ramp and
// is chocked by the wedge; on the reader's next scroll the wedge slams flush
// and the ball rolls across every key — one ad, every app — then drops
// through the hole and out of the cutout, on its way to the next window.

// Ramp: y = 196 - (x - FOOT_X)/3, rising to the right.
const THETA = Math.atan(1 / 3)
const SIN = Math.sin(THETA)
const COS = Math.cos(THETA)

const R = 56
const GRAVITY = 1800
const ACCEL = GRAVITY * SIN // along-slope acceleration

const TOP = 196 // key tops, level with the foot of the ramp
const FOOT_X = 1030
const CONTACT = { x: 1135, y: TOP - (1135 - FOOT_X) / 3 } // chocked contact point
const UPHILL = { x: COS, y: -SIN }
const OUT = { x: -SIN, y: -COS } // away from the slope surface
// The foot is a concave corner, so the ball's centre leaves the slope's
// offset line where that line meets the level's: the slope coordinate at
// which the centre has come down to TOP - R.
const LEVEL_S = (CONTACT.y - COS * R - (TOP - R)) / SIN
const LEVEL_X = CONTACT.x + COS * LEVEL_S - SIN * R // centre x at that moment

// The keys and the hole they end at.
const KEY_W = 120
const KEY_TRAVEL = 7 // how far a key sinks under the ball
const KEY_K = 1500 // spring stiffness
const KEY_C = 46 // spring damping
const KEYS_LEFT = 366 // left face of the leftmost key: the hole's right wall
const WALL_X = 236 // right face of the backstop: the hole's left wall
const WALL_TOP = 126
const WALL_E = 0.3 // restitution off the hole's walls
const ROLL_DRAG = 0.04 // fraction of speed lost per second on the level

// The wedge slams straight down into the ramp (along the surface normal).
const SLAM_MS = 130
const SINK = 44 // apex is 38 tall; 44 buries it under the ground edge

// The ball enters from up-slope, fully hidden past the window's right edge,
// rolls down under gravity, and bounces off the wedge until it settles.
const ROLL_IN_START = 220
const STOP_RESTITUTION = 0.35
const SETTLE_SPEED = 60
const EXIT_Y = 440 + R + 10 // ball centre fully below the cutout

type Mode = 'empty' | 'rollin' | 'chocked' | 'slam' | 'slope' | 'level' | 'fall' | 'done'

export interface PortfolioScene {
  onScrollDown(): void
  /** The next window is on screen waiting: play the trapdoor now rather than
   *  waiting for another scroll gesture. The ball still ROLLS out — snapping
   *  it away while this window is visible reads as a glitch. */
  autoRoll(): void
  setReduced(reduced: boolean): void
}

interface Key {
  el: SVGGElement
  label: SVGTextElement | null
  x: number
  dip: number
  vel: number
  lit: boolean
}

export function initPortfolio(
  windowEl: HTMLElement,
  isReduced: () => boolean,
  isRevealed: () => boolean,
): PortfolioScene {
  const wedge = windowEl.querySelector<SVGGElement>('[data-wedge]')!
  const ball = windowEl.querySelector<SVGGElement>('[data-ball]')!
  const labels = Array.from(windowEl.querySelectorAll<SVGTextElement>('[data-key-label]'))
  const keys: Key[] = Array.from(windowEl.querySelectorAll<SVGGElement>('[data-key]')).map(
    (el, i) => ({ el, label: labels[i] ?? null, x: Number(el.dataset.x), dip: 0, vel: 0, lit: false }),
  )

  let mode: Mode = 'empty'
  let armed = false
  let t = 0 // ms into the slam
  let s = ROLL_IN_START // contact position along the slope, 0 = chocked
  let v = 0 // speed, positive leftward (downhill)
  // free flight, once the ball is off the keys
  let cx = 0
  let cy = 0
  let vx = 0
  let vy = 0
  let roll = 0 // signed arc position, for the spin
  let spin = 0 // angular speed in flight (arc units per second)

  const place = (x: number, y: number): void => {
    // rolling without slipping: arc length / radius, moving left = CCW
    const deg = (roll / R) * (180 / Math.PI)
    ball.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${deg.toFixed(2)})`)
  }

  const setSlope = (sc: number): void => {
    roll = sc
    place(CONTACT.x + UPHILL.x * sc + OUT.x * R, CONTACT.y + UPHILL.y * sc + OUT.y * R)
  }

  const setWedge = (k: number): void => {
    wedge.setAttribute('transform', `translate(0 ${k * SINK})`)
  }

  const light = (key: Key): void => {
    if (key.lit) return
    key.lit = true
    key.label?.classList.add('is-lit')
  }

  const keyUnder = (x: number): Key | null =>
    keys.find((k) => x >= k.x && x <= k.x + KEY_W) ?? null

  // Keys spring toward their target: pressed while the ball is on them.
  const stepKeys = (dt: number, contactX: number | null): void => {
    for (const k of keys) {
      const on = contactX !== null && contactX >= k.x - 6 && contactX <= k.x + KEY_W + 6
      if (on) light(k)
      const target = on ? KEY_TRAVEL : 0
      const a = KEY_K * (target - k.dip) - KEY_C * k.vel
      k.vel += a * dt
      k.dip += k.vel * dt
      k.el.setAttribute('transform', `translate(0 ${k.dip.toFixed(2)})`)
    }
  }

  const reset = (): void => {
    mode = 'empty'
    t = 0
    s = ROLL_IN_START
    v = 0
    setWedge(0)
    setSlope(s)
  }

  // Snap to the state after the ball has gone: trapdoor down, every key
  // reached, window empty, ball handed on. Used when the reader scrolls past
  // mid-scene, and as the static pose under reduced motion.
  const finish = (): void => {
    mode = 'done'
    t = SLAM_MS
    setWedge(1)
    for (const k of keys) {
      light(k)
      k.dip = 0
      k.vel = 0
      k.el.removeAttribute('transform')
    }
    place(WALL_X + 65, EXIT_Y + 200)
    releaseBall(RAMP)
  }

  // Narrow screens see the working part of the scene only — most of the
  // backstop wall and the sky above the ramp are cropped away.
  const svg = windowEl.querySelector('svg')!
  const narrow = matchMedia('(max-width: 820px)')
  const frame = (): void => svg.setAttribute('viewBox', narrow.matches ? '200 40 1000 400' : '0 0 1200 440')
  frame()
  narrow.addEventListener('change', frame)

  reset()
  if (isReduced()) finish()

  // The ball has rolled off the last key: from here it is a free body,
  // bounded by the two walls of the hole and the corners at their tops.
  const fly = (dt: number): void => {
    vy += GRAVITY * dt
    cx += vx * dt
    cy += vy * dt
    roll += spin * dt
    // the corners: the edge of the last key, and the lip of the wall
    for (const [px, py] of [
      [KEYS_LEFT, TOP],
      [WALL_X, WALL_TOP],
    ]) {
      const dx = cx - px
      const dy = cy - py
      const d = Math.hypot(dx, dy)
      if (d < R && d > 0) {
        const nx = dx / d
        const ny = dy / d
        cx = px + nx * R
        cy = py + ny * R
        const vn = vx * nx + vy * ny
        if (vn < 0) {
          vx -= (1 + WALL_E) * vn * nx
          vy -= (1 + WALL_E) * vn * ny
        }
      }
    }
    // the faces, below the corners
    if (cy > WALL_TOP && cx - R < WALL_X) {
      cx = WALL_X + R
      if (vx < 0) vx = -vx * WALL_E
    }
    if (cy > TOP && cx + R > KEYS_LEFT) {
      cx = KEYS_LEFT - R
      if (vx > 0) vx = -vx * WALL_E
    }
    place(cx, cy)
    if (cy > EXIT_Y) {
      mode = 'done'
      releaseBall(RAMP)
    }
  }

  addTick((dt) => {
    if (mode !== 'done') {
      armed = visibleRatio(windowEl) >= 0.3
      // Scrolled clear of the window: the scene runs once, so finish it where
      // it stands and pass the ball on rather than replaying it later.
      if (scrolledPast(windowEl)) {
        finish()
        return
      }
    }
    if (mode === 'empty') {
      // Roll in the moment the section is actually on show.
      if (armed && !isReduced() && isRevealed() && hasBall(RAMP)) mode = 'rollin'
      return
    }
    if (mode === 'done') return

    if (mode === 'rollin') {
      v += ACCEL * dt
      s -= v * dt
      if (s <= 0) {
        s = 0
        if (v <= SETTLE_SPEED) {
          mode = 'chocked'
          v = 0
          setSlope(0)
          return
        }
        v = -v * STOP_RESTITUTION // bounce back off the stop
      }
      setSlope(s)
      return
    }
    if (mode === 'chocked') return

    if (mode === 'slam') {
      t += dt * 1000
      if (t < SLAM_MS) {
        setWedge(easeInQuad(t / SLAM_MS))
        return
      }
      // The ball releases the moment the wedge lands flush.
      setWedge(1)
      mode = 'slope'
    }

    if (mode === 'slope') {
      v += ACCEL * dt
      s -= v * dt
      if (s > LEVEL_S) {
        setSlope(s)
        stepKeys(dt, null)
        return
      }
      // Onto the level: the along-slope speed carries straight on.
      mode = 'level'
      cx = LEVEL_X - (LEVEL_S - s) // the overshoot, laid out along the level
    }

    if (mode === 'level') {
      v *= 1 - ROLL_DRAG * dt
      cx -= v * dt
      roll = LEVEL_S - (LEVEL_X - cx)
      stepKeys(dt, cx)
      const under = keyUnder(cx)
      place(cx, TOP - R + (under ? under.dip : 0))
      if (cx < KEYS_LEFT) {
        // Off the end of the last key and into the hole.
        mode = 'fall'
        cy = TOP - R
        vx = -v
        vy = 0
        spin = -v
      }
      return
    }

    // fall
    stepKeys(dt, null)
    fly(dt)
  })

  const start = (): void => {
    if (!isReduced() && mode === 'chocked') {
      mode = 'slam'
      t = 0
    }
  }

  return {
    autoRoll: start,
    onScrollDown() {
      if (armed) start()
    },
    setReduced(reduced) {
      if (reduced && mode !== 'done') finish()
    },
  }
}
