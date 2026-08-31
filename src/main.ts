import './style.css'
import { addTick, startTicker } from './ticker'
import { initRamp } from './ramp'
import { initDrop } from './drop'
import { initHero } from './hero'
import { initSketch } from './sketch'
import { initTornWindows } from './torn'

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)')
const isReduced = (): boolean => reducedQuery.matches

initTornWindows()

const heroEl = document.getElementById('hero')!
const rampWindow = document.getElementById('window-ramp')!
const dropWindow = document.getElementById('window-drop')!

// The engage section counts as "on show" once the hero sheet has lifted away.
const isRevealed = (): boolean =>
  heroEl.getBoundingClientRect().bottom < window.innerHeight * 0.25

const hero = initHero(heroEl, isReduced)
const ramp = initRamp(rampWindow, isReduced, isRevealed)
const drop = initDrop(dropWindow, isReduced)
const sketch = initSketch(document.getElementById('sketch')!, isReduced)

// The background notes use the same pencil machinery, scoped to each section
// so they draw on as that section comes up. The hero's cue is not in here —
// it is timed off the ball leaving, so the hero scene drives it directly.
const notes = [document.getElementById('portfolio')!, document.getElementById('quality')!].map(
  (section) => initSketch(section, isReduced),
)

reducedQuery.addEventListener('change', () => {
  hero.setReduced(isReduced())
  ramp.setReduced(isReduced())
  drop.setReduced(isReduced())
  sketch.setReduced(isReduced())
  for (const note of notes) note.setReduced(isReduced())
})

// The wedge slams (and the ball is released) on the first downward scroll
// while the ramp window is in view. Overscroll rubber-banding is clamped out
// (Safari drives scrollY negative and the snap-back would read as "down"),
// and the first scroll event shortly after load is treated as the browser
// restoring its scroll position rather than a user gesture.
const loadedAt = performance.now()
let lastY = Math.max(0, window.scrollY)
let sawFirstScroll = false
window.addEventListener(
  'scroll',
  () => {
    const y = Math.max(0, window.scrollY)
    const down = y > lastY
    lastY = y
    if (!sawFirstScroll) {
      sawFirstScroll = true
      if (performance.now() - loadedAt < 500) return
    }
    // The ramp window sits beneath the hero fold and intersects the viewport
    // from load, so only count scrolls once the hero sheet has lifted away.
    if (down && isRevealed()) ramp.onScrollDown()
  },
  { passive: true },
)

// Subtle parallax: the layer behind each cutout scrolls slower than the paper.
// Recomputed only on frames after a scroll/resize actually happened, so the
// idle page does no layout reads.
const PARALLAX = 0.06
const layers = [rampWindow, dropWindow].map((w) => ({
  windowEl: w,
  layer: w.querySelector<HTMLElement>('.window__layer')!,
}))
let parallaxDirty = true
window.addEventListener('scroll', () => (parallaxDirty = true), { passive: true })
window.addEventListener('resize', () => (parallaxDirty = true))
addTick(() => {
  if (!parallaxDirty || isReduced()) return
  parallaxDirty = false
  const vh = window.innerHeight
  for (const { windowEl, layer } of layers) {
    const rect = windowEl.getBoundingClientRect()
    if (rect.bottom < -80 || rect.top > vh + 80) continue
    const centerOffset = rect.top + rect.height / 2 - vh / 2
    layer.style.transform = `translate3d(0, ${(centerOffset * PARALLAX).toFixed(2)}px, 0)`
  }
})

startTicker()
