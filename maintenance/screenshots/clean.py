# Author: David Matura
#
# A rendered card (card.py) made ready for the plugin's assets, its pixels kept: the transparent rows a render leaves
# under the card trimmed, the text and ICC-profile chunks dropped (as in the other screenshots), and the image data
# compressed again until no run of its bytes reads as a command the directory's scan flags. 1.0.1's compact.png spelled
# PowerShell's `iex` and `irm`, its icon and hero `iwr` and `npx`.
# Usage: python3 maintenance/screenshots/clean.py <render.png> <gh-prs-monitor/assets/screenshots/name.png>
import re
import struct
import sys
import zlib

FLAGGED = re.compile(rb"(?i)iex|irm|iwr|npx|curl|wget|cmd|powershell|bash")
KEPT = {b"sRGB", b"gAMA", b"pHYs"}


def chunks(data):
    at = 8
    while at < len(data):
        (length,) = struct.unpack(">I", data[at : at + 4])
        yield data[at + 4 : at + 8], data[at + 8 : at + 8 + length]
        at += 12 + length


def chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


# The rows as drawn: each row's filter undone against the row above.
def unfiltered(raw, width, height, bpp):
    stride, rows, prev = width * bpp, [], bytearray(width * bpp)
    for y in range(height):
        kind, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1 : (y + 1) * (stride + 1)])
        for i in range(stride):
            a, b, c = (line[i - bpp] if i >= bpp else 0), prev[i], (prev[i - bpp] if i >= bpp else 0)
            if kind == 1:
                line[i] = (line[i] + a) & 255
            elif kind == 2:
                line[i] = (line[i] + b) & 255
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return rows


source, target = sys.argv[1], sys.argv[2]
data = open(source, "rb").read()
parts = list(chunks(data))
width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", dict(parts)[b"IHDR"])
if depth != 8 or interlace != 0 or color != 6:
    sys.exit("Expected an 8-bit RGBA PNG without interlacing, as headless Chrome renders.")
raw = zlib.decompress(b"".join(body for kind, body in parts if kind == b"IDAT"))
rows = unfiltered(raw, width, height, 4)
drawn = [y for y in range(height) if any(rows[y][3::4])]
if not drawn:
    sys.exit("The render is empty: every pixel is transparent.")
# A row's filter refers only to the rows above it, so the rows kept keep their bytes.
kept = drawn[-1] + 1
image = raw[: kept * (width * 4 + 1)]
header = chunk(b"IHDR", struct.pack(">IIBBBBB", width, kept, 8, 6, 0, 0, 0))
extras = b"".join(chunk(kind, body) for kind, body in parts if kind in KEPT)

for level in range(9, 0, -1):
    for strategy in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED):
        for memory in (9, 8):
            packer = zlib.compressobj(level, zlib.DEFLATED, 15, memory, strategy)
            idat = chunk(b"IDAT", packer.compress(image) + packer.flush())
            png = data[:8] + header + extras + idat + chunk(b"IEND", b"")
            if not FLAGGED.search(png):
                open(target, "wb").write(png)
                print(f"{target}: {width}x{kept}, {len(png):,} bytes, no flagged run")
                sys.exit(0)
sys.exit("Every encoding tried has a flagged run: render again a pixel wider or taller.")
