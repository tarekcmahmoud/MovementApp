"""Regenerates the PWA icons: the "monkey squat".

A side-on deep squat, Ido Portal style: heels flat, straight back, one arm
reaching to the floor ahead of the toes. Drawn as a single-weight line icon in
the Phosphor manner (round caps and joins, 20 units on a 256 grid), light ink on
the design language's dark primary (#18181b). No accent: yellow means "you're
here" in the app and nothing in the icon marks a position.

    python3 tools/make-icons.py

Writes icons/icon-192.png, icons/icon-512.png (rounded square),
icons/maskable-512.png and icons/apple-touch-icon.png (full bleed, figure
shrunk into Android's 80% safe circle), and icons/icon.svg (browser tab).
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

BG = "#18181b"        # --primary
INK = "#fafafa"       # --primary-ink
STROKE = 20           # on the 256 grid
CORNER = 58           # rounded-square corner radius, 22.5% of 256
OFFSET = (-8, 8)      # centres the figure's bounding box in the tile

# The figure, in 256-unit coordinates (before OFFSET).
HEAD = (186, 62, 20)                       # cx, cy, r
SPINE_LEG = [("M", 146, 90), ("Q", 96, 108, 76, 168), ("L", 140, 138), ("L", 112, 198)]
FOOT = [("M", 98, 200), ("L", 150, 200)]
ARM = [("M", 146, 90), ("L", 200, 200)]
PATHS = (SPINE_LEG, FOOT, ARM)


def points(path, steps=32):
    """Flatten a path of M/L/Q commands into a polyline."""
    pts = []
    for cmd in path:
        if cmd[0] in "ML":
            pts.append(cmd[1:])
        else:
            (x0, y0), (cx, cy, x1, y1) = pts[-1], cmd[1:]
            for k in range(1, steps + 1):
                t = k / steps
                pts.append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1,
                            (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1))
    return pts


def render(size, rounded, scale=1.0):
    ss = 4                                   # supersample, then downscale
    s = size * ss
    k = s / 256
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=CORNER * k, fill=BG)
    else:
        d.rectangle([0, 0, s, s], fill=BG)

    def xy(x, y):
        # Offset, then scale about the tile's centre.
        return ((128 + (x + OFFSET[0] - 128) * scale) * k,
                (128 + (y + OFFSET[1] - 128) * scale) * k)

    w = STROKE * scale * k
    for path in PATHS:
        pts = [xy(*p) for p in points(path)]
        d.line(pts, fill=INK, width=round(w))
        for x, y in pts:                     # round caps and joins
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=INK)
    cx, cy = xy(*HEAD[:2])
    r = HEAD[2] * scale * k
    d.ellipse([cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2], fill=INK)
    d.ellipse([cx - r + w / 2, cy - r + w / 2, cx + r - w / 2, cy + r - w / 2], fill=BG)
    return img.resize((size, size), Image.LANCZOS)


def svg():
    def d(path):
        return "".join(c[0] + " ".join("%g" % v for v in c[1:]) for c in path)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n'
        '  <rect width="256" height="256" rx="%g" fill="%s"/>\n'
        '  <g transform="translate(%g %g)" fill="none" stroke="%s" stroke-width="%g" '
        'stroke-linecap="round" stroke-linejoin="round">\n'
        '    <circle cx="%g" cy="%g" r="%g"/>\n%s\n  </g>\n</svg>\n'
    ) % (CORNER, BG, OFFSET[0], OFFSET[1], INK, STROKE, *HEAD,
         "\n".join('    <path d="%s"/>' % d(p) for p in PATHS))


if __name__ == "__main__":
    render(192, True).save(os.path.join(ROOT, "icon-192.png"))
    render(512, True).save(os.path.join(ROOT, "icon-512.png"))
    render(512, False, 0.85).save(os.path.join(ROOT, "maskable-512.png"))
    render(180, False, 0.9).save(os.path.join(ROOT, "apple-touch-icon.png"))
    with open(os.path.join(ROOT, "icon.svg"), "w") as f:
        f.write(svg())
    print("icons written to", os.path.normpath(ROOT))
