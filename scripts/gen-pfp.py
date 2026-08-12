#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click", "pillow"]
# ///
"""Generate watchy bot pfp/icon candidates (1024x1024 PNGs).

Vector variants (eye-star, telescope, star-arcs) are SVG-based (need `rsvg-convert`);
`octomosaic` builds the GitHub mark out of ⭐/📣 emoji (needs macOS Apple Color Emoji).
"""

import math
import subprocess
from pathlib import Path

from click import argument, command, option

S = 1024
BG = "#0d1117"       # GitHub dark
GOLD = "#e3b341"     # GitHub star gold
BLUE = "#58a6ff"     # GitHub link blue
WHITE = "#e6edf3"

# Canonical GitHub mark (viewBox 0 0 24 24)
GH_PATH = (
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 "
    "0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7"
    "c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 "
    "3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 "
    "1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 "
    "1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 "
    "1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 "
    "2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
)


def star_points(cx: float, cy: float, R: float, r: float, rot: float = -90) -> str:
    pts = []
    for i in range(10):
        rad = math.radians(rot + i * 36)
        radius = R if i % 2 == 0 else r
        pts.append(f"{cx + radius * math.cos(rad):.1f},{cy + radius * math.sin(rad):.1f}")
    return " ".join(pts)


def render_svg(out_dir: Path, name: str, body: str) -> Path:
    svg = out_dir / f"pfp-{name}.svg"
    svg.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">\n'
                   f'<rect width="{S}" height="{S}" fill="{BG}"/>\n{body}\n</svg>\n')
    png = out_dir / f"pfp-{name}.png"
    subprocess.run(["rsvg-convert", "-w", str(S), "-h", str(S), "-o", str(png), str(svg)], check=True)
    return png


def eye_star(out_dir: Path) -> Path:
    eye_h = 250
    return render_svg(out_dir, "eye-star", f'''
<path d="M 132 512 Q 512 {512 - eye_h} 892 512 Q 512 {512 + eye_h} 132 512 Z"
      fill="none" stroke="{WHITE}" stroke-width="46" stroke-linejoin="round"/>
<circle cx="512" cy="512" r="185" fill="{BLUE}" opacity="0.25"/>
<polygon points="{star_points(512, 522, 150, 60)}" fill="{GOLD}"/>
''')


def telescope(out_dir: Path) -> Path:
    return render_svg(out_dir, "telescope", f'''
<g transform="rotate(-32 512 640)">
  <rect x="272" y="586" width="470" height="108" rx="24" fill="{WHITE}"/>
  <rect x="700" y="570" width="90" height="140" rx="20" fill="{BLUE}"/>
  <rect x="228" y="600" width="70" height="80" rx="16" fill="{BLUE}"/>
</g>
<line x1="472" y1="702" x2="352" y2="920" stroke="{WHITE}" stroke-width="40" stroke-linecap="round"/>
<line x1="512" y1="702" x2="632" y2="920" stroke="{WHITE}" stroke-width="40" stroke-linecap="round"/>
<polygon points="{star_points(752, 232, 120, 48)}" fill="{GOLD}"/>
<polygon points="{star_points(392, 172, 62, 25)}" fill="{GOLD}" opacity="0.75"/>
<polygon points="{star_points(200, 330, 42, 17)}" fill="{GOLD}" opacity="0.5"/>
''')


def star_arcs(out_dir: Path) -> Path:
    arcs = "".join(
        f'<path d="M {512 + r * math.cos(math.radians(-45)):.0f} {512 + r * math.sin(math.radians(-45)):.0f} '
        f'A {r} {r} 0 0 1 {512 + r * math.cos(math.radians(45)):.0f} {512 + r * math.sin(math.radians(45)):.0f}"'
        f' fill="none" stroke="{BLUE}" stroke-width="34" stroke-linecap="round" opacity="{o}" transform="rotate(-45 512 512)"/>'
        for r, o in [(300, 0.9), (390, 0.6), (480, 0.35)]
    )
    return render_svg(out_dir, "star-arcs", f'<g transform="translate(-60 60)">'
                                            f'<polygon points="{star_points(512, 512, 240, 96)}" fill="{GOLD}"/>{arcs}</g>')


def gh_mask(out_dir: Path, fill: str = "white") -> "Image.Image":
    from PIL import Image

    mask_svg = out_dir / "gh-mask.svg"
    mask_svg.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 24 24">'
        f'<rect width="24" height="24" fill="black"/><path d="{GH_PATH}" fill="{fill}"/></svg>\n'
    )
    mask_png = out_dir / "gh-mask.png"
    subprocess.run(["rsvg-convert", "-w", str(S), "-h", str(S), "-o", str(mask_png), str(mask_svg)], check=True)
    return Image.open(mask_png).convert("L")


def emoji_glyph(ch: str, px: int) -> "Image.Image":
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype("/System/Library/Fonts/Apple Color Emoji.ttc", 160)
    img = Image.new("RGBA", (320, 320), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((80, 80), ch, font=font, embedded_color=True)
    return img.crop(img.getbbox()).resize((px, px), Image.LANCZOS)


def mosaic(mask: "Image.Image", cell_glyph, cols: int, coverage: int, glyph_scale: float) -> "Image.Image":
    """Fill mask cells with glyphs; cell_glyph(n) returns the glyph image for the nth placed cell."""
    from PIL import Image

    cell = S // cols
    out = Image.new("RGBA", (S, S), BG)
    n = 0
    for gy in range(cols):
        for gx in range(cols):
            cx, cy = gx * cell + cell // 2, gy * cell + cell // 2
            pts = [(cx, cy), (cx - cell // 3, cy), (cx + cell // 3, cy), (cx, cy - cell // 3), (cx, cy + cell // 3)]
            if sum(mask.getpixel(p) > 128 for p in pts) >= coverage:
                n += 1
                g = cell_glyph(n)
                off = (cell - g.width) // 2
                out.alpha_composite(g, (gx * cell + off, gy * cell + off))
    return out


def round_corners(img: "Image.Image", frac: float) -> "Image.Image":
    """Transparent rounded-rect clip (radius = frac × side) — for surfaces that don't round avatars."""
    from PIL import Image, ImageDraw

    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=int(img.width * frac), fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def octomosaic(out_dir: Path, cols: int, mega_every: int, coverage: int, glyph_scale: float, round_frac: float = 0) -> Path:
    from PIL import Image

    mask = gh_mask(out_dir)
    gsize = int((S // cols) * glyph_scale)
    star, mega = emoji_glyph("⭐", gsize), emoji_glyph("📣", gsize)
    out = mosaic(mask, lambda n: mega if n % mega_every == 0 else star, cols, coverage, glyph_scale)
    if round_frac:
        png = out_dir / f"pfp-octomosaic-{cols}-rounded.png"
        round_corners(out, round_frac).save(png)
        return png
    png = out_dir / f"pfp-octomosaic-{cols}.png"
    out.convert("RGB").save(png)

    # small-size readability strip: 36px / 64px renders, upscaled 4x
    rgb = out.convert("RGB")
    strip = Image.new("RGB", (4 * (36 + 64) + 60, 4 * 64 + 40), "#222")
    for i, px in enumerate([36, 64]):
        small = rgb.resize((px, px), Image.LANCZOS).resize((px * 4, px * 4), Image.NEAREST)
        strip.paste(small, (20 + i * (36 * 4 + 40), 20))
    strip.save(out_dir / f"pfp-octomosaic-{cols}-small.png")
    return png


KIND_EMOJI = {"star": "⭐", "unstar": "💔", "follow": "📣", "unfollow": "🔇"}
AVATAR_ORGS = ["Open-Athena", "marin-community"]


def solid_mark(out_dir: Path) -> "Image.Image":
    from PIL import Image

    mask = gh_mask(out_dir)
    out = Image.new("RGBA", (S, S), BG)
    white = Image.new("RGBA", (S, S), WHITE)
    out.paste(white, (0, 0), mask)
    return out


# Kinds whose badge glyph is h-flipped (📣 opens left; flip so it matches 🔇's rightward face)
FLIP_KINDS = {"follow"}


def add_badge(base: "Image.Image", ch: str, flip: bool = False) -> "Image.Image":
    """Composite an emoji badge into the bottom-right corner (no backing circle —
    only the glyph's actual content occludes the base)."""
    from PIL import Image

    out = base.copy()
    cx = cy = S - int(S * 0.30)
    g = emoji_glyph(ch, int(S * 0.52))
    if flip:
        g = g.transpose(Image.FLIP_LEFT_RIGHT)
    out.alpha_composite(g, (cx - g.width // 2, cy - g.height // 2))
    return out


def org_avatar(out_dir: Path, org: str) -> "Image.Image":
    from PIL import Image

    png = out_dir / f"org-{org}.png"
    if not png.exists():
        subprocess.run(["curl", "-fsSL", f"https://github.com/{org}.png?size={S}", "-o", str(png)], check=True)
    return Image.open(png).convert("RGBA").resize((S, S), Image.LANCZOS)


def trim_content(img: "Image.Image") -> tuple["Image.Image", tuple]:
    """Crop to the content bbox; returns (content, bg color to rebuild the canvas with).

    Bg is inferred from the top-left corner: transparent → alpha bbox (canvas rebuilt on GH-dark),
    solid → bbox of pixels differing from that corner color.
    """
    from PIL import Image, ImageChops

    corner = img.getpixel((0, 0))
    if corner[3] == 0:
        return img.crop(img.getchannel("A").getbbox()), tuple(Image.new("RGB", (1, 1), BG).getpixel((0, 0))) + (255,)
    bbox = ImageChops.difference(img, Image.new("RGBA", img.size, corner)).getbbox()
    return img.crop(bbox), corner


def fit_upleft(content: "Image.Image", bg: tuple, margin: float = 0.05, extent: float = 0.72) -> "Image.Image":
    """Scale content to fill an `extent`-sized box anchored up-left, clear of the badge circle."""
    from PIL import Image

    box = int(S * extent)
    scale = min(box / content.width, box / content.height)
    content = content.resize((round(content.width * scale), round(content.height * scale)), Image.LANCZOS)
    out = Image.new("RGBA", (S, S), bg)
    m = int(S * margin)
    out.alpha_composite(content, (m + (box - content.width) // 2, m + (box - content.height) // 2))
    return out


def icon_base(cache: Path, org: str) -> "Image.Image":
    """Badge-ready base for an org: local `img/logos/<slug>.svg` override (on GH-dark) if present,
    else the GH org avatar — either way trimmed and anchored up-left of the badge."""
    from PIL import Image

    svg = Path("img/logos") / f"{org.lower()}.svg"
    if svg.exists():
        png = cache / f"logo-{org.lower()}.png"
        subprocess.run(["rsvg-convert", "-w", str(S), "--keep-aspect-ratio", "-o", str(png), str(svg)], check=True)
        return fit_upleft(*trim_content(Image.open(png).convert("RGBA")))
    return fit_upleft(*trim_content(org_avatar(cache, org)))


ORG_ICON_BG = "#B2AA9D"  # OA brand tan (openathena.ai mosaic/site bg)
# The logo's natural olive/brown fills sit too close to the tan at 15px feed
# size — darken each ~55% so the glyph actually reads (favicon does the same)
ORG_ICON_DARKEN = {"#696751": "#34332A", "#9C683C": "#4E341E"}


def org_icons(out_dir: Path) -> Path:
    """FE feed org icons (96px): each `img/logos/<slug>.svg` (fills darkened)
    centered on OA brand tan — the GH org avatar's white bg is jarring in the
    dark-mode feed, and the tan matches the favicon/site treatment. Served at
    /org/<slug>.png."""
    from PIL import Image

    cache = Path("tmp")
    cache.mkdir(exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    for svg in sorted(Path("img/logos").glob("*.svg")):
        body = svg.read_text()
        for light, dark in ORG_ICON_DARKEN.items():
            body = body.replace(f'fill="{light}"', f'fill="{dark}"')
        dark_svg = cache / f"orgicon-{svg.stem}.svg"
        dark_svg.write_text(body)
        png = cache / f"orgicon-{svg.stem}.png"
        subprocess.run(["rsvg-convert", "-w", "256", "--keep-aspect-ratio", "-o", str(png), str(dark_svg)], check=True)
        glyph = Image.open(png).convert("RGBA")
        glyph.thumbnail((78, 78), Image.LANCZOS)
        out = Image.new("RGBA", (96, 96), ORG_ICON_BG)
        out.alpha_composite(glyph, ((96 - glyph.width) // 2, (96 - glyph.height) // 2))
        out.convert("RGB").save(out_dir / f"{svg.stem}.png")
    return out_dir


def avatars(out_dir: Path, cols: int, mega_every: int, coverage: int, glyph_scale: float) -> Path:
    """Per-event-kind avatar candidates for `chat.postMessage` icon_url overrides.

    Styles: mono (mask mosaic of the kind's emoji), badge (solid gold mark + emoji badge),
    pfp-badge (bot-pfp mixed mosaic + emoji badge), emoji (big emoji on GH-dark),
    org-<org> (org avatar + emoji badge).
    """
    from PIL import Image

    mask = gh_mask(out_dir)
    gsize = int((S // cols) * glyph_scale)
    pfp = mosaic(mask, lambda n, star=emoji_glyph("⭐", gsize), mega=emoji_glyph("📣", gsize): mega if n % mega_every == 0 else star,
                 cols, coverage, glyph_scale)
    mark = solid_mark(out_dir)
    bases = {"badge": mark, "pfp-badge": pfp, **{f"org-{org}": org_avatar(out_dir, org) for org in AVATAR_ORGS}}

    for kind, ch in KIND_EMOJI.items():
        variants = {
            "mono": mosaic(mask, lambda n, g=emoji_glyph(ch, gsize): g, cols, coverage, glyph_scale),
            "emoji": Image.new("RGBA", (S, S), BG),
            **{style: add_badge(base, ch) for style, base in bases.items()},
        }
        big = emoji_glyph(ch, int(S * 0.82))
        variants["emoji"].alpha_composite(big, ((S - big.width) // 2, (S - big.height) // 2))
        for style, img in variants.items():
            rgb = img.convert("RGB")
            rgb.save(out_dir / f"avatar-{style}-{kind}.png")
            rgb.resize((144, 144), Image.LANCZOS).save(out_dir / f"avatar-{style}-{kind}-sm.png")
    return out_dir


def icons(out_dir: Path) -> Path:
    """Final per-message avatar icons (512px): org avatar + kind badge, plus gold-mark fallback.

    Served at watchy.rbw.sh/icons/<slug>-<kind>.png; the worker keys slug off the event
    target's org (lowercased), falling back to `gh` for unmatched orgs.
    """
    from PIL import Image

    import json

    cache = Path("tmp")
    cache.mkdir(exist_ok=True)
    bases = {"gh": fit_upleft(*trim_content(solid_mark(cache))), **{org.lower(): icon_base(cache, org) for org in AVATAR_ORGS}}
    files = []
    for slug, base in bases.items():
        for kind, ch in KIND_EMOJI.items():
            name = f"{slug}-{kind}.png"
            add_badge(base, ch, flip=kind in FLIP_KINDS).convert("RGB").resize((512, 512), Image.LANCZOS).save(out_dir / name)
            files.append(name)
    (out_dir / "manifest.json").write_text(json.dumps({"files": files}, indent=2) + "\n")
    return out_dir


VARIANTS = {
    "eye-star": lambda out_dir, **kw: eye_star(out_dir),
    "telescope": lambda out_dir, **kw: telescope(out_dir),
    "star-arcs": lambda out_dir, **kw: star_arcs(out_dir),
    "octomosaic": lambda out_dir, **kw: octomosaic(out_dir, **kw),
    "avatars": lambda out_dir, **kw: avatars(out_dir, **kw),
    "icons": lambda out_dir, **kw: icons(out_dir),
    "org-icons": lambda out_dir, **kw: org_icons(out_dir),
}


@command
@option("-c", "--cols", default=18, help="octomosaic: grid columns (default: 18)")
@option("-g", "--glyph-scale", default=1.2, help="octomosaic: glyph size / cell size (default: 1.2)")
@option("-m", "--mega-every", default=7, help="octomosaic: every Nth glyph is a 📣 (default: 7)")
@option("-o", "--out-dir", default="tmp", help="Output directory (default: tmp/)")
@option("-r", "--round-frac", default=0.0, help="octomosaic: clip corners to a rounded rect (radius fraction of side; e.g. 0.18)")
@option("-v", "--coverage", default=3, help="octomosaic: mask samples (of 5) required to place a glyph (default: 3)")
@argument("variants", nargs=-1)
def main(cols: int, glyph_scale: float, mega_every: int, out_dir: str, round_frac: float, coverage: int, variants: tuple[str, ...]):
    """Generate pfp candidates. VARIANTS defaults to all of: eye-star, telescope, star-arcs, octomosaic."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name in variants or VARIANTS:
        fn = VARIANTS.get(name)
        if fn is None:
            raise SystemExit(f"unknown variant {name!r}; choose from {', '.join(VARIANTS)}")
        kw = dict(cols=cols, mega_every=mega_every, coverage=coverage, glyph_scale=glyph_scale) if name in ("octomosaic", "avatars") else {}
        if name == "octomosaic":
            kw["round_frac"] = round_frac
        print(fn(out, **kw))


if __name__ == "__main__":
    main()
