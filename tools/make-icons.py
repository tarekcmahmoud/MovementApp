"""Regenerates the PWA icons: design D2, the "cycle ring".

Six segments read clockwise from 12 o'clock like weeks of a cycle: two done
(ink), the current one (mid grey), three to come (light). Black and white only,
per the v2 visual system - the yellow accent is kept for the app itself.

    python3 tools/make-icons.py

Writes icons/icon-192.png, icons/icon-512.png (rounded square, light),
icons/maskable-512.png (full bleed, ring inside Android's 80% safe zone), and
icons/icon.svg (browser tab; switches to the dark variant in dark mode).
"""
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

LIGHT = {"bg": "#ffffff", "segs": ["#09090b", "#09090b", "#71717a", "#e4e4e7", "#e4e4e7", "#e4e4e7"]}
DARK = {"bg": "#09090b", "segs": ["#fafafa", "#fafafa", "#a1a1aa", "#3f3f46", "#3f3f46", "#3f3f46"]}

# Geometry as fractions of the icon's side.
OUTER = 0.29     # ring outer radius
INNER = 0.19     # ring inner radius
GAP = 0.028      # straight gap between segments (constant width)
CORNER = 0.225   # rounded-square corner radius for the "any" icons
STEPS = 48       # arc points per segment


def segment_points(cx, cy, s, i):
    """Polygon for segment i (0 = the one starting at 12 o'clock)."""
    ro, ri, g = OUTER * s, INNER * s, GAP * s / 2
    a0, a1 = math.radians(-90 + 60 * i), math.radians(-90 + 60 * (i + 1))
    # Offset each end by the angle that keeps the gap's width constant.
    do, di = math.asin(g / ro), math.asin(g / ri)
    pts = []
    for k in range(STEPS + 1):
        a = (a0 + do) + (a1 - a0 - 2 * do) * k / STEPS
        pts.append((cx + ro * math.cos(a), cy + ro * math.sin(a)))
    for k in range(STEPS + 1):
        a = (a1 - di) - (a1 - a0 - 2 * di) * k / STEPS
        pts.append((cx + ri * math.cos(a), cy + ri * math.sin(a)))
    return pts


def render(size, theme, rounded):
    ss = 4                                   # supersample, then downscale
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=CORNER * s, fill=theme["bg"])
    else:
        d.rectangle([0, 0, s, s], fill=theme["bg"])
    for i, col in enumerate(theme["segs"]):
        d.polygon(segment_points(s / 2, s / 2, s, i), fill=col)
    return img.resize((size, size), Image.LANCZOS)


def svg_paths(theme, s=100):
    out = []
    for i, col in enumerate(theme["segs"]):
        pts = segment_points(s / 2, s / 2, s, i)
        d = "M" + " L".join("%.2f %.2f" % p for p in pts) + " Z"
        out.append('<path class="s%d" d="%s"/>' % (i, d))
    return "\n  ".join(out)


def svg():
    css = []
    for name, t in (("", LIGHT), ("dark", DARK)):
        rules = ".bg{fill:%s}" % t["bg"] + "".join(".s%d{fill:%s}" % (i, c) for i, c in enumerate(t["segs"]))
        css.append(rules if not name else "@media (prefers-color-scheme: dark){%s}" % rules)
    r = CORNER * 100
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n'
        "<style>%s</style>\n"
        '  <rect class="bg" width="100" height="100" rx="%.1f"/>\n  %s\n</svg>\n'
    ) % ("".join(css), r, svg_paths(LIGHT))


if __name__ == "__main__":
    render(192, LIGHT, True).save(os.path.join(ROOT, "icon-192.png"))
    render(512, LIGHT, True).save(os.path.join(ROOT, "icon-512.png"))
    render(512, LIGHT, False).save(os.path.join(ROOT, "maskable-512.png"))
    render(180, LIGHT, False).save(os.path.join(ROOT, "apple-touch-icon.png"))
    with open(os.path.join(ROOT, "icon.svg"), "w") as f:
        f.write(svg())
    print("icons written to", os.path.normpath(ROOT))
