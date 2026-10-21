import './style.css'
import { addTick, startTicker, visibleRatio } from './ticker'
import { initPortfolio } from './portfolio'
import { initDrop } from './drop'
import { initHero } from './hero'
import { initSketch } from './sketch'
import { initTornWindows } from './torn'
import { initFrontier } from './frontier'
import { initFooter } from './footer'

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)')
const isReduced = (): boolean => reducedQuery.matches

initTornWindows()
initFooter()

const heroEl = document.getElementById('hero')!
const portfolioWindow = document.getElementById('window-portfolio')!
const dropWindow = document.getElementById('window-drop')!

// The portfolio section counts as "on show" once the hero sheet has lifted away.
const isRevealed = (): boolean =>
  heroEl.getBoundingClientRect().bottom < window.innerHeight * 0.25

// The ball starts rolling in earlier than that — the moment the lifting sheet
// begins uncovering the window's box — so the scene is already in motion as
// the reader arrives and can be dismissed sooner.
const isAppearing = (): boolean =>
  heroEl.getBoundingClientRect().bottom < window.innerHeight * 0.72

const hero = initHero(heroEl, isReduced)
const portfolio = initPortfolio(portfolioWindow, isReduced, isAppearing)
const drop = initDrop(dropWindow, isReduced)
const sketch = initSketch(document.getElementById('sketch')!, isReduced)

initFrontier(
  document.querySelector<HTMLCanvasElement>('[data-ball-canvas]')!,
  document.getElementById('frontier')!,
  dropWindow,
  isReduced,
  () => drop.release(),
  // The finale may not put its ball on stage until the cutout's ball is gone
  // — or the cutout itself is, in which case nobody can see it anyway.
  () => drop.hasLeft() || dropWindow.getBoundingClientRect().bottom < 0,
)

// The rail's targets need computing, not plain anchors: the portfolio section
// sits INSIDE the sticky fold, so its document offset is ~0 — a native jump
// to #portfolio would land back at the top, under the hero. Each act gets
// the scroll position where it is actually on show, and a smooth glide
// there plays the scenes on the way past (the relay already copes with
// being scrolled through quickly).
const railTarget: Record<string, () => number> = {
  portfolio: () => window.innerHeight * 1.02,
  quality: () =>
    document.getElementById('quality')!.getBoundingClientRect().top + window.scrollY,
  intelligence: () =>
    document.getElementById('frontier')!.getBoundingClientRect().top +
    window.scrollY -
    window.innerHeight * 0.55,
}
// The footer's section links use the same targets.
document.querySelectorAll<HTMLAnchorElement>('a[data-rail]').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault()
    window.scrollTo({
      top: Math.max(0, Math.round(railTarget[link.dataset.rail!]())),
      behavior: isReduced() ? 'auto' : 'smooth',
    })
  })
})

// Arriving from another page with a section link (/#quality): the native
// jump would land on the wrong spot for the same reason, so go to the
// computed target instead. The scenes above it settle themselves as they
// are scrolled past.
const hashTarget: Record<string, string> = {
  '#portfolio': 'portfolio',
  '#quality': 'quality',
  '#frontier': 'intelligence',
}
const arrivedAt = hashTarget[location.hash]
if (arrivedAt) {
  requestAnimationFrame(() =>
    window.scrollTo({ top: Math.max(0, Math.round(railTarget[arrivedAt]())), behavior: 'auto' }),
  )
}

// The cascade keeps up with the reader: once the drop window is properly on
// screen, a still-chocked ball rolls itself out rather than waiting for one
// more scroll gesture. (A reader who flies past entirely is handled by the
// portfolio settling itself when its window leaves the viewport.)
addTick(() => {
  if (visibleRatio(dropWindow) >= 0.5) portfolio.autoRoll()
})

// The background notes use the same pencil machinery, scoped to each section
// so they draw on as that section comes up. The hero's cue is not in here —
// it is timed off the ball leaving, so the hero scene drives it directly.
const notes = [document.getElementById('portfolio')!, document.getElementById('quality')!].map(
  (section) => initSketch(section, isReduced),
)

reducedQuery.addEventListener('change', () => {
  hero.setReduced(isReduced())
  portfolio.setReduced(isReduced())
  drop.setReduced(isReduced())
  sketch.setReduced(isReduced())
  for (const note of notes) note.setReduced(isReduced())
})

// The wedge slams (and the ball is released) on the first downward scroll
// while the portfolio window is in view. Overscroll rubber-banding is clamped out
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
    // The portfolio window sits beneath the hero fold and intersects the viewport
    // from load, so only count scrolls once the hero sheet has lifted away.
    if (down && isRevealed()) portfolio.onScrollDown()
  },
  { passive: true },
)

// Subtle parallax: the layer behind each cutout scrolls slower than the paper.
// Recomputed only on frames after a scroll/resize actually happened, so the
// idle page does no layout reads.
const PARALLAX = 0.06
const layers = [portfolioWindow, dropWindow].map((w) => ({
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
