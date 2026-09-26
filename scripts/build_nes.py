#!/usr/bin/env python3
"""Generate sprites_nes.js: an NES-style look for the runner and the guards ("monks").

These are OUR drawings, made to resemble the 1985 NES/Famicom version's look
(blue runner with red shirt, white-hooded green monks), built from pose data
like `build_sprites.py --source own`. Nothing here is taken from that game's
ROM or art. Frames are 12 columns x 16 rows; separate right / left lists.

Letters (colours are set in game.js):
  runner: h helmet, s skin, r shirt, b overalls, k boots, d eye
  monk:   w hood, r eyes/feet, g robe, k dark, d slit

    python3 scripts/build_nes.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 12, 16


def grid():
    return [["."] * W for _ in range(H)]


def put(g, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c


def line(g, pts, c, end=None):
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            put(g, x0, y0, c)
            if (x0, y0) == (x1, y1):
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy; x0 += sx
            if e2 <= dx:
                err += dx; y0 += sy
    if end:
        put(g, pts[-1][0], pts[-1][1], end)


def fill(g, x0, x1, y, c):
    for x in range(x0, x1 + 1):
        put(g, x, y, c)


def runner(p):
    g = grid()
    dy = p.get("dy", 0)
    lean = p.get("lean", 0)
    # legs first (behind the body)
    for leg in p["legs"]:
        line(g, [(x, y + dy) for x, y in leg], "b", end="k")
        put(g, leg[-1][0] + 1, leg[-1][1] + dy, "k")
    # torso
    for y in (6, 7):
        fill(g, 4 + lean, 8 + lean, y + dy, "r")
    for y in (8, 9):
        fill(g, 4 + lean, 8 + lean, y + dy, "b")
    # head
    fill(g, 5 + lean, 8 + lean, 1 + dy, "h")
    fill(g, 4 + lean, 9 + lean, 2 + dy, "h")
    fill(g, 4 + lean, 6 + lean, 3 + dy, "h"); fill(g, 7 + lean, 9 + lean, 3 + dy, "s")
    fill(g, 4 + lean, 5 + lean, 4 + dy, "h"); fill(g, 6 + lean, 9 + lean, 4 + dy, "s")
    fill(g, 7 + lean, 8 + lean, 5 + dy, "s")
    put(g, 8 + lean, 3 + dy, "d")
    # arms (in front of the body)
    for arm in p["arms"]:
        line(g, [(x, y + dy) for x, y in arm], "r", end="s")
    if p.get("gun"):
        put(g, 11, 7 + dy, "k"); put(g, 10, 7 + dy, "k"); put(g, 11, 8 + dy, "k")
    return ["".join(r) for r in g]


def monk(p):
    g = grid()
    dy = p.get("dy", 0)
    lean = p.get("lean", 0)
    for leg in p["legs"]:
        line(g, [(x, y + dy) for x, y in leg], "g", end="r")
        put(g, leg[-1][0] + 1, leg[-1][1] + dy, "r")
    # robe
    for y in range(6, 11):
        fill(g, 3 + lean, 9 + lean, y + dy, "g")
    fill(g, 4 + lean, 8 + lean, 11 + dy, "g")
    # hood
    fill(g, 5 + lean, 8 + lean, 1 + dy, "w")
    fill(g, 4 + lean, 9 + lean, 2 + dy, "w")
    fill(g, 4 + lean, 5 + lean, 3 + dy, "w"); fill(g, 6 + lean, 9 + lean, 3 + dy, "k")
    fill(g, 4 + lean, 9 + lean, 4 + dy, "w")
    put(g, 7 + lean, 3 + dy, "r"); put(g, 9 + lean, 3 + dy, "r")
    fill(g, 4 + lean, 9 + lean, 5 + dy, "w")
    for arm in p["arms"]:
        line(g, [(x, y + dy) for x, y in arm], "g", end="w")
    return ["".join(r) for r in g]


POSES = {
    "run0": dict(lean=1, arms=[[(6, 7), (4, 8), (3, 9)], [(7, 7), (9, 8), (10, 7)]],
                 legs=[[(5, 10), (3, 12), (2, 14)], [(7, 10), (9, 12), (10, 14)]]),
    "run1": dict(lean=0, arms=[[(6, 7), (5, 9), (5, 10)], [(7, 7), (8, 9), (8, 10)]],
                 legs=[[(5, 10), (5, 13), (5, 14)], [(7, 10), (7, 13), (8, 14)]]),
    "run2": dict(lean=1, arms=[[(6, 7), (8, 8), (10, 9)], [(7, 7), (5, 8), (4, 7)]],
                 legs=[[(5, 10), (6, 12), (6, 14)], [(7, 10), (6, 12), (4, 14)]]),
    "monkey0": dict(dy=2, arms=[[(5, 7), (4, 4), (4, 0)], [(8, 7), (9, 3), (9, 0)]],
                    legs=[[(5, 10), (4, 12), (4, 13)], [(7, 10), (8, 12), (8, 13)]]),
    "monkey1": dict(dy=2, arms=[[(5, 7), (5, 4), (5, 0)], [(8, 7), (8, 4), (8, 0)]],
                    legs=[[(5, 10), (5, 12), (5, 13)], [(7, 10), (7, 12), (7, 13)]]),
    "monkey2": dict(dy=2, arms=[[(5, 7), (4, 4), (4, 0)], [(8, 7), (9, 4), (9, 0)]],
                    legs=[[(5, 10), (6, 12), (6, 13)], [(7, 10), (7, 12), (8, 13)]]),
    "climb0": dict(arms=[[(4, 7), (3, 4), (3, 2)], [(8, 7), (9, 9), (9, 10)]],
                   legs=[[(5, 10), (4, 12), (5, 14)], [(7, 10), (8, 13), (8, 15)]]),
    "climb1": dict(arms=[[(4, 7), (3, 9), (3, 10)], [(8, 7), (9, 4), (9, 2)]],
                   legs=[[(5, 10), (5, 13), (4, 15)], [(7, 10), (8, 12), (8, 14)]]),
    "dig": dict(lean=0, arms=[[(6, 7), (8, 8), (10, 8)], [(7, 7), (9, 9), (10, 9)]], gun=True,
                legs=[[(5, 10), (4, 12), (3, 14)], [(7, 10), (7, 13), (7, 14)]]),
    "fall": dict(arms=[[(5, 7), (3, 4), (2, 2)], [(8, 7), (10, 4), (11, 2)]],
                 legs=[[(5, 10), (4, 12), (3, 14)], [(7, 10), (8, 12), (9, 14)]]),
}


def build():
    mirror = lambda fr: [row[::-1] for row in fr]
    groups = {"run": ["run0", "run1", "run2"], "monkey": ["monkey0", "monkey1", "monkey2"],
              "climb": ["climb0", "climb1"], "fall": ["fall"], "dig": ["dig"]}
    out = {"player": {}, "guard": {}}
    for who, fn in (("player", runner), ("guard", monk)):
        for name, poses in groups.items():
            if who == "guard" and name == "dig":
                continue
            right = [fn(POSES[p]) for p in poses]
            out[who][name] = {"right": right, "left": [mirror(f) for f in right]}
    return out


if __name__ == "__main__":
    data = build()
    js = ("/* Auto-generated by scripts/build_nes.py — do not hand-edit.\n"
          " * NES-style runner and monk frames, OUR drawings (nothing from the NES ROM).\n"
          " * 12x16 pixels. */\nwindow.SPRITES_NES = " + json.dumps(data, indent=1) + ";\n")
    with open(os.path.join(ROOT, "sprites_nes.js"), "w") as f:
        f.write(js)
    print("Wrote sprites_nes.js")
