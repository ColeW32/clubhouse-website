// Torn cutouts. The windows are holes ripped in the front sheet, not
// machine-cut rectangles: corners are slightly rounded and every edge
// wanders a couple of pixels. The same outline drives both the clip (so the
// recessed layer really is that shape) and a hairline stroke (so the cut
// edge follows the tear instead of the element's box).
import { addTick } from './ticker'

const SVG_NS = 'http://www.w3.org/2000/svg'

const WOBBLE = 3.0 // px of wander either side of the true edge
const INSET = WOBBLE + 0.8 // keeps the wander inside the element's box
const STEP = 9 // px between samples along the perimeter

interface Pt {
  x: number
  y: number
}

// Deterministic per-window noise, so a given window tears the same way on
// every load but the two windows never tear alike.
function seeded(i: number): () => number {
  let a = (0x9e3779b9 + i * 0x85ebca6b) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Walk a rounded rectangle clockwise, sampling roughly every STEP px.
function perimeter(w: number, h: number, r: number): Pt[] {
  const pts: Pt[] = []
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    const len = Math.hypot(x2 - x1, y2 - y1)
    const n = Math.max(1, Math.round(len / STEP))
    for (let i = 0; i < n; i++) {
      const t = i / n
      pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t })
    }
  }
  const arc = (cx: number, cy: number, from: number, to: number): void => {
    const n = Math.max(2, Math.round((Math.abs(to - from) * r) / STEP))
    for (let i = 0; i < n; i++) {
      const a = from + (to - from) * (i / n)
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
    }
  }
  const L = INSET
  const T = INSET
  const R = w - INSET
  const B = h - INSET
  const HALF = Math.PI / 2

  line(L + r, T, R - r, T)
  arc(R - r, T + r, -HALF, 0)
  line(R, T + r, R, B - r)
  arc(R - r, B - r, 0, HALF)
  line(R - r, B, L + r, B)
  arc(L + r, B - r, HALF, Math.PI)
  line(L, B - r, L, T + r)
  arc(L + r, T + r, Math.PI, Math.PI * 1.5)
  return pts
}

function tornPath(w: number, h: number, seed: number): string {
  const r = Math.max(5, Math.min(11, Math.min(w, h) * 0.02))
  const base = perimeter(w, h, r)
  const n = base.length
  const rnd = seeded(seed + 1)
  const p1 = rnd() * Math.PI * 2
  const p2 = rnd() * Math.PI * 2
  const p3 = rnd() * Math.PI * 2

  const torn: Pt[] = []
  for (let k = 0; k < n; k++) {
    const cur = base[k]
    const prev = base[(k - 1 + n) % n]
    const next = base[(k + 1) % n]
    let tx = next.x - prev.x
    let ty = next.y - prev.y
    const mag = Math.hypot(tx, ty) || 1
    tx /= mag
    ty /= mag
    // outward normal for a clockwise walk in screen coordinates
    const nx = ty
    const ny = -tx
    // Integer harmonics so the noise closes on itself with no seam. The
    // shortest wavelength here is still ~70px, which undulates rather than
    // crinkles — a sum of sines has no sharp turns, so it never reads as
    // jagged however much character it carries.
    const u = (k / n) * Math.PI * 2
    const wobble =
      WOBBLE *
      (0.4 * Math.sin(3 * u + p1) +
        0.28 * Math.sin(7 * u + p2) +
        0.2 * Math.sin(13 * u + p3) +
        0.12 * Math.sin(23 * u + p1 * 1.7))
    torn.push({ x: cur.x + nx * wobble, y: cur.y + ny * wobble })
  }

  // Emit through segment midpoints so the outline is a continuous curve —
  // joining the samples with straight lines would facet the edge.
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const start = mid(torn[n - 1], torn[0])
  let d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`
  for (let k = 0; k < n; k++) {
    const cur = torn[k]
    const end = mid(cur, torn[(k + 1) % n])
    d += ` Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
  }
  return `${d} Z`
}

// Held for the page's lifetime: an observer with no strong reference can be
// collected, and the tear would then stop tracking the window's size.
const observers: ResizeObserver[] = []

export function initTornWindows(): void {
  const defs = document.querySelector('.svg-defs defs')
  if (!defs) return

  document.querySelectorAll<HTMLElement>('.window, [data-torn]').forEach((win, i) => {
    const id = `torn-${i}`

    const clip = document.createElementNS(SVG_NS, 'clipPath')
    clip.setAttribute('id', id)
    clip.setAttribute('clipPathUnits', 'userSpaceOnUse')
    const clipPath = document.createElementNS(SVG_NS, 'path')
    clip.appendChild(clipPath)
    defs.appendChild(clip)

    // The stroke lives inside the clip, so its outer half is trimmed and
    // what remains is a hairline hugging the torn edge.
    const edge = document.createElementNS(SVG_NS, 'svg')
    edge.setAttribute('class', 'window__edge')
    edge.setAttribute('aria-hidden', 'true')
    const edgePath = document.createElementNS(SVG_NS, 'path')
    edge.appendChild(edgePath)
    win.appendChild(edge)

    let lastW = 0
    let lastH = 0
    const build = (): void => {
      const w = Math.round(win.clientWidth)
      const h = Math.round(win.clientHeight)
      if (!w || !h || (w === lastW && h === lastH)) return
      lastW = w
      lastH = h
      const d = tornPath(w, h, i)
      clipPath.setAttribute('d', d)
      edgePath.setAttribute('d', d)
      edge.setAttribute('viewBox', `0 0 ${w} ${h}`)
      win.style.clipPath = `url(#${id})`
    }

    build()
    const observer = new ResizeObserver(build)
    observer.observe(win)
    observers.push(observer)
    window.addEventListener('resize', build)

    // Safety net: the two signals above are enough in a real browser, but a
    // stale outline is very visible, so poll the size twice a second as
    // well. build() early-returns unless the box actually changed.
    let since = 0
    addTick((dt) => {
      since += dt
      if (since < 0.5) return
      since = 0
      build()
    })
  })
}
