"""Write the umber copies of the app icons used in the hero row.

  python3 scripts/umber-icons.py

Same mapping as the #app-duo SVG filter in index.html (keep the two in
step): the icon's luminance, laid between umber (dark) and kraft (light).
Pre-rendered rather than filtered in CSS because Safari draws SVG filters
on HTML images at 1x, which blurs them on Retina screens.
"""
from pathlib import Path

import numpy as np
from PIL import Image

LO = np.array([0.298, 0.247, 0.169])  # umber, #4c3f2b
HI = np.array([0.835, 0.788, 0.682])  # kraft, #d5c9ae

apps = Path(__file__).resolve().parent.parent / 'public' / 'apps'
out = apps / 'umber'
out.mkdir(exist_ok=True)
for src in sorted(apps.glob('*.png')):
    img = Image.open(src).convert('RGBA')
    px = np.asarray(img).astype(np.float64) / 255
    lum = px[..., :3] @ np.array([0.213, 0.715, 0.072])
    rgb = LO + (HI - LO) * np.clip(lum, 0, 1)[..., None]
    res = np.dstack([rgb, px[..., 3]])
    Image.fromarray(np.round(res * 255).astype(np.uint8)).save(out / src.name, optimize=True)
    print(out / src.name)
