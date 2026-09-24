#!/usr/bin/env python3
"""Generate sprites.js: the runner and guard, as 14x11 pixel frames.

Two sources, same output format:

  --source apple2   (default) The actual 1983 Apple II sprites, decoded from
                    sprite_tables.tex in XekriRedmane/lode_runner_reveng (a
                    public reverse-engineering of the disk image). Which sprite
                    is which comes from that project's disassembly:
                    SPRITE_ANIM_SEQS (player) and GUARD_ANIM_SPRITES (guard).
                    The art is Brøderbund's; that repo carries no licence and
                    neither do we have one — see README before redistributing.

  --source own      Original drawings in the same style, built from pose data.
                    A drop-in replacement if the original art is ever a problem.

Frames are 11 rows of 14 chars: w white, o orange, b blue, . empty. Left- and
right-facing frames are separate lists (the originals are not mirrors).

    python3 scripts/build_sprites.py                 # download + decode
    python3 scripts/build_sprites.py --tex FILE      # use a local copy
    python3 scripts/build_sprites.py --source own
"""
import argparse
import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_URL = "https://raw.githubusercontent.com/XekriRedmane/lode_runner_reveng/HEAD/sprite_tables.tex"
W, H = 14, 11

# ---------------------------------------------------------------- apple2 ----
# Sprite numbers, from the disassembly's animation tables.
APPLE2_FRAMES = {
    "player": {
        "run":    {"right": [9, 16, 17],  "left": [11, 12, 13]},
        "monkey": {"right": [21, 22, 23], "left": [24, 25, 26]},
        "climb":  {"right": [14, 18],     "left": [14, 18]},
        "dig":    {"right": [37],         "left": [15]},
        "fall":   {"right": [20],         "left": [19]},
    },
    "guard": {
        "run":    {"right": [40, 41, 42], "left": [8, 43, 44]},
        "monkey": {"right": [45, 46, 47], "left": [48, 49, 50]},
        "climb":  {"right": [51, 52],     "left": [51, 52]},
        "fall":   {"right": [53],         "left": [54]},
    },
}
CODES = {"k": ".", "l": "b", "o": "o", "w": "w"}


def parse_tex(text):
    sprites = {}
    for block in text.split("\\begin{tabular}")[1:]:
        heads = [int(h) for h in re.findall(r"Sprite (\d+)", block)]
        grids = {h: [] for h in heads}
        for line in block.split("\n"):
            if not re.match(r"^\d+ &", line):
                continue
            toks = re.findall(r"\\b([a-z]+)\d", line)
            for k, h in enumerate(heads):
                grids[h].append("".join(CODES[t] for t in toks[k * W:(k + 1) * W]))
        sprites.update(grids)
    return sprites


def from_apple2(tex_text):
    sp = parse_tex(tex_text)
    return {
        who: {anim: {side: [sp[i] for i in ids] for side, ids in sides.items()}
              for anim, sides in anims.items()}
        for who, anims in APPLE2_FRAMES.items()
    }


# ------------------------------------------------------------------- own ----
POSES = {
    "run0": dict(lean=1, arms=[[(7, 4), (5, 5), (4, 6)], [(8, 4), (10, 5), (11, 4)]],
                 legs=[[(7, 7), (9, 8), (10, 10)], [(6, 7), (5, 9), (3, 10)]]),
    "run1": dict(lean=0, arms=[[(6, 4), (5, 5), (6, 6)], [(7, 4), (9, 5), (9, 6)]],
                 legs=[[(6, 7), (6, 9), (6, 10)], [(7, 7), (8, 8), (9, 9)]]),
    "run2": dict(lean=1, arms=[[(7, 4), (9, 5), (10, 6)], [(8, 4), (6, 5), (5, 4)]],
                 legs=[[(7, 7), (8, 9), (8, 10)], [(6, 7), (4, 8), (3, 10)]]),
    "monkey0": dict(dy=1, arms=[[(6, 3), (5, 1), (5, 0)], [(8, 3), (9, 2), (9, 0)]],
                    legs=[[(6, 8), (6, 10)], [(7, 8), (8, 9), (8, 10)]]),
    "monkey1": dict(dy=1, arms=[[(6, 3), (6, 1), (6, 0)], [(8, 3), (9, 1), (9, 0)]],
                    legs=[[(6, 8), (6, 10)], [(7, 8), (7, 10)]]),
    "monkey2": dict(dy=1, arms=[[(6, 3), (5, 2), (5, 0)], [(8, 3), (9, 1), (9, 0)]],
                    legs=[[(6, 8), (5, 9), (5, 10)], [(7, 8), (7, 10)]]),
    "climb0": dict(arms=[[(6, 3), (5, 1), (5, 0)], [(8, 4), (9, 5), (9, 6)]],
                   legs=[[(6, 7), (5, 8), (6, 9)], [(7, 7), (8, 9), (8, 10)]]),
    "climb1": dict(arms=[[(8, 3), (9, 1), (9, 0)], [(6, 4), (5, 5), (5, 6)]],
                   legs=[[(7, 7), (8, 8), (7, 9)], [(6, 7), (5, 9), (5, 10)]]),
    "dig": dict(arms=[[(6, 4), (5, 5), (5, 6)], [(8, 4), (10, 5), (12, 6)]],
                legs=[[(6, 7), (5, 9), (5, 10)], [(7, 7), (8, 9), (8, 10)]], gun=True),
    "fall": dict(arms=[[(6, 3), (4, 2), (3, 0)], [(8, 3), (10, 2), (11, 0)]],
                 legs=[[(6, 7), (5, 9), (5, 10)], [(7, 7), (8, 9), (8, 10)]]),
}


def _put(g, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c


def _line(g, a, b, c):
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        _put(g, x0, y0, c)
        if (x0, y0) == (x1, y1):
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def _figure(pose, kind):
    body = "w" if kind == "runner" else "o"
    g = [["."] * W for _ in range(H)]
    lean, dy = pose.get("lean", 0), pose.get("dy", 0)
    for a in pose["legs"]:
        for i in range(len(a) - 1):
            _line(g, a[i], a[i + 1], "w")
    for row in range(3, 7):
        x = 6 + (lean if row <= 4 else 0)
        for cx in ([x, x + 1] if kind == "runner" else [x - (1 if row <= 5 else 0), x, x + 1]):
            _put(g, cx, row + dy, body)
    if kind == "runner":
        _put(g, 6, 6 + dy, "o")
    for a in pose["arms"]:
        for i in range(len(a) - 1):
            _line(g, a[i], a[i + 1], body)
    hx = 6 + lean
    for cx, cy in [(hx, 1), (hx + 1, 1), (hx, 2), (hx + 1, 2)]:
        _put(g, cx, cy + dy, body)
    _put(g, hx + 1, dy, "b")
    if kind == "guard":
        _put(g, hx + 1, 2 + dy, "w")
    if pose.get("gun"):
        _put(g, 12, 6, "o"); _put(g, 11, 6, "o"); _put(g, 12, 7, "o")
    return ["".join(r) for r in g]


def from_own():
    mirror = lambda fr: [row[::-1] for row in fr]
    groups = {"run": ["run0", "run1", "run2"], "monkey": ["monkey0", "monkey1", "monkey2"],
              "climb": ["climb0", "climb1"], "fall": ["fall"]}
    out = {"player": {}, "guard": {}}
    for who, kind in (("player", "runner"), ("guard", "guard")):
        for name, poses in groups.items():
            right = [_figure(POSES[p], kind) for p in poses]
            out[who][name] = {"right": right, "left": [mirror(f) for f in right]}
    d = [_figure(POSES["dig"], "runner")]
    out["player"]["dig"] = {"right": d, "left": [mirror(f) for f in d]}
    return out


# ----------------------------------------------------------------- main -----
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["apple2", "own"], default="apple2")
    ap.add_argument("--tex", help="local sprite_tables.tex (default: download)")
    args = ap.parse_args()

    if args.source == "own":
        data, note = from_own(), "original drawings in the style of the 1983 art"
    else:
        text = open(args.tex).read() if args.tex else urllib.request.urlopen(TEX_URL).read().decode()
        data = from_apple2(text)
        note = "the 1983 Apple II sprites (Brøderbund), decoded from XekriRedmane/lode_runner_reveng"

    js = (
        "/* Auto-generated by scripts/build_sprites.py — do not hand-edit.\n"
        f" * Runner and guard animation frames: {note}.\n"
        " * 14x11 pixels; w white, o orange, b blue, . empty. Separate left and\n"
        " * right frames. Regenerate with --source own for our own drawings. */\n"
        "window.SPRITES = " + json.dumps(data, indent=1) + ";\n"
    )
    with open(os.path.join(ROOT, "sprites.js"), "w") as f:
        f.write(js)
    n = sum(len(fr) for d in data.values() for a in d.values() for fr in a.values())
    print(f"Wrote sprites.js ({n} frames, source={args.source})")
