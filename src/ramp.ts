import { addTick, easeInQuad } from './ticker'

// Slope: y = 430 - x/3 in the 600x460 viewBox, descending to the left.
const THETA = Math.atan(1 / 3)
const SIN = Math.sin(THETA)
const COS = Math.cos(THETA)

const R = 94
const GRAVITY = 1800
const ACCEL = GRAVITY * SIN // along-slope acceleration once the wedge is gone

// Ball's initial contact point with the slope (viewBox coords).
const CONTACT = { x: 500, y: 263.333 }
const UPHILL = { x: COS, y: -SIN }
const OUT = { x: -SIN, y: -COS } // away from the slope surface

// The wedge slams straight down into the slope (along the surface normal)
// until it sits flush — fully hidden behind the ground mask — then the ball
// is free to roll.
const SLAM_MS = 130
const SINK = 70 // apex is 64 tall; 70 buries it under the slope stroke

const EXIT_X = -140

type Mode = 'idle' | 'slam' | 'roll' | 'done'

export interface RampScene {
  onScrollDown(): void
  onCovered(): void
  setReduced(reduced: boolean): void
}

export function initRamp(windowEl: HTMLElement, isReduced: () => boolean): RampScene {
  const wedge = windowEl.querySelector<SVGGElement>('[data-wedge]')!
  const ball = windowEl.querySelector<SVGGElement>('[data-ball]')!

  let mode: Mode = 'idle'
  let armed = false
  let t = 0 // ms into the slam
  let s = 0 // ball contact-point position along the slope, 0 = start, negative = downhill
  let v = 0

  const setBall = (sc: number): void => {
    const x = CONTACT.x + UPHILL.x * sc + OUT.x * R
    const y = CONTACT.y + UPHILL.y * sc + OUT.y * R
    // rolling without slipping: arc length / radius, downhill-left = CCW
    const deg = (sc / R) * (180 / Math.PI)
    ball.setAttribute('transform', `translate(${x} ${y}) rotate(${deg})`)
  }

  const setWedge = (k: number): void => {
    wedge.setAttribute('transform', `translate(0 ${k * SINK})`)
  }

  const reset = (): void => {
    mode = 'idle'
    t = 0
    s = 0
    v = 0
    setWedge(0)
    setBall(0)
  }

  addTick((dt) => {
    if (mode === 'idle' || mode === 'done') return

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
          if (mode !== 'idle') reset()
        }
      }
    },
    { threshold: [0, 0.3] },
  )
  observer.observe(windowEl)

  return {
    onScrollDown() {
      if (!isReduced() && armed && mode === 'idle') {
        mode = 'slam'
        t = 0
      }
    },
    // Under the fold the window never exits the viewport at the top of the
    // page — it just gets re-covered by the hero sheet. Reset behind it so
    // the next reveal shows the chocked pose again.
    onCovered() {
      if (mode !== 'idle') reset()
    },
    // Either way the right static pose is the chocked start.
    setReduced() {
      reset()
    },
  }
}
