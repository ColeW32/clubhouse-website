import { addTick, clamp, easeOutQuad, scrolledPast } from './ticker'
import { HERO, releaseBall } from './relay'

// Hero logo scene: the disco ball hangs from a string under the arch. Wind
// sways the pendulum, the ball detaches mid-swing, falls, and is swallowed by
// the clip seam behind the CLUBHOUSE wordmark. The string stays and recoils.
// Once the ball is gone the scroll cue draws itself in below, picking the
// fall back up and handing the reader down the page.
const PIVOT = { x: 320, y: 190 } // ceiling of the arch cutout
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

const TYPE_MS = 32 // per character of the tagline

// Scroll cue, timed from the moment the ball disappears.
const CUE_LEAD_MS = 320
const CUE_STROKE_MS = 240
const CUE_STAGGER_MS = 140
const CUE_GAP_MS = 140 // beat between the last stroke and the first letter
const CUE_TYPE_MS = 46

const smoothstep = (u: number): number => u * u * (3 - 2 * u)

type Mode = 'idle' | 'delay' | 'sway' | 'fall' | 'done'

export interface HeroScene {
  setReduced(reduced: boolean): void
}

// Reveals text one character at a time without ever changing its layout: the
// full string is always present, characters are just hidden until their turn.
function typewriter(el: HTMLElement, caretClass?: string) {
  const text = el.textContent ?? ''
  el.textContent = ''
  const chars: HTMLElement[] = []
  for (const ch of text) {
    const span = document.createElement('span')
    span.textContent = ch
    el.appendChild(span)
    chars.push(span)
  }
  const caret = caretClass ? document.createElement('span') : null
  if (caret && caretClass) caret.className = caretClass
  let shown = chars.length // starts visible, matching the no-JS render

  return {
    length: chars.length,
    set(n: number): void {
      const to = clamp(n, 0, chars.length)
      if (to === shown) return
      const lo = Math.min(shown, to)
      const hi = Math.max(shown, to)
      for (let i = lo; i < hi; i++) chars[i].style.visibility = i < to ? 'visible' : 'hidden'
      shown = to
      if (!caret) return
      if (to > 0 && to < chars.length) chars[to - 1].after(caret)
      else caret.remove()
    },
  }
}

export function initHero(heroEl: HTMLElement, isReduced: () => boolean): HeroScene {
  const stringG = heroEl.querySelector<SVGGElement>('[data-hero-string]')!
  const ballG = heroEl.querySelector<SVGGElement>('[data-hero-ball]')!
  const tagline = typewriter(heroEl.querySelector<HTMLElement>('[data-tagline]')!, 'hero__caret')

  const cueMarks = Array.from(heroEl.querySelectorAll<SVGGeometryElement>('[data-cue-mark]'))
  const cueTextEl = heroEl.querySelector<HTMLElement>('[data-cue]')
  const cueText = cueTextEl ? typewriter(cueTextEl) : null
  const cueLen = cueMarks.map((m) => m.getTotalLength() || 1)
  cueMarks.forEach((m, i) => {
    m.style.strokeDasharray = String(cueLen[i])
  })
  const CUE_TEXT_AT = CUE_LEAD_MS + cueMarks.length * CUE_STAGGER_MS + CUE_GAP_MS
  const CUE_TOTAL = CUE_TEXT_AT + (cueText?.length ?? 0) * CUE_TYPE_MS + 200

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
  let typeT = 0 // ms since the tagline started typing
  let cueT = -1 // < 0 until the ball is gone

  const setPendulum = (rad: number): void => {
    const deg = (rad * 180) / Math.PI
    const rot = `rotate(${deg} ${PIVOT.x} ${PIVOT.y})`
    stringG.setAttribute('transform', rot)
    ballG.setAttribute('transform', rot)
  }

  const renderCue = (ms: number): void => {
    for (let i = 0; i < cueMarks.length; i++) {
      const p = easeOutQuad(clamp((ms - (CUE_LEAD_MS + i * CUE_STAGGER_MS)) / CUE_STROKE_MS, 0, 1))
      cueMarks[i].style.strokeDashoffset = String(cueLen[i] * (1 - p))
    }
    cueText?.set(Math.floor((ms - CUE_TEXT_AT) / CUE_TYPE_MS))
  }

  // The ball has left the hero: hand it on, and start the cue that replaces it.
  const handOff = (): void => {
    if (cueT < 0) cueT = 0
    releaseBall(HERO)
  }

  // Snap to the finished state — used when the reader scrolls past before the
  // scene has played out, so the cascade below still gets its ball.
  const finish = (): void => {
    mode = 'done'
    tagline.set(tagline.length)
    stringG.removeAttribute('transform')
    ballG.setAttribute('transform', `translate(0 ${EXIT_Y})`)
    handOff()
    cueT = Math.max(cueT, CUE_TOTAL)
    renderCue(CUE_TOTAL)
  }

  if (isReduced()) {
    // Static pose: the ball stays hanging as part of the logo, the cue is
    // simply present, and the ball is handed on so the page below still runs.
    renderCue(CUE_TOTAL)
    releaseBall(HERO)
    mode = 'done'
  } else {
    tagline.set(0)
    renderCue(0)
    mode = 'delay'
  }

  addTick((dt) => {
    if (cueT >= 0 && cueT < CUE_TOTAL) {
      cueT += dt * 1000
      renderCue(cueT)
    }
    if (mode === 'done') return
    // Scrolled clear of the hero mid-scene: it runs once, so settle it where
    // it stands and hand the ball down rather than leaving the page stuck.
    if (scrolledPast(heroEl)) {
      finish()
      return
    }
    if (mode === 'idle') return
    t += dt * 1000

    // The tagline starts typing the moment the scene triggers.
    if (mode === 'delay' || mode === 'sway') {
      typeT += dt * 1000
      tagline.set(Math.floor(typeT / TYPE_MS))
    }

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
        tagline.set(tagline.length) // typing is long done by now; make it certain
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
    if (y > EXIT_Y) handOff() // out of sight: the next stage may have it
    if (y > EXIT_Y && Math.abs(flick) < 0.002) {
      stringG.removeAttribute('transform')
      mode = 'done'
    }
  })

  return {
    setReduced(reduced) {
      if (reduced && mode !== 'done') finish()
    },
  }
}
