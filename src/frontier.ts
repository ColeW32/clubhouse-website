import { addTick, clamp } from './ticker'

// The last act, staged against the top edge of the off-black mass. That edge
// is a surface, like the slope and the point inside the cutouts before it.
//
//   1. the ball has already dropped out of the second cutout, out of sight
//   2. when the edge climbs near the middle of the screen it TRIGGERS a short
//      timed move: the ball comes in low from the left, bounces along the
//      edge, and rolls to the centre, where it stops
//   3. from there the ball holds its place while the reader keeps scrolling,
//      so the rising edge passes over it — that part is tied to the scroll
//   4. whatever sits below the edge is drawn as a particle-mesh sphere, so
//      the ball goes under and something else comes out: two objects clipped
//      to either side of one line
//
// The entry is on a clock rather than scrubbed by scroll because scrubbing a
// bounce makes it stutter with trackpad momentum. Only the part the reader is
// meant to feel in control of — going under — follows the scroll.

const TIP_OFF_AT = 0.95 // edge fraction at which the cutout is told to let go
const ENTER_AT = 0.8 // ...and at which the timed entry fires
const REARM_AT = 0.9 // scroll back above this and the entry can play again

const ENTRY_MS = 1150
const ENTRY_START_X = -0.04 // just off the left edge, as a fraction of width
const SINK_AT = 0.34 // edge fraction where the ball stops riding the line
const DRIFT_SPAN = 0.3 // edge-fractions over which the mesh eases deeper

const GROWTH = 1.25
const GROW_TAU = 0.13 // seconds of smoothing on the scroll-driven size
const PARTICLES = 260
const LINK_DIST = 0.42
const SPIN_RATE = 0.22

// Deep in the section the grown sphere bursts: every particle flies out to a
// fixed spot spread across the whole screen, links intact, leaving a clear
// ellipse in the middle for the closing line. All of it scrubs with scroll.
const BOOM_FROM = 0.15 // depth at which the burst begins (growth ends here)
const BOOM_SPAN = 0.27 // depth it takes to complete
const TEXT_AT = 0.55 // burst progress at which the line starts fading in
const WANDER_PX = 9 // gentle drift of settled particles, so the field lives

// The last movement: the web's lines dissolve, the dark tears open in the
// middle onto the paper the page began with, and the ball comes home — it
// rolls in across the revealed paper, bounces off the side of the contact
// text, and settles against it the way it once sat against the wedge.
const DISSOLVE_FROM = 0.55 // depth at which the lines start to go
const DISSOLVE_SPAN = 0.13
const PEEL_FROM = 0.68 // depth at which the paper tears open
const PEEL_SPAN = 0.14
const HOME_MS = 1400 // the timed roll-in, once the peel has finished

const TAU = Math.PI * 2
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const smoothstep = (u: number): number => u * u * (3 - 2 * u)
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t)

// A low skip along the surface: in fast and shallow, settling quickly. Heights
// are in ball radii above the resting height.
const HOPS: Array<[number, number, number]> = [
  // [from, to, height]
  [0, 0.3, 0.9],
  [0.3, 0.56, 0.62],
  [0.56, 0.75, 0.26],
  [0.75, 0.88, 0.09],
]

function hopHeight(p: number): number {
  if (p >= 0.88) return 0
  // the first segment is a fall, not an arc, so it enters already descending
  if (p < HOPS[0][1]) {
    const u = p / HOPS[0][1]
    return HOPS[0][2] * (1 - u * u)
  }
  for (let i = 1; i < HOPS.length; i++) {
    const [a, b, hgt] = HOPS[i]
    if (p < b) return hgt * Math.sin(Math.PI * ((p - a) / (b - a)))
  }
  return 0
}

interface P3 {
  x: number
  y: number
  z: number
}

// Evenly spread points over a sphere, so the mesh has no poles or seams.
function fibonacciSphere(n: number): P3[] {
  const pts: P3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const th = golden * i
    pts.push({ x: Math.cos(th) * rad, y, z: Math.sin(th) * rad })
  }
  return pts
}

function meshLinks(pts: P3[], maxDist: number): Array<[number, number]> {
  const links: Array<[number, number]> = []
  const d2 = maxDist * maxDist
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x
      const dy = pts[i].y - pts[j].y
      const dz = pts[i].z - pts[j].z
      if (dx * dx + dy * dy + dz * dz < d2) links.push([i, j])
    }
  }
  return links
}

export function initFrontier(
  canvas: HTMLCanvasElement,
  sectionEl: HTMLElement,
  dropWindow: HTMLElement,
  isReduced: () => boolean,
  onTipOff: () => void,
  dropCleared: () => boolean,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const pts = fibonacciSphere(PARTICLES)
  const links = meshLinks(pts, LINK_DIST)
  const jitter = pts.map((_, i) => (Math.sin(i * 91.7) * 43758.5453) % 1)
  const copyEl = sectionEl.querySelector<HTMLElement>('[data-frontier-copy]')
  const revealEl = sectionEl.querySelector<HTMLElement>('[data-reveal]')
  const paperEl = sectionEl.querySelector<HTMLElement>('[data-reveal-paper]')
  const titleEl = sectionEl.querySelector<HTMLElement>('[data-reveal-title]')

  // Where each particle flies when the sphere bursts. The direction comes from
  // the particle's own place on the sphere (with a little jitter), so 3D
  // neighbours stay 2D neighbours and the link web survives the explosion
  // instead of turning into chords across the screen.
  const frac = (v: number): number => v - Math.floor(v)
  const scatter = pts.map((p, i) => {
    const h1 = frac(Math.sin(i * 12.9898) * 43758.5453)
    const h2 = frac(Math.sin(i * 78.233) * 12543.2971)
    const mag = Math.hypot(p.x, p.y)
    const angle = mag > 0.25 ? Math.atan2(p.y, p.x) + (h1 - 0.5) * 0.8 : h1 * TAU
    return { cos: Math.cos(angle), sin: Math.sin(angle), u: Math.pow(h2, 0.65) }
  })

  let w = 0
  let h = 0
  let dpr = 1
  let clock = 0
  let entryT = -1 // < 0 until the entry is triggered
  let homeT = -1 // < 0 until the peel finishes and the ball comes home
  let tipped = false
  let rSmooth = 0

  const resize = (): void => {
    const nw = window.innerWidth
    const nh = window.innerHeight
    const nd = Math.min(2, window.devicePixelRatio || 1)
    if (nw === w && nh === h && nd === dpr) return
    w = nw
    h = nh
    dpr = nd
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // The drawn ball, matching the one in the cutouts stroke for stroke.
  const drawBall = (x: number, y: number, r: number, spin: number): void => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(spin)
    ctx.strokeStyle = '#22372f'
    ctx.lineWidth = Math.max(1, r * 0.09)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, TAU)
    ctx.stroke()
    for (const f of [-0.72, -0.4, 0, 0.4, 0.72]) {
      const half = r * Math.sqrt(Math.max(0, 1 - f * f))
      ctx.beginPath()
      ctx.moveTo(-half, r * f)
      ctx.lineTo(half, r * f)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(0, -r)
    ctx.lineTo(0, r)
    ctx.stroke()
    for (const rx of [0.66, 0.33]) {
      ctx.beginPath()
      ctx.ellipse(0, 0, r * rx, r, 0, 0, TAU)
      ctx.stroke()
    }
    ctx.restore()
  }

  // What waits in the dark: a sphere of points linked into a mesh, turning
  // slowly. Depth drives size and brightness so it reads as a volume. As boom
  // rises the particles fly out to their scattered spots across the screen —
  // never inside the exclusion ellipse, which is where the closing line sits.
  const drawMesh = (
    x: number,
    y: number,
    r: number,
    still: boolean,
    boom: number,
    textAlpha: number,
    dissolve: number,
    peel: number,
  ): void => {
    const a = still ? 0.6 : clock * SPIN_RATE
    const cosA = Math.cos(a)
    const sinA = Math.sin(a)
    const cosT = Math.cos(0.32)
    const sinT = Math.sin(0.32)

    // The clear zone: the copy's box, padded, as an ellipse around centre —
    // and once the paper starts tearing open, its (growing) box instead, so
    // the remaining dots part around the opening as it widens.
    const rect = copyEl?.getBoundingClientRect()
    let ex = rect && rect.width > 0 ? rect.width / 2 + 64 : w * 0.22
    let ey = rect && rect.height > 0 ? rect.height / 2 + 52 : h * 0.16
    if (peel > 0 && paperEl) {
      const pr = paperEl.getBoundingClientRect()
      ex = Math.max(ex, pr.width / 2 + 48)
      ey = Math.max(ey, pr.height / 2 + 44)
    }
    const maxR = 0.62 * Math.hypot(w, h)

    const sx: number[] = new Array(pts.length)
    const sy: number[] = new Array(pts.length)
    const sd: number[] = new Array(pts.length)
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const rx = p.x * cosA + p.z * sinA
      const rz = -p.x * sinA + p.z * cosA
      let px = x + rx * r
      let py = y + (p.y * cosT - rz * sinT) * r
      if (boom > 0) {
        // radius of the exclusion ellipse along this particle's direction
        const sc = scatter[i]
        const er = (ex * ey) / Math.hypot(ey * sc.cos, ex * sc.sin)
        const dist = er + sc.u * (maxR - er)
        const wob = still ? 0 : WANDER_PX * boom
        px = lerp(px, x + sc.cos * dist + Math.sin(clock * 0.5 + jitter[i] * TAU) * wob, boom)
        py = lerp(py, y + sc.sin * dist + Math.cos(clock * 0.43 + jitter[i] * 7) * wob, boom)
      }
      sx[i] = px
      sy[i] = py
      // volume shading flattens out as the sphere stops being a sphere
      sd[i] = lerp((p.y * sinT + rz * cosT + 1) / 2, 0.72, boom)
    }

    ctx.save()
    ctx.lineWidth = Math.max(0.5, r * 0.006)
    // The lines are the first thing to go in the last movement.
    if (dissolve < 1) {
      for (const [i, j] of links) {
        // once the line is up, no web strand may cross its box
        if (textAlpha > 0.05 || peel > 0) {
          const mx = (sx[i] + sx[j]) / 2 - x
          const my = (sy[i] + sy[j]) / 2 - y
          if ((mx * mx) / (ex * ex) + (my * my) / (ey * ey) < 1.15) continue
        }
        const d = (sd[i] + sd[j]) / 2
        const fade = (1 - 0.45 * boom) * (1 - dissolve)
        ctx.strokeStyle = `rgba(206, 188, 148, ${((0.05 + 0.2 * d * d) * fade).toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(sx[i], sy[i])
        ctx.lineTo(sx[j], sy[j])
        ctx.stroke()
      }
    }
    // The dots stay behind as a quiet star field around the opening.
    const dotFade = 1 - 0.45 * dissolve
    for (let i = 0; i < pts.length; i++) {
      const d = sd[i]
      const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 1.7 + jitter[i] * TAU)
      const size = Math.max(0.6, r * (0.008 + 0.017 * d) * (0.85 + 0.3 * pulse) * (1 - 0.3 * boom))
      ctx.fillStyle = `rgba(${Math.round(214 + 32 * d)} ${Math.round(200 + 34 * d)} ${Math.round(166 + 46 * d)} / ${((0.16 + 0.74 * d * d) * dotFade).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(sx[i], sy[i], size, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }

  // The homecoming: the drawn ball rolls in across the revealed paper,
  // raps against the side of the text, and settles resting against it.
  const drawHomeBall = (q: number): void => {
    if (!paperEl || !titleEl) return
    const P = paperEl.getBoundingClientRect()
    const T = titleEl.getBoundingClientRect()
    if (P.width <= 0) return
    const r2 = clamp(P.height * 0.17, 26, 60)
    const floorY = P.bottom - r2 - P.height * 0.14
    const xStart = P.left - r2 * 0.4
    const xWall = T.left - r2 - 16
    if (xWall <= xStart) return
    const B = Math.min(44, (xWall - xStart) * 0.14)
    let bx: number
    if (q < 0.5) {
      bx = lerp(xStart, xWall, q / 0.5)
    } else if (q < 0.8) {
      bx = xWall - B * Math.sin(Math.PI * ((q - 0.5) / 0.3))
    } else {
      bx = xWall
    }
    const spin = (bx - xStart) / r2
    ctx.save()
    ctx.beginPath()
    ctx.rect(P.left + 5, P.top + 5, P.width - 10, P.height - 10)
    ctx.clip()
    drawBall(bx, floorY, r2, spin)
    ctx.restore()
  }

  addTick((dt) => {
    resize()
    clock += dt

    const sec = sectionEl.getBoundingClientRect()
    const edge = sec.top // the surface, in viewport coordinates
    const d = edge / h // 1 at the bottom of the screen, 0 at the top

    // Tell the cutout to let its ball go, well before it is wanted here.
    // (It tips itself off after a beat anyway; this covers a fast arrival.)
    if (!tipped && d < TIP_OFF_AT) {
      onTipOff()
      tipped = true
    }
    if (tipped && d > TIP_OFF_AT + 0.03) tipped = false

    // Fire the timed entry once the edge has meaningfully risen — but never
    // while the cutout's ball is still on its way out. One ball at a time is
    // the page's rule; the entry just waits the extra beat if it must.
    if (entryT < 0 && d < ENTER_AT && dropCleared()) {
      entryT = isReduced() ? ENTRY_MS : 0
      rSmooth = 0
    }
    if (entryT >= 0 && d > REARM_AT) {
      entryT = -1
      rSmooth = 0
    }

    if (entryT < 0 || sec.bottom < 0) {
      ctx.clearRect(0, 0, w, h)
      return
    }
    entryT = Math.min(entryT + dt * 1000, ENTRY_MS)

    const r0 = dropWindow.getBoundingClientRect().width * (94 / 600)
    const depth = clamp(-sec.top / Math.max(1, sec.height - h), 0, 1)
    // It grows through the first stretch of the dark, then bursts — both
    // scrubbed by the scroll, both reversible on the way back up.
    const grow = smoothstep(clamp(depth / BOOM_FROM, 0, 1))
    const boom = smoothstep(clamp((depth - BOOM_FROM) / BOOM_SPAN, 0, 1))
    const dissolve = smoothstep(clamp((depth - DISSOLVE_FROM) / DISSOLVE_SPAN, 0, 1))
    const peel = smoothstep(clamp((depth - PEEL_FROM) / PEEL_SPAN, 0, 1))
    const textAlpha = smoothstep(clamp((boom - TEXT_AT) / (1 - TEXT_AT), 0, 1)) * (1 - dissolve)
    // Ease the scroll-driven size, so momentum scrolling cannot make it pulse.
    const rTarget = r0 * (1 + GROWTH * grow)
    rSmooth = rSmooth === 0 ? rTarget : lerp(rSmooth, rTarget, clamp(dt / GROW_TAU, 0, 1))
    const r = rSmooth

    if (copyEl) {
      copyEl.style.opacity = textAlpha.toFixed(3)
      copyEl.style.transform = `translateY(${((1 - textAlpha) * 14).toFixed(1)}px)`
    }
    if (revealEl) {
      revealEl.style.opacity = peel.toFixed(3)
      revealEl.style.transform = `scale(${(0.25 + 0.75 * peel).toFixed(3)})`
      // While faded out it must not be hit-testable, or an invisible
      // "Contact us" sits in the middle of the burst.
      revealEl.style.visibility = peel > 0.01 ? 'visible' : 'hidden'
    }

    // Once the tear is fully open, the ball comes home on its own clock.
    if (homeT < 0 && peel >= 1) homeT = isReduced() ? HOME_MS : 0
    if (homeT >= 0 && peel < 0.9) homeT = -1
    if (homeT >= 0) homeT = Math.min(homeT + dt * 1000, HOME_MS)

    // Timed: in from the left, skipping, decelerating to the centre.
    const p = entryT / ENTRY_MS
    const x = lerp(ENTRY_START_X * w, w * 0.5, easeOut(p))

    // The surface it skips along IS the rising edge, so the whole entry moves
    // up in step with the scroll. Once the edge climbs past SINK_AT the ball
    // stops riding it and the line keeps going — that is how it goes under.
    const line = Math.max(edge, h * SINK_AT)
    const y = line - r - (p < 1 ? hopHeight(p) * r : 0)
    const spin = (x - ENTRY_START_X * w) / r0
    const under = clamp((y + r - edge) / (2 * r), 0, 1)

    // Fully under, the mesh eases on toward the middle of the dark as the
    // reader keeps going — it drifts deeper rather than hanging at the seam.
    const dUnder = SINK_AT - (2 * r) / h
    const drift = under >= 1 ? smoothstep(clamp((dUnder - d) / DRIFT_SPAN, 0, 1)) : 0
    const yDraw = lerp(y, h * 0.52, drift)

    ctx.clearRect(0, 0, w, h)

    // Above the line it is the drawn ball; below it is the mesh. One boundary,
    // two objects — that is what sells it going under.
    if (under < 1) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, w, Math.max(0, edge))
      ctx.clip()
      drawBall(x, yDraw, r, spin)
      ctx.restore()
    }
    if (under > 0.02) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, Math.max(0, edge), w, h - Math.max(0, edge))
      ctx.clip()
      drawMesh(x, yDraw, r, isReduced(), boom, textAlpha, dissolve, peel)
      ctx.restore()
    }
    if (homeT >= 0) drawHomeBall(homeT / HOME_MS)

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__frontier = {
        d: +d.toFixed(3),
        entry: +p.toFixed(3),
        under: +under.toFixed(2),
        drift: +drift.toFixed(2),
        boom: +boom.toFixed(2),
        text: +textAlpha.toFixed(2),
        dissolve: +dissolve.toFixed(2),
        peel: +peel.toFixed(2),
        home: homeT < 0 ? -1 : +(homeT / HOME_MS).toFixed(2),
        x: Math.round(x),
        y: Math.round(yDraw),
        r: Math.round(r),
        edge: Math.round(edge),
      }
    }
  })
}
