# Clubhouse — marketing site

Vite + TypeScript static site (no framework yet).

## Design system

- The page is two layers of paper. The front layer is warm beige with a subtle
  grain (`--paper` + SVG-noise backgrounds in `src/style.css`). The `.window`
  elements are cutouts in that front layer — windows into a cooler, brighter
  back layer where the outline geometry lives.
- Shapes are light blue-gray outlines (`--line`) on the back layer, animated
  with scripted physics (`src/portfolio.ts`, `src/drop.ts`). Windows clip the scenes
  (`overflow: hidden`), and the back layer moves slightly slower than the page
  (parallax in `src/main.ts`) to sell the depth.
- There is exactly **one ball** on the page and it cascades down: it drops off
  the hero's string, rolls across the portfolio, and lands in the second window.
  `src/relay.ts` holds the baton — a stage may only animate the ball once every
  stage above has let it go, so it can never appear in two windows at once. The
  baton only moves forward, so each stage runs once per session and scrolling
  back up does not replay anything. Scrolling past a scene mid-play settles it
  and hands the ball on, so a fast scroll can never strand the cascade.
- The hero says what Clubhouse does and shows the portfolio straight away:
  the tagline types out, then the five app icons (`public/apps/`, the apps'
  own store artwork) drop onto the sheet like a row on a phone home screen.
- Scene 1 (portfolio, `src/portfolio.ts`): a wide cutout holding a ramp, a
  row of five app "keys", a hole and a backstop wall. The ball rolls down the
  ramp and settles chocked against the wedge. On the next downward scroll the
  wedge slams flush and the ball rolls across every key (each sinks under it
  and its name lights up: one ad, every app), then drops through the hole.
  Narrow screens see a cropped viewBox so the keys stay readable. Scene 2
  (drop): it falls in from the top, bounces on the apex of the point, and
  settles there. Under `prefers-reduced-motion` the windows hold static poses
  (first empty with every app lit, second settled — never both occupied).
- Copy rules: the five apps are named; numbers are portfolio-wide only
  (150,000 monthly active users), never per app.
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
