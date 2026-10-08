"""
DocumentDB for VS Code screenshot framing tool.

Frames tool screenshots in the DocumentDB release-notes style:
  - brand background: pale blue -> cyan gradient with a subtle dot grid
  - screenshot centred with even margins, 16 px rounded corners, hairline border,
    Fluent 2 shadow16 (drawn at 2x token values)
  - every output is 1920 px wide; smaller captures get more background
  - optional numbered badges, legend cards and arrows
  - whole image gets transparent rounded outer corners (32 px at 1920)
  - Lanczos resampling everywhere

Requires Python 3 with Pillow and numpy (pip install pillow numpy).

Usage:
  python frame.py jobs.json [name ...]       run all jobs (or only the named ones)
  python frame.py --round <file.png> [...]    only round the outer corners of finished graphics
  python frame.py --measure <file.png>        print row spacing hints to choose a scale

jobs.json: a "src" folder, an "out" folder (both relative to the jobs file) and one entry per
image with optional keys: scale, pad, pad_color, mode ("frame" or "panels"), panels, badges,
legend, arrows. A complete, working example is ../references/example-jobs.json.
All coordinates (badges, panels, arrows) are in SOURCE pixels of the original capture.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np
import json, math, os, sys

# ---- Design tokens -------------------------------------------------------------------
CANVAS_W = 1920          # every framed image has the same width
MARGIN = 64              # space above and below the screenshot
FULL_WIDTH = 1792        # a 1920 px capture is scaled to this width
BASE_SCALE = FULL_WIDTH / 1920   # ~0.933
RADIUS = 16              # screenshot corner radius (about 7 px at 800 px display)
CANVAS_RADIUS = 32       # outer image corner radius at 1920 (about 13 px at 800 px display)
PANEL_RADIUS = 8         # floating VS Code quick-pick panels (source px)
SS = 4                   # supersampling for anti-aliased shapes

BLUE = (0x00, 0x70, 0xE0)        # DocumentDB brand blue: badges, arrows
NAVY = (0x25, 0x2F, 0x3E)        # text in legend cards
BG_STOPS = ((0xEE, 0xF5, 0xFD), (0xEB, 0xF3, 0xFC), (0xE9, 0xF8, 0xFE))
DOT_ALPHA = 26                   # dot grid: BLUE at ~10% opacity
DOT_STEP, DOT_R = 32, 2
def _font(*names):
    """Segoe UI matches the VS Code UI on Windows. Override with DOCS_FONT_DIR on other systems."""
    dirs = [os.environ.get("DOCS_FONT_DIR", ""), os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")]
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if d and os.path.exists(p):
                return p
    raise FileNotFoundError(f"Font not found: {names}. Set DOCS_FONT_DIR to a folder containing it.")


FONT_REG = _font("segoeui.ttf", "SegoeUI.ttf")
FONT_SEMI = _font("seguisb.ttf", "SegoeUI-Semibold.ttf")


# ---- Primitives ----------------------------------------------------------------------
def background(w, h):
    """Diagonal gradient (60% x, 40% y) through three stops, plus a dot grid."""
    xs = np.linspace(0, 1, w, endpoint=False)[None, :]
    ys = np.linspace(0, 1, h, endpoint=False)[:, None]
    t = xs * 0.6 + ys * 0.4
    c1, c2, c3 = (np.array(c, float) for c in BG_STOPS)
    t1 = np.clip(t / 0.45, 0, 1)[..., None]
    t2 = np.clip((t - 0.45) / 0.55, 0, 1)[..., None]
    rgb = np.where((t < 0.45)[..., None], c1 + (c2 - c1) * t1, c2 + (c3 - c2) * t2)
    bg = Image.fromarray(np.round(rgb).astype(np.uint8), "RGB").convert("RGBA")
    dots = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(dots)
    step, r = DOT_STEP * SS, DOT_R * SS
    for y in range(step // 2, h * SS, step):
        for x in range(step // 2, w * SS, step):
            d.ellipse((x - r, y - r, x + r, y + r), fill=BLUE + (DOT_ALPHA,))
    bg.alpha_composite(dots.resize((w, h), Image.LANCZOS))
    return bg


def rounded_mask(w, h, r):
    m = Image.new("L", (w * SS, h * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * SS - 1, h * SS - 1), r * SS, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def round_corners(img, r=None):
    """RGBA copy with transparent, anti-aliased outer corners (radius scales with width)."""
    img = img.convert("RGBA")
    r = round(CANVAS_RADIUS * img.width / CANVAS_W) if r is None else r
    a = np.minimum(np.asarray(img.getchannel("A")), np.asarray(rounded_mask(img.width, img.height, r)))
    img.putalpha(Image.fromarray(a))
    return img


def shadow(canvas, box, r):
    """Fluent 2 shadow16 at 2x: ambient 0 0 4px 12% + key 0 16px 32px 14%."""
    x0, y0, x1, y1 = box
    w, h = canvas.size
    for dy, blur, alpha in ((0, 4, 0.12), (16, 16, 0.14)):
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle((x0, y0 + dy, x1, y1 + dy), r, fill=(0, 0, 0, round(255 * alpha)))
        canvas.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def badge(canvas, cx, cy, label, size=56):
    """Numbered step badge: white-bordered rounded square in brand blue, Segoe UI Semibold."""
    font = ImageFont.truetype(FONT_SEMI, round(size * 0.56) * SS)
    s, pad = size * SS, 10 * SS
    tile = Image.new("RGBA", (s + 2 * pad, s + 2 * pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle((pad, pad, pad + s, pad + s), 12 * SS, fill=(255, 255, 255, 255))
    b = 4 * SS
    d.rounded_rectangle((pad + b, pad + b, pad + s - b, pad + s - b), 9 * SS, fill=BLUE + (255,))
    d.text((pad + s / 2, pad + s / 2 - SS), label, font=font, fill=(255, 255, 255, 255), anchor="mm")
    tile = tile.resize((size + 20, size + 20), Image.LANCZOS)
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))   # Fluent shadow8 at 2x
    ImageDraw.Draw(sh).rounded_rectangle((cx - size / 2, cy - size / 2 + 8, cx + size / 2, cy + size / 2 + 8), 12, fill=(0, 0, 0, 46))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(8)))
    canvas.alpha_composite(tile, (round(cx - size / 2 - 10), round(cy - size / 2 - 10)))


def arrow(canvas, pts, width=6, head=22, color=BLUE):
    """Quadratic Bezier (start, control, end) in canvas px, round start cap,
    28 degree filled arrowhead, thin white halo so it reads over UI and background."""
    (x0, y0), (cx, cy), (x1, y1) = pts
    path = []
    for i in range(121):
        t = i / 120
        path.append(((1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1,
                     (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1))
    ang = math.atan2(y1 - cy, x1 - cx)
    back = head * 0.8
    path = [p for p in path if math.hypot(p[0] - x1, p[1] - y1) > back] + \
           [(x1 - back * math.cos(ang), y1 - back * math.sin(ang))]
    w, h = canvas.size
    layer = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    sp = [(x * SS, y * SS) for x, y in path]
    d.line(sp, fill=color + (255,), width=width * SS, joint="curve")
    rr = width * SS / 2
    d.ellipse((sp[0][0] - rr, sp[0][1] - rr, sp[0][0] + rr, sp[0][1] + rr), fill=color + (255,))
    hx, hy, L, a = x1 * SS, y1 * SS, head * SS, math.radians(28)
    d.polygon([(hx, hy),
               (hx - L * math.cos(ang - a), hy - L * math.sin(ang - a)),
               (hx - L * math.cos(ang + a), hy - L * math.sin(ang + a))], fill=color + (255,))
    layer = layer.resize((w, h), Image.LANCZOS)
    halo = layer.getchannel("A").filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.GaussianBlur(1))
    white = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    white.putalpha(halo)
    canvas.alpha_composite(white)
    canvas.alpha_composite(layer)


def draw_legend(canvas, x, y, total_w, hgt, items, gap=24):
    """White Fluent cards under the screenshot: badge + text (Segoe UI 24, bold segments)."""
    n = len(items)
    cw = (total_w - gap * (n - 1)) / n
    fr, fb = ImageFont.truetype(FONT_REG, 24), ImageFont.truetype(FONT_SEMI, 24)
    for i, (label, parts) in enumerate(items):
        cx0 = round(x + i * (cw + gap)); cx1 = round(cx0 + cw)
        shadow(canvas, (cx0, y, cx1, y + hgt), 16)
        card = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(card).rounded_rectangle((cx0, y, cx1, y + hgt), 16, fill=(255, 255, 255, 255),
                                               outline=(224, 224, 224, 255), width=2)
        canvas.alpha_composite(card)
        badge(canvas, cx0 + 56, y + hgt / 2, label)
        tx = cx0 + 112; maxw = cx1 - 24 - tx
        d = ImageDraw.Draw(canvas)
        words = [(wd, bold) for txt, bold in parts for wd in txt.split(" ") if wd]
        sp = d.textlength(" ", font=fr)
        lines, cur, curw = [], [], 0
        for wd, bold in words:
            wl = d.textlength(wd, font=fb if bold else fr)
            if cur and curw + sp + wl > maxw:
                lines.append(cur); cur, curw = [], 0
            curw += (sp if cur else 0) + wl; cur.append((wd, bold))
        lines.append(cur)
        if len(lines) > 2:
            warn(f"legend card {label} wraps to {len(lines)} lines and overflows its card; shorten the text")
        lh = 32; ty = y + hgt / 2 - lh * len(lines) / 2 + lh / 2
        for line in lines:
            xx = tx
            for wd, bold in line:
                f = fb if bold else fr
                d.text((xx, ty), wd, font=f, fill=NAVY, anchor="lm")
                xx += d.textlength(wd, font=f) + sp
            ty += lh


# ---- Layouts -------------------------------------------------------------------------
def warn(msg):
    print(f"WARNING: {msg}", file=sys.stderr)


def opaque(img):
    """Flatten transparent captures onto white so they don't leave holes in the card."""
    if img.getextrema()[3][0] < 255:
        white = Image.new("RGBA", img.size, (255, 255, 255, 255))
        white.alpha_composite(img)
        return white
    return img


def frame(src, dst, scale=BASE_SCALE, badges=(), legend=None, pad=0, pad_color=None, arrows=()):
    """Standard layout: whole capture as one card, centred on a 1920 wide background."""
    img = opaque(Image.open(src).convert("RGBA"))
    if pad:   # extend tight crops with the capture's own background colour (l, t, r, b)
        p = (pad,) * 4 if isinstance(pad, int) else tuple(pad)
        bgc = tuple(pad_color) + (255,) if pad_color else img.getpixel((img.width - 2, img.height - 2))
        ext = Image.new("RGBA", (img.width + p[0] + p[2], img.height + p[1] + p[3]), bgc)
        ext.paste(img, (p[0], p[1]))
        img = ext
        badges = [(x + p[0], y + p[1], l) for x, y, l in badges]
        arrows = [[(x + p[0], y + p[1]) for x, y in a] for a in arrows]
    w, h = round(img.width * scale), round(img.height * scale)
    if w > CANVAS_W - 2 * MARGIN:
        warn(f"{os.path.basename(src)} is {w} px wide after scaling; it touches or exceeds the {CANVAS_W} px canvas")
    shot = img.resize((w, h), Image.LANCZOS) if (w, h) != img.size else img
    leg_h = 96 if legend else 0
    # with a legend: 64 above, 48 gap, 96 legend, 48 below
    cw, ch = CANVAS_W, h + 2 * MARGIN + (leg_h + 32 if legend else 0)
    ox, oy = (cw - w) // 2, MARGIN
    canvas = background(cw, ch)
    shadow(canvas, (ox, oy, ox + w, oy + h), RADIUS)
    canvas.paste(shot, (ox, oy), rounded_mask(w, h, RADIUS))
    border = Image.new("RGBA", (cw * SS, ch * SS), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle((ox * SS, oy * SS, (ox + w) * SS - 1, (oy + h) * SS - 1),
                                             RADIUS * SS, outline=(0, 0, 0, 30), width=2 * SS)
    canvas.alpha_composite(border.resize((cw, ch), Image.LANCZOS))
    to_c = lambda x, y: (ox + x * scale, oy + y * scale)
    for pts in arrows:
        arrow(canvas, [to_c(*q) for q in pts])
    for sx, sy, label in badges:
        badge(canvas, *to_c(sx, sy), label)
    if legend:
        draw_legend(canvas, ox, oy + h + 48, w, leg_h, legend)
    round_corners(canvas).save(dst, optimize=True)
    return dst, canvas.size


def frame_panels(src, dst, panels, scale=BASE_SCALE, radius=PANEL_RADIUS, badges=(), arrows=()):
    """Floating-panel layout: lift quick-pick panels (x0, y0, x1, y1 inclusive) out of a
    white capture, keep their relative layout, place them straight on the background."""
    img = opaque(Image.open(src).convert("RGBA"))
    for x0, y0, x1, y1 in panels:
        if not (0 <= x0 < x1 < img.width and 0 <= y0 < y1 < img.height):
            raise ValueError(f"panel {[x0, y0, x1, y1]} is outside the {img.width}x{img.height} capture")
    gx0 = min(p[0] for p in panels); gy0 = min(p[1] for p in panels)
    gx1 = max(p[2] for p in panels); gy1 = max(p[3] for p in panels)
    gw, gh = round((gx1 - gx0 + 1) * scale), round((gy1 - gy0 + 1) * scale)
    cw, ch = CANVAS_W, gh + 2 * MARGIN
    ox, oy = (cw - gw) // 2, MARGIN
    canvas = background(cw, ch)
    r = round(radius * scale)
    placed = []
    for x0, y0, x1, y1 in panels:
        crop = img.crop((x0, y0, x1 + 1, y1 + 1))
        w, h = round(crop.width * scale), round(crop.height * scale)
        placed.append((crop.resize((w, h), Image.LANCZOS),
                       ox + round((x0 - gx0) * scale), oy + round((y0 - gy0) * scale), w, h))
    for _, px, py, w, h in placed:
        shadow(canvas, (px, py, px + w, py + h), r)
    for crop, px, py, w, h in placed:
        canvas.paste(crop, (px, py), rounded_mask(w, h, r))
    to_c = lambda x, y: (ox + (x - gx0) * scale, oy + (y - gy0) * scale)
    for pts in arrows:
        arrow(canvas, [to_c(*q) for q in pts])
    for sx, sy, label in badges:
        badge(canvas, *to_c(sx, sy), label)
    round_corners(canvas).save(dst, optimize=True)
    return dst, canvas.size


# ---- Helpers -------------------------------------------------------------------------
def measure(path):
    """Rough text-row spacing: distance between rows that contain dark text pixels.
    Compare with a full 1920 capture (tree rows ~41 px, table rows ~55 px at 125%)."""
    a = np.asarray(Image.open(path).convert("L")).astype(int)
    dark = (a < 110).sum(axis=1) > 3
    starts = [i for i in range(1, len(dark)) if dark[i] and not dark[i - 1]]
    gaps = np.diff(starts)
    gaps = gaps[(gaps > 15) & (gaps < 120)]
    print(f"{path}: {Image.open(path).size}, text rows found {len(starts)}, "
          f"median row spacing {np.median(gaps) if len(gaps) else 'n/a'} px")


def run_jobs(jobs_path, only=()):
    base = os.path.dirname(os.path.abspath(jobs_path))
    cfg = json.load(open(jobs_path, encoding="utf-8"))
    src_dir = os.path.join(base, cfg.get("src", "originals"))
    out_dir = os.path.join(base, cfg.get("out", "."))
    unknown = [n for n in only if n not in cfg["jobs"]]
    if unknown:
        sys.exit(f"ERROR: not in {jobs_path}: {', '.join(unknown)}")
    for name, kw in cfg["jobs"].items():
        if only and name not in only:
            continue
        kw = dict(kw)
        mode = kw.pop("mode", "frame")
        if mode not in ("frame", "panels"):
            sys.exit(f"ERROR: {name}: unknown mode '{mode}' (use 'frame' or 'panels')")
        kw["badges"] = [tuple(b) for b in kw.get("badges", [])]
        kw["arrows"] = [[tuple(p) for p in a] for a in kw.get("arrows", [])]
        if "legend" in kw:
            kw["legend"] = [(l, [(t, bool(b)) for t, b in parts]) for l, parts in kw["legend"]]
        src, dst = os.path.join(src_dir, name), os.path.join(out_dir, kw.pop("out", name))
        fn = frame_panels if mode == "panels" else frame
        print(fn(src, dst, **kw))


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(1)
    if args[0] == "--round":
        for f in args[1:]:
            round_corners(Image.open(f)).save(f, optimize=True); print("rounded", f)
    elif args[0] == "--measure":
        for f in args[1:]:
            measure(f)
    else:
        run_jobs(args[0], args[1:])
