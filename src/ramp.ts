import { addTick, easeInQuad } from './ticker'

// Slope: y = 430 - x/3 in the 600x460 viewBox, descending to the left.
const THETA = Math.atan(1 / 3)
const SIN = Math.sin(THETA)
const COS = Math.cos(THETA)

const R = 94
const GRAVITY = 1800
const ACCEL = GRAVITY * SIN // along-slope acceleration

// Ball's chocked contact point with the slope (viewBox coords).
const CONTACT = { x: 500, y: 263.333 }
const UPHILL = { x: COS, y: -SIN }
const OUT = { x: -SIN, y: -COS } // away from the slope surface

// The wedge slams straight down into the slope (along the surface normal)
// until it sits flush — fully hidden behind the ground mass — then the ball
// is free to roll on out.
const SLAM_MS = 130
const SINK = 70 // apex is 64 tall; 70 buries it under the ground edge

// The ball enters from up-slope, fully hidden past the window's right edge,
// rolls down under gravity, and bounces off the wedge until it settles.
const ROLL_IN_START = 306
const STOP_RESTITUTION = 0.35
const SETTLE_SPEED = 80

const EXIT_X = -140

type Mode = 'empty' | 'rollin' | 'chocked' | 'slam' | 'roll' | 'done'

export interface RampScene {
  onScrollDown(): void
  onCovered(): void
  setReduced(reduced: boolean): void
}

export function initRamp(
  windowEl: HTMLElement,
  isReduced: () => boolean,
  isRevealed: () => boolean,
): RampScene {
  const wedge = windowEl.querySelector<SVGGElement>('[data-wedge]')!
  const ball = windowEl.querySelector<SVGGElement>('[data-ball]')!

  let mode: Mode = 'empty'
  let armed = false
  let t = 0 // ms into the slam
  let s = ROLL_IN_START // ball contact position along the slope, 0 = chocked
  let v = 0 // along-slope speed, positive downhill

  const setBall = (sc: number): void => {
    const x = CONTACT.x + UPHILL.x * sc + OUT.x * R
    const y = CONTACT.y + UPHILL.y * sc + OUT.y * R
    // rolling without slipping: arc length / radius, moving left = CCW
    const deg = (sc / R) * (180 / Math.PI)
    ball.setAttribute('transform', `translate(${x} ${y}) rotate(${deg})`)
  }

  const setWedge = (k: number): void => {
    wedge.setAttribute('transform', `translate(0 ${k * SINK})`)
  }

  const setChocked = (): void => {
    mode = 'chocked'
    t = 0
    s = 0
    v = 0
    setWedge(0)
    setBall(0)
  }

  const reset = (): void => {
    mode = 'empty'
    t = 0
    s = ROLL_IN_START
    v = 0
    setWedge(0)
    setBall(s)
  }

  // The markup is authored chocked (the reduced-motion pose); in motion mode
  // the window starts empty and the ball rolls in on reveal.
  if (isReduced()) {
    setChocked()
  } else {
    reset()
  }

  addTick((dt) => {
    if (mode === 'empty') {
      // Roll in the moment the section is actually on show.
      if (armed && !isReduced() && isRevealed()) mode = 'rollin'
      return
    }
    if (mode === 'chocked' || mode === 'done') return

    if (mode === 'rollin') {
      v += ACCEL * dt
      s -= v * dt
      if (s <= 0) {
        s = 0
        if (v <= SETTLE_SPEED) {
          setChocked()
          return
        }
        v = -v * STOP_RESTITUTION // bounce back off the stop
      }
      setBall(s)
      return
    }

    if (mode === 'slam') {
      t += dt * 1000
      if (t < SLAM_MS) {
        setWedge(easeInQuad(t / SLAM_MS))
      } else {
        setWedge(1)
        mode = 'roll'
      }
    }

    // The ball releases the moment the wedge lands flush.
    if (t >= SLAM_MS) {
      v += ACCEL * dt
      s -= v * dt
      setBall(s)
      if (CONTACT.x + UPHILL.x * s < EXIT_X) mode = 'done'
    }
  })

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.3) {
          armed = true
        } else if (!entry.isIntersecting) {
          armed = false
          if (mode !== 'empty') reset()
        }
      }
    },
    { threshold: [0, 0.3] },
  )
  observer.observe(windowEl)

  return {
    onScrollDown() {
      if (!isReduced() && armed && mode === 'chocked') {
        mode = 'slam'
        t = 0
      }
    },
    // Under the fold the window never exits the viewport at the top of the
    // page — it just gets re-covered by the hero sheet. Reset behind it so
    // the next reveal replays from the roll-in.
    onCovered() {
      if (mode !== 'empty') reset()
    },
    setReduced(reduced) {
      if (reduced) setChocked()
      else reset()
    },
  }
}
