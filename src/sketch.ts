import { addTick, clamp, easeOutQuad } from './ticker'

// The pencil marks draw themselves on as the band scrolls through the
// viewport — the page is sketched at the reader's own pace, and scrolling
// back up un-draws it. Marks are sequenced in document order at a roughly
// constant pen speed, so longer strokes take proportionally longer.
const PEN_SPEED = 1250 // viewBox units per unit of sequence time
const MIN_STEP = 70
const MAX_STEP = 520
const GAP = 26 // beat between marks
const FADE_STEP = 300
const LEAD_IN = 90

// Drawing starts as the band's top clears the bottom of the viewport and
// finishes as the band settles into the middle of the screen.

const SVG_NS = 'http://www.w3.org/2000/svg'

interface Mark {
  el: SVGElement
  kind: 'draw' | 'fade'
  len: number
  start: number
  dur: number
}

export interface SketchScene {
  setReduced(reduced: boolean): void
}

const hasLength = (el: SVGElement): el is SVGGeometryElement =>
  typeof (el as SVGGeometryElement).getTotalLength === 'function'

// A [data-trail] guide curve is expanded into individual dashes laid along
// its arc, so the ball's flight path dots itself in stroke by stroke.
function expandTrails(sectionEl: HTMLElement): void {
  for (const guide of Array.from(sectionEl.querySelectorAll<SVGGeometryElement>('[data-trail]'))) {
    const total = guide.getTotalLength()
    if (!total) continue
    const dash = Number(guide.dataset.dash) || 15
    const gap = Number(guide.dataset.gap) || 12
    const cls = guide.getAttribute('class') ?? ''
    const frag = document.createDocumentFragment()
    for (let d = 0; d < total; d += dash + gap) {
      const a = guide.getPointAtLength(d)
      const b = guide.getPointAtLength(Math.min(d + dash, total))
      const seg = document.createElementNS(SVG_NS, 'line')
      seg.setAttribute('x1', a.x.toFixed(1))
      seg.setAttribute('y1', a.y.toFixed(1))
      seg.setAttribute('x2', b.x.toFixed(1))
      seg.setAttribute('y2', b.y.toFixed(1))
      seg.setAttribute('class', cls)
      seg.setAttribute('data-draw', '')
      seg.setAttribute('data-step', '30')
      frag.appendChild(seg)
    }
    guide.parentNode?.insertBefore(frag, guide)
    guide.remove()
  }
}

// Deterministic per-mark noise, so the sketch looks hand-drawn but identical
// on every load.
function seeded(i: number): () => number {
  let a = (0x9e3779b9 + i * 0x85ebca6b) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Rewrite each mark's geometry as a gently wandering polyline. Doing this to
// the path data rather than with an SVG filter keeps thin axis-aligned marks
// (chart bars) from landing in a degenerate filter region and vanishing.
function roughen(sectionEl: HTMLElement): void {
  Array.from(sectionEl.querySelectorAll<SVGElement>('[data-draw]')).forEach((el, i) => {
    if (!hasLength(el)) return
    const total = el.getTotalLength()
    if (!total) return

    const rnd = seeded(i + 1)
    const amp = total < 45 ? 0.55 : 1.5
    const phase1 = rnd() * Math.PI * 2
    const phase2 = rnd() * Math.PI * 2
    const freq1 = 0.028 + rnd() * 0.02
    const freq2 = 0.075 + rnd() * 0.05
    const step = clamp(total / 22, 4, 11)

    const pts: string[] = []
    for (let d = 0; d <= total + 0.001; d += step) {
      const at = Math.min(d, total)
      const p = el.getPointAtLength(at)
      const q = el.getPointAtLength(Math.min(at + 1, total))
      let tx = q.x - p.x
      let ty = q.y - p.y
      const mag = Math.hypot(tx, ty) || 1
      tx /= mag
      ty /= mag
      const wobble =
        amp * (Math.sin(at * freq1 + phase1) * 0.65 + Math.sin(at * freq2 + phase2) * 0.35)
      // ease the wander down near the ends so joins still land where drawn
      const ends = clamp(Math.min(at, total - at) / 14, 0, 1)
      const off = wobble * (0.4 + 0.6 * ends)
      pts.push(`${(p.x - ty * off).toFixed(1)} ${(p.y + tx * off).toFixed(1)}`)
    }
    if (pts.length < 2) return

    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', `M ${pts.join(' L ')}`)
    path.setAttribute('class', el.getAttribute('class') ?? '')
    path.setAttribute('data-draw', '')
    if (el.dataset.step) path.setAttribute('data-step', el.dataset.step)
    el.parentNode?.replaceChild(path, el)
  })
}

export function initSketch(sectionEl: HTMLElement, isReduced: () => boolean): SketchScene {
  expandTrails(sectionEl)
  roughen(sectionEl)

  const marks: Mark[] = []
  let cursor = LEAD_IN
  for (const el of Array.from(sectionEl.querySelectorAll<SVGElement>('[data-draw], [data-fade]'))) {
    if (el.hasAttribute('data-draw') && hasLength(el)) {
      const len = el.getTotalLength() || 1
      const dur = Number(el.dataset.step) || clamp((len / PEN_SPEED) * 1000, MIN_STEP, MAX_STEP)
      el.style.strokeDasharray = String(len)
      marks.push({ el, kind: 'draw', len, start: cursor, dur })
      // marks overlap: the next stroke begins before the last one lands
      cursor += dur * 0.55 + GAP
    } else {
      const dur = Number(el.dataset.step) || FADE_STEP
      marks.push({ el, kind: 'fade', len: 0, start: cursor, dur })
      cursor += dur * 0.3
    }
  }
  const TOTAL = cursor + 120

  const render = (t: number): void => {
    for (const m of marks) {
      const p = easeOutQuad(clamp((t - m.start) / m.dur, 0, 1))
      if (m.kind === 'draw') m.el.style.strokeDashoffset = String(m.len * (1 - p))
      else m.el.style.opacity = String(p)
    }
  }

  let reducedNow = isReduced()
  if (reducedNow) render(TOTAL)
  else render(0)

  addTick(() => {
    if (reducedNow) return
    const rect = sectionEl.getBoundingClientRect()
    const vh = window.innerHeight
    if (rect.bottom < -200 || rect.top > vh + 200) return
    const span = (vh + rect.height) * 0.5
    render(clamp((vh - rect.top) / span, 0, 1) * TOTAL)
  })

  return {
    setReduced(reduced) {
      reducedNow = reduced
      // Reduced motion rests on the finished sketch; otherwise the next
      // frame re-derives progress from scroll position.
      if (reduced) render(TOTAL)
    },
  }
}
