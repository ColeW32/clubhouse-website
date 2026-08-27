import { addTick } from './ticker'

// Hero logo scene: the disco ball hangs from a string under the arch. Wind
// sways the pendulum, the ball detaches mid-swing, falls, and is swallowed by
// the clip seam behind the CLUBHOUSE wordmark. The string stays and recoils.
const PIVOT = { x: 320, y: 197 }
const REST = { x: 320, y: 255 } // hanging ball center
const ARM = REST.y - PIVOT.y // pendulum length to ball center

const GRAVITY = 1800
const SWAY_HZ = 0.65
// 15deg keeps the ball's edge ~3px clear of the arch's inner wall at full swing
const SWAY_AMP = (15 * Math.PI) / 180
const SWAY_RAMP_MS = 1200
const MIN_SWAY_MS = 3000 // release at the first upward zero-crossing after this
const STRING_FREQ = 18 // rad/s of the empty string's recoil flick
const STRING_DECAY = 4
const EXIT_Y = 450 // ball center fully below the clip seam
const START_DELAY_MS = 500

const smoothstep = (u: number): number => u * u * (3 - 2 * u)

type Mode = 'idle' | 'delay' | 'sway' | 'fall' | 'done'

export interface HeroScene {
  setReduced(reduced: boolean): void
}

export function initHero(heroEl: HTMLElement, isReduced: () => boolean): HeroScene {
  const stringG = heroEl.querySelector<SVGGElement>('[data-hero-string]')!
  const ballG = heroEl.querySelector<SVGGElement>('[data-hero-ball]')!

  let mode: Mode = 'idle'
  let t = 0 // ms into the current phase
  let theta = 0 // pendulum angle (radians)
  let prevTheta = 0
  let x = REST.x
  let y = REST.y
  let vx = 0
  let vy = 0
  let releaseAngle = 0
  let recoilAmp = 0 // radians

  const setPendulum = (rad: number): void => {
    const deg = (rad * 180) / Math.PI
    const rot = `rotate(${deg} ${PIVOT.x} ${PIVOT.y})`
    stringG.setAttribute('transform', rot)
    ballG.setAttribute('transform', rot)
  }

  const reset = (): void => {
    mode = 'idle'
    t = 0
    theta = 0
    prevTheta = 0
    x = REST.x
    y = REST.y
    vx = 0
    vy = 0
    recoilAmp = 0
    stringG.removeAttribute('transform')
    ballG.removeAttribute('transform')
  }

  addTick((dt) => {
    if (mode === 'idle' || mode === 'done') return
    t += dt * 1000

    if (mode === 'delay') {
      if (t >= START_DELAY_MS) {
        mode = 'sway'
        t = 0
      }
      return
    }

    if (mode === 'sway') {
      const ts = t / 1000
      const amp = SWAY_AMP * smoothstep(Math.min(1, t / SWAY_RAMP_MS))
      prevTheta = theta
      // Negated so the first gust pushes the ball to the right (wind from the
      // left). With SVG's rotate(), ball x = pivot.x - ARM*sin(theta).
      theta = -amp * Math.sin(2 * Math.PI * SWAY_HZ * ts)

      // Detach at a downward zero-crossing: max swing speed, string vertical,
      // ball moving rightward — it drifts with the wind as it falls.
      if (t > MIN_SWAY_MS && prevTheta > 0 && theta <= 0) {
        const omega = (theta - prevTheta) / dt
        x = PIVOT.x - ARM * Math.sin(theta)
        y = PIVOT.y + ARM * Math.cos(theta)
        vx = -ARM * Math.cos(theta) * omega
        vy = -ARM * Math.sin(theta) * omega
        releaseAngle = (theta * 180) / Math.PI
        recoilAmp = omega / STRING_FREQ
        mode = 'fall'
        t = 0
        return
      }
      setPendulum(theta)
      return
    }

    // fall: the ball is ballistic; the empty string flicks and settles.
    vy += GRAVITY * dt
    x += vx * dt
    y += vy * dt
    ballG.setAttribute(
      'transform',
      `translate(${x - REST.x} ${y - REST.y}) rotate(${releaseAngle} ${REST.x} ${REST.y})`,
    )
    const ts = t / 1000
    const flick = recoilAmp * Math.exp(-STRING_DECAY * ts) * Math.sin(STRING_FREQ * ts)
    stringG.setAttribute('transform', `rotate(${(flick * 180) / Math.PI} ${PIVOT.x} ${PIVOT.y})`)
    if (y > EXIT_Y && Math.abs(flick) < 0.002) {
      stringG.removeAttribute('transform')
      mode = 'done'
    }
  })

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.6) {
          if (!isReduced() && mode === 'idle') {
            mode = 'delay'
            t = 0
          }
        } else if (!entry.isIntersecting && mode !== 'idle' && !isReduced()) {
          reset()
        }
      }
    },
    { threshold: [0, 0.6] },
  )
  observer.observe(heroEl)

  return {
    // Both directions land on the authored hanging pose.
    setReduced() {
      reset()
    },
  }
}
