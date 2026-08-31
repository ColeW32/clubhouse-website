# Clubhouse — marketing site

Vite + TypeScript static site (no framework yet).

## Design system

- The page is two layers of paper. The front layer is warm beige with a subtle
  grain (`--paper` + SVG-noise backgrounds in `src/style.css`). The `.window`
  elements are cutouts in that front layer — windows into a cooler, brighter
  back layer where the outline geometry lives.
- Shapes are light blue-gray outlines (`--line`) on the back layer, animated
  with scripted physics (`src/ramp.ts`, `src/drop.ts`). Windows clip the scenes
  (`overflow: hidden`), and the back layer moves slightly slower than the page
  (parallax in `src/main.ts`) to sell the depth.
- There is exactly **one ball** on the page and it cascades down: it drops off
  the hero's string, rolls through the first window, and lands in the second.
  `src/relay.ts` holds the baton — a stage may only animate the ball once every
  stage above has let it go, so it can never appear in two windows at once. The
  baton only moves forward, so each stage runs once per session and scrolling
  back up does not replay anything. Scrolling past a scene mid-play settles it
  and hands the ball on, so a fast scroll can never strand the cascade.
- Scene 1 (ramp): the window starts empty; the ball rolls in from up-slope,
  bounces off the wedge stop, and settles chocked against it. On the next
  downward scroll the trapdoor slams flush into the slope and the ball rolls
  out. Scene 2 (drop): it falls in from the top, bounces on the apex of the
  point, and settles there. Under `prefers-reduced-motion` the windows hold
  static poses (first empty, second settled — never both occupied).
- Scenes trigger from viewport geometry measured on the tick, not from
  IntersectionObserver: the hero's tagline and cue are hidden until its scene
  runs, so a missed observer callback would have left the hero wordless.
- Append `?slow=3` to the URL to stretch scene time for tuning.

## Commands

```bash
npm install
npm run dev     # http://localhost:5199
npm run build   # production build to dist/
npm run check   # typecheck
```
