"""Regenerate the Android app's launcher icons and splash screens from the brand art.

    python apps/web/tools/android-assets.py

Source: public/assets/android-chrome-512x512.png (the hexagon mark, transparent
corners). Writes into android/app/src/main/res, overwriting Capacitor's defaults.
Needs Pillow (pip install pillow). Re-run after changing the logo, then rebuild.
"""
from pathlib import Path
from PIL import Image, ImageDraw

WEB = Path(__file__).resolve().parent.parent
SRC = WEB / "public/assets/android-chrome-512x512.png"
RES = WEB / "android/app/src/main/res"
WHITE = (255, 255, 255, 255)

mark = Image.open(SRC).convert("RGBA")
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def placed(canvas_w: int, canvas_h: int, frac: float, bg) -> Image.Image:
    """The mark centred on a canvas, its width `frac` of the shorter side."""
    im = Image.new("RGBA", (canvas_w, canvas_h), bg)
    size = round(min(canvas_w, canvas_h) * frac)
    m = mark.resize((size, size), Image.LANCZOS)
    im.alpha_composite(m, ((canvas_w - size) // 2, (canvas_h - size) // 2))
    return im


for name, d in DENSITIES.items():
    folder = RES / f"mipmap-{name}"
    # Legacy (pre-Android 8) square and round icons: mark on white.
    px = round(48 * d)
    placed(px, px, 0.78, WHITE).save(folder / "ic_launcher.png")
    round_icon = placed(px, px, 0.70, WHITE)
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, px - 1, px - 1), fill=255)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(round_icon, (0, 0), mask)
    out.save(folder / "ic_launcher_round.png")
    # Adaptive foreground: 108dp canvas, launcher masks to the inner ~66dp, so the
    # mark sits at 58% to stay clear of any mask shape. Background is white (XML).
    fg = round(108 * d)
    placed(fg, fg, 0.58, (0, 0, 0, 0)).save(folder / "ic_launcher_foreground.png")

# Splash screens: white with the mark at a third of the short side.
PORT = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280), "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}
for name, (w, h) in PORT.items():
    placed(w, h, 0.34, WHITE).convert("RGB").save(RES / f"drawable-port-{name}/splash.png")
    placed(h, w, 0.34, WHITE).convert("RGB").save(RES / f"drawable-land-{name}/splash.png")
placed(480, 320, 0.34, WHITE).convert("RGB").save(RES / "drawable/splash.png")

# Play Store listing icon (512x512, uploaded by hand in Play Console).
placed(512, 512, 0.80, WHITE).convert("RGB").save(WEB / "android/play-store-icon-512.png")
print("android icons + splash written")
