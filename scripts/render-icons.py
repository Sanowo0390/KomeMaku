#!/usr/bin/env python3
"""Build Chrome/Edge PNG icon variants reproducibly from the approved SVG artwork."""
from pathlib import Path
import io
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"
for size in (16, 32, 48, 128):
    svg = ICONS / ("icon-small.svg" if size <= 32 else "icon.svg")
    raw = cairosvg.svg2png(url=str(svg), output_width=size * 4, output_height=size * 4)
    with Image.open(io.BytesIO(raw)) as image:
        icon = image.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
        icon.save(ICONS / f"icon{size}.png", optimize=True)
print("Generated 16/32/48/128 PNGs from approved KomeMaku mint SVG artwork")
