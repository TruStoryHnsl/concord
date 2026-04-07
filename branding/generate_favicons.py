"""
Generate favicon assets from the real concord logo.

Run from the concord project root:
    python3 branding/generate_favicons.py

Outputs to client/public/:
    favicon.png         — 32x32 (browser tab default)
    favicon-16.png      — 16x16
    favicon-32.png      — 32x32
    favicon-48.png      — 48x48
    apple-touch-icon.png — 192x192
    favicon.ico         — multi-size 16/32/48 bundle
    logo.png            — full 540x480 source (for LoginForm <img>)

Why this exists as a script: the source logo is semi-transparent mint
green on a noisy canvas. A raw LANCZOS downscale turns it into a faint
ghost at tab size. This script does alpha-clamp + contrast-boost +
tight-crop BEFORE the downsample so the emerald mesh mark stays visible
at 16x16. Same approach as orrapus/branding/generate_favicons.py but
targeted at concord's G-dominant green palette.
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "branding" / "logo.png"
PUBLIC = ROOT / "client" / "public"
ASSETS = ROOT / "client" / "src" / "assets"

# Brand primary for contrast-boost blend target — #08C838 Mesh Emerald
BRAND_PRIMARY = np.array([8, 200, 56], dtype=np.float32)


def build_clean_glyph(src: Image.Image) -> Image.Image:
    """Alpha-clamp glyph pixels and blend toward brand emerald."""
    arr = np.array(src).astype(np.float32)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    glyphness = g - np.maximum(r, b)
    is_glyph = (glyphness > 15) & (a > 30)

    new_alpha = np.zeros_like(a)
    new_alpha[is_glyph] = 255.0

    out_rgb = arr[..., :3].copy()
    blend = is_glyph[..., None]
    out_rgb = np.where(blend, out_rgb * 0.4 + BRAND_PRIMARY * 0.6, out_rgb)

    stacked = np.dstack([out_rgb, new_alpha]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(stacked, "RGBA")


def tight_crop_square(img: Image.Image) -> Image.Image:
    alpha = np.array(img)[..., 3]
    mask = alpha > 20
    if not mask.any():
        return img
    ys, xs = np.where(mask)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    margin = int(max(x1 - x0, y1 - y0) * 0.05)
    x0 = max(0, x0 - margin)
    y0 = max(0, y0 - margin)
    x1 = min(img.width, x1 + margin)
    y1 = min(img.height, y1 + margin)

    cropped = img.crop((x0, y0, x1, y1))
    cw, ch = cropped.size
    side = max(cw, ch)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cw) // 2, (side - ch) // 2), cropped)
    return square


def scale_to(square: Image.Image, sz: int) -> Image.Image:
    im = square.resize((sz, sz), Image.LANCZOS)
    if sz <= 16:
        im = im.filter(ImageFilter.UnsharpMask(radius=0.5, percent=220, threshold=1))
    elif sz <= 32:
        im = im.filter(ImageFilter.UnsharpMask(radius=0.6, percent=170, threshold=2))
    elif sz <= 48:
        im = im.filter(ImageFilter.UnsharpMask(radius=0.7, percent=150, threshold=2))
    else:
        im = im.filter(ImageFilter.UnsharpMask(radius=0.8, percent=130, threshold=2))
    return im


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)

    src = Image.open(SRC).convert("RGBA")
    print(f"source: {SRC} {src.size}")

    clean = build_clean_glyph(src)
    square = tight_crop_square(clean)
    print(f"squared transparent: {square.size}")

    sizes = {
        16: "favicon-16.png",
        32: "favicon-32.png",
        48: "favicon-48.png",
        192: "apple-touch-icon.png",
    }
    for sz, name in sizes.items():
        scale_to(square, sz).save(PUBLIC / name, "PNG", optimize=True)
        print(f"  public/{name}")

    (PUBLIC / "favicon.png").write_bytes((PUBLIC / "favicon-32.png").read_bytes())
    scale_to(square, 48).save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("  public/favicon.ico (16/32/48)")

    # Full-size logo for the LoginForm welcome overlay <img>
    src.save(PUBLIC / "logo.png", "PNG", optimize=True)
    src.save(ASSETS / "concord-logo.png", "PNG", optimize=True)
    print("  public/logo.png, src/assets/concord-logo.png")


if __name__ == "__main__":
    main()
