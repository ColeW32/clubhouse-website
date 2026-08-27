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
- Scene 1 (ramp): the window starts empty; when the section is revealed the
  ball rolls in from up-slope, bounces off the wedge stop, and settles chocked
  against it. On the next downward scroll the trapdoor wedge slams flush into
  the slope and the ball rolls out of the window. Scene 2 (drop): the ball
  falls in from the top, bounces on the apex of the point, and settles on it.
  Both scenes reset when hidden, and respect `prefers-reduced-motion` (static
  poses).
- Append `?slow=3` to the URL to stretch scene time for tuning.

## Commands

```bash
npm install
npm run dev     # http://localhost:5199
npm run build   # production build to dist/
npm run check   # typecheck
```
