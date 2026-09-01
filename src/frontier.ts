import { addTick, clamp } from './ticker'

// The last act, staged against the top edge of the off-black mass as it rises.
// That edge is a surface, like the slope and the point inside the windows:
//
//   1. the ball has already dropped out of the second cutout, out of sight
//   2. as the edge nears mid-screen the ball falls in from the side, bounces
//      on it, and rolls to the centre
//   3. as the edge climbs past two thirds, the ball sinks through it
//   4. whatever is below the edge is drawn as a particle-mesh sphere, so the
//      ball appears to disappear into the dark and something else emerges —
//      it is two objects, clipped to either side of the same line
//
// Everything is a function of where that edge sits on screen, so it scrubs
// with the reader rather than playing on a timer.

// Edge position as a fraction of the viewport height, 1 = bottom, 0 = top.
const TIP_OFF_AT = 0.70 // the cutout ball is told to leave
const ROLL_FROM = 0.58 // ball drops in from the side
const ROLL_TO = 0.40 // ...and has reached the centre
const SINK_FROM = 0.34 // starts going under (edge two thirds up)
const SINK_TO = 0.08 // fully under

const GROWTH = 0.55 // extra radius once it is through
const PARTICLES = 260
const LINK_DIST = 0.42 // mesh links between points closer than this on the unit sphere
const SPIN_RATE = 0.22 // radians per second

const TAU = Math.PI * 2
const smoothstep = (u: number): number => u * u * (3 - 2 * u)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const range = (v: number, from: number, to: number): number => clamp((from - v) / (from - to), 0, 1)

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
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const pts = fibonacciSphere(PARTICLES)
  const links = meshLinks(pts, LINK_DIST)
  const jitter = pts.map((_, i) => (Math.sin(i * 91.7) * 43758.5453) % 1)

  let w = 0
  let h = 0
  let dpr = 1
  let clock = 0
  let tipped = false

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

  // The thing waiting in the dark: a sphere of points, linked into a mesh,
  // turning slowly. Depth drives both size and brightness so it reads as a
  // volume rather than a disc.
  const drawMesh = (x: number, y: number, r: number, still: boolean): void => {
    const a = still ? 0.6 : clock * SPIN_RATE
    const cosA = Math.cos(a)
    const sinA = Math.sin(a)
    const tilt = 0.32
    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)

    const sx: number[] = new Array(pts.length)
    const sy: number[] = new Array(pts.length)
    const sd: number[] = new Array(pts.length)
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      // spin about Y, then tip the axis towards the reader
      const rx = p.x * cosA + p.z * sinA
      const rz = -p.x * sinA + p.z * cosA
      const ry = p.y * cosT - rz * sinT
      const rz2 = p.y * sinT + rz * cosT
      sx[i] = x + rx * r
      sy[i] = y + ry * r
      sd[i] = (rz2 + 1) / 2 // 0 = far side, 1 = near side
    }

    ctx.save()
    ctx.lineWidth = Math.max(0.5, r * 0.006)
    for (const [i, j] of links) {
      const d = (sd[i] + sd[j]) / 2
      ctx.strokeStyle = `rgba(206, 188, 148, ${(0.05 + 0.20 * d * d).toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(sx[i], sy[i])
      ctx.lineTo(sx[j], sy[j])
      ctx.stroke()
    }
    for (let i = 0; i < pts.length; i++) {
      const d = sd[i]
      // each point breathes on its own phase, so the mesh never sits still
      const pulse = still ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 1.7 + jitter[i] * TAU)
      const size = Math.max(0.6, r * (0.008 + 0.017 * d) * (0.85 + 0.3 * pulse))
      ctx.fillStyle = `rgba(${Math.round(214 + 32 * d)} ${Math.round(200 + 34 * d)} ${Math.round(166 + 46 * d)} / ${(0.16 + 0.74 * d * d).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(sx[i], sy[i], size, 0, TAU)
      ctx.fill()
    }
    ctx.restore()
  }

  addTick(() => {
    resize()
    clock += 1 / 60

    const sec = sectionEl.getBoundingClientRect()
    const edge = sec.top // the surface, in viewport coordinates
    const d = edge / h // 1 at the bottom of the screen, 0 at the top

    // Tell the cutout to let the ball go well before it is needed here.
    if (!tipped && d < TIP_OFF_AT) {
      onTipOff()
      tipped = true
    }
    if (tipped && d > TIP_OFF_AT + 0.06) tipped = false

    if (d > ROLL_FROM || sec.bottom < 0) {
      ctx.clearRect(0, 0, w, h)
      return
    }

    const win = dropWindow.getBoundingClientRect()
    const r0 = win.width * (94 / 600)

    const roll = smoothstep(range(d, ROLL_FROM, ROLL_TO))
    const sink = smoothstep(range(d, SINK_FROM, SINK_TO))
    const depth = clamp(-sec.top / Math.max(1, sec.height - h), 0, 1)
    const r = r0 * (1 + GROWTH * depth)

    // Comes in from the left, bounces once on the edge, rolls to the middle.
    const x = lerp(w * 0.06, w * 0.5, roll)
    let above = 0 // height of the ball's centre above the edge, before sinking
    if (roll < 0.45) {
      const u = roll / 0.45
      above = r + h * 0.85 * (1 - u * u) // falling in
    } else if (roll < 0.72) {
      const u = (roll - 0.45) / 0.27
      above = r + r * 1.5 * Math.sin(Math.PI * u) // the bounce
    } else {
      above = r // rolling along the edge
    }

    // Then it goes under, ending centred on screen well inside the dark.
    const y = lerp(edge - above, h * 0.5, sink)
    const spin = (x - w * 0.06) / r0

    ctx.clearRect(0, 0, w, h)

    // Above the line it is still the drawn ball; below the line it is the
    // mesh. Clipping both to the same edge is what sells it going under.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, w, Math.max(0, edge))
    ctx.clip()
    drawBall(x, y, r, spin)
    ctx.restore()

    if (sink > 0) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, Math.max(0, edge), w, h - Math.max(0, edge))
      ctx.clip()
      drawMesh(x, y, r, isReduced())
      ctx.restore()
    }

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__frontier = {
        d: +d.toFixed(3),
        roll: +roll.toFixed(3),
        sink: +sink.toFixed(3),
        depth: +depth.toFixed(3),
        x: Math.round(x),
        y: Math.round(y),
        r: Math.round(r),
        edge: Math.round(edge),
      }
    }
  })
}
