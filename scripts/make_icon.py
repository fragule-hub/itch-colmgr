"""Generate assets/icon.ico — a bookmark glyph, the tool's core metaphor.

Pure stdlib on purpose: the build only needs a Python, not Pillow. Multi-size
(16/32/48) 32bpp icons with an alpha channel and a zeroed AND mask, which is
the form Windows Explorer and the taskbar both read well.

    .venv/Scripts/python scripts/make_icon.py
"""
import os
import struct

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "icon.ico")
SIZES = (16, 32, 48)

BG = (0x1F, 0x1F, 0x28)        # near-black indigo
FG = (0xF5, 0xF0, 0xEA)        # warm white


def _rounded_rect(size: int, x: int, y: int) -> bool:
    r = size * 0.22
    cx = cy = size / 2
    half = size / 2
    dx, dy = abs(x + 0.5 - cx), abs(y + 0.5 - cy)
    if dx <= half - r or dy <= half - r:
        return True
    return (dx - (half - r)) ** 2 + (dy - (half - r)) ** 2 <= r * r


def _bookmark(size: int, x: int, y: int) -> bool:
    """Silhouette: a tall rectangle with a V notch cut into the bottom."""
    w = size * 0.32
    h = size * 0.46
    notch = size * 0.15
    cx = size / 2
    top = (size - h) / 2
    px, py = x + 0.5, y + 0.5
    if abs(px - cx) > w / 2 or py < top or py > top + h:
        return False
    stem_bottom = top + h - notch
    if py <= stem_bottom:
        return True
    t = (py - stem_bottom) / notch
    return abs(px - cx) <= (w / 2) * (1 - t)


def _bitmap(size: int) -> bytes:
    rows = bytearray()
    for y in range(size - 1, -1, -1):        # BMP rows are bottom-up
        for x in range(size):
            if _bookmark(size, x, y):
                b, g, r, a = FG[2], FG[1], FG[0], 0xFF
            elif _rounded_rect(size, x, y):
                b, g, r, a = BG[2], BG[1], BG[0], 0xFF
            else:
                b, g, r, a = 0, 0, 0, 0
            rows += bytes((b, g, r, a))
    xor = bytes(rows)
    and_stride = ((size + 31) // 32) * 4
    and_mask = bytes(and_stride * size)      # all-zero: alpha decides
    header = struct.pack(
        "<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0,
        len(xor) + len(and_mask), 0, 0, 0, 0,
    )
    return header + xor + and_mask


def main() -> None:
    images = [_bitmap(s) for s in SIZES]
    out = bytearray(struct.pack("<HHH", 0, 1, len(images)))
    offset = 6 + 16 * len(images)
    for size, img in zip(SIZES, images):
        out += struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(img), offset)
        offset += len(img)
    for img in images:
        out += img
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(out)
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes, sizes {SIZES})")


if __name__ == "__main__":
    main()
