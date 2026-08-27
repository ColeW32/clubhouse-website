import './style.css'
import { addTick, startTicker } from './ticker'
import { initRamp } from './ramp'
import { initDrop } from './drop'
import { initHero } from './hero'

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)')
const isReduced = (): boolean => reducedQuery.matches

const heroEl = document.getElementById('hero')!
const rampWindow = document.getElementById('window-ramp')!
const dropWindow = document.getElementById('window-drop')!

const hero = initHero(heroEl, isReduced)
const ramp = initRamp(rampWindow, isReduced)
const drop = initDrop(dropWindow, isReduced)

reducedQuery.addEventListener('change', () => {
  hero.setReduced(isReduced())
  ramp.setReduced(isReduced())
  drop.setReduced(isReduced())
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
    // When the hero slides back over it (scrolling home), reset the scene
    // behind the opaque sheet so the next reveal replays.
    const heroBottom = heroEl.getBoundingClientRect().bottom
    const vh = window.innerHeight
    if (down && heroBottom < vh * 0.25) {
      ramp.onScrollDown()
    } else if (heroBottom > vh * 0.9) {
      ramp.onCovered()
    }
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
