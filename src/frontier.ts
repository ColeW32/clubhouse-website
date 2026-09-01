import { addTick, clamp } from './ticker'

// The last act. The ball leaves the second window, rolls out to the middle of
// the screen, and parks there on top of the off-black mass as it rises. Only
// once it has landed and the reader pushes on does it resolve into a pixelated
// orb — the same object seen as facets — which keeps shimmering and grows as
// the page carries on. Arriving and pixelating are deliberately separate: the
// ball has to be seen to stop before it changes.
//
// It is drawn on its own fixed canvas rather than inside the window's SVG,
// because from here on it has to travel across the page, not within a cutout.

// The settled ball's place inside the drop window, as fractions of that
// window's box (viewBox 600x460, ball centre 302,189, radius 94).
const BALL_X_FRAC = 302 / 600
const BALL_Y_FRAC = 189 / 460
const BALL_R_FRAC = 94 / 600

const TRAVEL = 0.55 // section-approach progress at which it reaches centre
const GROWTH = 0.85 // extra radius, as a fraction, at full depth
const CELL_PX = 13 // facet edge, held constant so growth ADDS facets
const MIN_CELLS = 11
const SHIMMER_HZ = 0.42 // slow enough to read as glinting, not flickering
const ROLL_TURN = 4.5 // radians turned across the whole roll-out

const TAU = Math.PI * 2
const smoothstep = (u: number): number => u * u * (3 - 2 * u)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// Deterministic per-facet phase, so every mirror catches the light on its own
// beat instead of the whole orb pulsing at once.
function facetPhase(gx: number, gy: number): number {
  const s = Math.sin(gx * 127.1 + gy * 311.7) * 43758.5453
  return (s - Math.floor(s)) * TAU
}

// Light from the upper left, the same direction the window recesses imply.
const LX = -0.42
const LY = -0.52
const LZ = 0.74

interface Rgb {
  r: number
  g: number
  b: number
}
const INK_PAPER: Rgb = { r: 34, g: 55, b: 47 }
const INK_BLACK: Rgb = { r: 239, g: 231, b: 214 }

function inkAt(onBlack: number): string {
  const t = clamp(onBlack, 0, 1)
  const r = Math.round(lerp(INK_PAPER.r, INK_BLACK.r, t))
  const g = Math.round(lerp(INK_PAPER.g, INK_BLACK.g, t))
  const b = Math.round(lerp(INK_PAPER.b, INK_BLACK.b, t))
  return `rgb(${r} ${g} ${b})`
}

const FACET_DARK: Rgb = { r: 74, g: 63, b: 44 }
const FACET_MID: Rgb = { r: 176, g: 156, b: 118 }
const FACET_LIT: Rgb = { r: 246, g: 240, b: 226 }

function ramp(t: number): string {
  const u = clamp(t, 0, 1)
  const [from, to, k] = u < 0.55 ? [FACET_DARK, FACET_MID, u / 0.55] : [FACET_MID, FACET_LIT, (u - 0.55) / 0.45]
  const r = Math.round(lerp(from.r, to.r, k))
  const g = Math.round(lerp(from.g, to.g, k))
  const b = Math.round(lerp(from.b, to.b, k))
  return `rgb(${r} ${g} ${b})`
}

export function initFrontier(
  canvas: HTMLCanvasElement,
  sectionEl: HTMLElement,
  dropWindow: HTMLElement,
  isReduced: () => boolean,
  onTakeover: () => void,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dropBall = dropWindow.querySelector<SVGGElement>('[data-ball]')
  const layer = dropWindow.querySelector<HTMLElement>('.window__layer')
  let w = 0
  let h = 0
  let dpr = 1
  let clock = 0
  let hidden = false

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

  // The drawn ball, matching the SVG one facet for facet.
  const drawOutline = (
    x: number,
    y: number,
    r: number,
    color: string,
    alpha: number,
    spin: number,
  ): void => {
    if (alpha <= 0.002) return
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(spin)
    ctx.translate(-x, -y)
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, r * 0.09)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.stroke()
    for (const f of [-0.72, -0.4, 0, 0.4, 0.72]) {
      const yy = y + r * f
      const half = r * Math.sqrt(Math.max(0, 1 - f * f))
      ctx.beginPath()
      ctx.moveTo(x - half, yy)
      ctx.lineTo(x + half, yy)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.lineTo(x, y + r)
    ctx.stroke()
    for (const rx of [0.66, 0.33]) {
      ctx.beginPath()
      ctx.ellipse(x, y, r * rx, r, 0, 0, TAU)
      ctx.stroke()
    }
    ctx.restore()
  }

  // The same sphere, resolved into square facets that each catch the light on
  // their own beat.
  const drawOrb = (x: number, y: number, r: number, alpha: number, still: boolean): void => {
    if (alpha <= 0.002) return
    // Facet size is fixed, so a bigger orb is a better-resolved one: it gains
    // mirrors as it grows instead of turning into coarser blocks.
    const cells = Math.max(MIN_CELLS, Math.round((r * 2) / CELL_PX))
    const cell = (r * 2) / cells
    const half = cells / 2
    ctx.save()
    ctx.globalAlpha = alpha
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        // sample at the cell's centre, in unit-sphere space
        const nx = (gx - half + 0.5) / half
        const ny = (gy - half + 0.5) / half
        const d2 = nx * nx + ny * ny
        if (d2 > 1) continue
        const nz = Math.sqrt(1 - d2)
        const ndotl = clamp(nx * LX + ny * LY + nz * LZ, 0, 1)
        const glint = still ? 0.5 : 0.5 + 0.5 * Math.sin(clock * TAU * SHIMMER_HZ + facetPhase(gx, gy))
        // rim stays dark so the orb reads as a sphere, not a flat disc
        const shade = 0.16 + 0.66 * ndotl
        ctx.fillStyle = ramp(shade * (0.72 + 0.52 * glint))
        ctx.fillRect(
          Math.round(x + (gx - half) * cell),
          Math.round(y + (gy - half) * cell),
          Math.ceil(cell) + 0.5,
          Math.ceil(cell) + 0.5,
        )
      }
    }
    ctx.restore()
  }

  addTick((dt) => {
    resize()
    clock += dt

    const sec = sectionEl.getBoundingClientRect()
    const win = dropWindow.getBoundingClientRect()

    // How far the black has risen into the viewport, 0 before it appears.
    const approach = clamp((h - sec.top) / h, 0, 1)

    if (approach <= 0) {
      if (!hidden) return
      ctx.clearRect(0, 0, w, h)
      if (dropBall) dropBall.style.visibility = ''
      hidden = false
      return
    }
    // From here the ball lives on the canvas, not in the window. Settle the
    // window's scene first: on a fast scroll it may still be mid-bounce, and
    // the canvas has to pick the ball up where it comes to rest.
    if (!hidden) {
      onTakeover()
      if (dropBall) dropBall.style.visibility = 'hidden'
      hidden = true
    }

    // The scene layer is parallax-shifted, so the resting ball is a few px off
    // the window box. Take that in, or the handoff visibly jumps.
    const drift = layer ? parseFloat(/translate3d\(0(?:px)?,\s*(-?[\d.]+)px/.exec(layer.style.transform)?.[1] ?? '0') : 0
    const startX = win.left + win.width * BALL_X_FRAC
    const startY = win.top + win.height * BALL_Y_FRAC + drift
    const startR = win.width * BALL_R_FRAC

    // Depth: how far we have scrolled through the section once it fills the screen.
    const depth = clamp(-sec.top / Math.max(1, sec.height - h), 0, 1)

    if (isReduced()) {
      // Hold the finished image rather than scrubbing size and position.
      ctx.clearRect(0, 0, w, h)
      drawOrb(w / 2, h / 2, startR * (1 + GROWTH * 0.6), 1, true)
      return
    }

    const travel = smoothstep(clamp(approach / TRAVEL, 0, 1))
    const x = lerp(startX, w / 2, travel)
    const y = lerp(startY, h / 2, travel)
    const r = startR * (1 + GROWTH * depth)

    // Rolling: it turns as it travels and stops turning once it parks.
    const spin = travel * ROLL_TURN

    // How much of the black is behind it — drives only the ink colour, since
    // the ball arrives on the black and is still drawn when it lands.
    const onBlack = clamp((y + r - sec.top) / (2 * r), 0, 1)
    // It resolves into facets once it is parked and the reader pushes on.
    const pixel = smoothstep(clamp(depth / 0.35, 0, 1))

    ctx.clearRect(0, 0, w, h)
    drawOutline(x, y, r, inkAt(onBlack), 1 - pixel, spin)
    drawOrb(x, y, r, pixel, isReduced())

    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__frontier = {
        approach: +approach.toFixed(3),
        travel: +travel.toFixed(3),
        depth: +depth.toFixed(3),
        onBlack: +onBlack.toFixed(3),
        pixel: +pixel.toFixed(3),
        x: Math.round(x),
        y: Math.round(y),
        r: Math.round(r),
        atCentre: Math.abs(x - w / 2) < 2 && Math.abs(y - h / 2) < 2,
      }
    }
  })
}
