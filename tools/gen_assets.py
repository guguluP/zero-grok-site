#!/usr/bin/env python3
"""Regenerate Zero Grok's binary assets from code (deterministic, no binaries in review).

Outputs:
  extension/assets/icons/icon16.png, icon32.png, icon48.png, icon128.png
  extension/assets/sounds/can-pop.wav

Usage:  pip install pillow && python3 tools/gen_assets.py
The icon design mirrors the floating can (silver can, red band, "0" mark) drawn in
can-ui.js. The 16px icon uses a simplified shape so it stays legible.
"""
import math
import os
import random
import struct
import wave

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "extension", "assets", "icons")
SOUND_DIR = os.path.join(ROOT, "extension", "assets", "sounds")

METAL = [(0.0, (58, 58, 58)), (0.18, (154, 154, 154)), (0.42, (244, 244, 244)),
         (0.62, (207, 207, 207)), (0.85, (110, 110, 110)), (1.0, (42, 42, 42))]
BAND = [(0.0, (239, 42, 69)), (0.5, (196, 30, 58)), (1.0, (143, 14, 29))]


def lerp_stops(stops, t):
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            k = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            return tuple(int(round(a + (b - a) * k)) for a, b in zip(c0, c1))
    return stops[-1][1]


def draw_can(size):
    """Detailed can for 32px and up, drawn at 4x then downsampled."""
    ss = 4
    S = size * ss
    u = S / 128.0  # design units are a 128x128 grid
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    x0, x1, y0, y1 = 30 * u, 98 * u, 14 * u, 118 * u
    # soft shadow
    d.ellipse([30 * u, 112 * u, 98 * u, 124 * u], fill=(0, 0, 0, 46))
    # body with horizontal metal gradient (column by column), clipped to rounded rect
    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for x in range(int(x0), int(x1) + 1):
        c = lerp_stops(METAL, (x - x0) / (x1 - x0))
        bd.line([(x, y0), (x, y1)], fill=c + (255,))
    # red band with vertical gradient
    b0, b1 = 44 * u, 86 * u
    for y in range(int(b0), int(b1) + 1):
        c = lerp_stops(BAND, (y - b0) / (b1 - b0))
        bd.line([(x0, y), (x1, y)], fill=c + (255,))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([x0, y0, x1, y1], radius=12 * u, fill=255)
    img.paste(body, (0, 0), mask)
    d.rounded_rectangle([x0, y0, x1, y1], radius=12 * u, outline=(29, 29, 29, 255), width=max(1, int(2.5 * u)))
    # lid
    d.ellipse([33 * u, 8 * u, 95 * u, 22 * u], fill=(217, 217, 217, 255), outline=(29, 29, 29, 255), width=max(1, int(2 * u)))
    d.ellipse([45 * u, 10.5 * u, 83 * u, 17.5 * u], fill=(242, 242, 242, 255), outline=(138, 138, 138, 255), width=max(1, int(1.2 * u)))
    # "0" mark as a ring (no font dependency)
    cx, cy = 64 * u, 65 * u
    rx, ry, w = 11 * u, 14.5 * u, 6 * u
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(255, 255, 255, 255))
    d.ellipse([cx - rx + w, cy - ry + w, cx + rx - w, cy + ry - w], fill=lerp_stops(BAND, 0.5) + (255,))
    # highlight streak
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).rounded_rectangle([38 * u, 22 * u, 45 * u, 110 * u], radius=3.5 * u, fill=(255, 255, 255, 90))
    img = Image.alpha_composite(img, hl)
    return img.resize((size, size), Image.LANCZOS)


def draw_small(size=16):
    ss = 8
    S = size * ss
    u = S / 16.0
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([3.5 * u, 1 * u, 12.5 * u, 15 * u], radius=2 * u, fill=(214, 214, 214, 255), outline=(34, 34, 34, 255), width=int(1 * u))
    d.rectangle([4.2 * u, 5 * u, 11.8 * u, 11 * u], fill=(196, 30, 58, 255))
    d.rectangle([5 * u, 2 * u, 6.2 * u, 14 * u], fill=(255, 255, 255, 128))
    return img.resize((size, size), Image.LANCZOS)


def write_icons():
    os.makedirs(ICON_DIR, exist_ok=True)
    draw_small(16).save(os.path.join(ICON_DIR, "icon16.png"), optimize=True)
    for s in (32, 48, 128):
        draw_can(s).save(os.path.join(ICON_DIR, "icon%d.png" % s), optimize=True)


def write_pop():
    """~0.25 s can-pop: low sine thump with a pitch drop plus a short noise burst."""
    os.makedirs(SOUND_DIR, exist_ok=True)
    rate = 22050
    n = int(rate * 0.25)
    rnd = random.Random(42)  # deterministic
    frames = bytearray()
    phase = 0.0
    for i in range(n):
        t = i / rate
        freq = 45 + (110 - 45) * math.exp(-t / 0.06)
        phase += 2 * math.pi * freq / rate
        thump = math.sin(phase) * 0.55 * math.exp(-t / 0.05)
        hiss = (rnd.random() * 2 - 1) * 0.35 * math.exp(-t / 0.02)
        s = max(-1.0, min(1.0, thump + hiss))
        frames += struct.pack("<h", int(s * 32000))
    with wave.open(os.path.join(SOUND_DIR, "can-pop.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))


if __name__ == "__main__":
    write_icons()
    write_pop()
    print("Wrote icons to", ICON_DIR, "and can-pop.wav to", SOUND_DIR)
