#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
label_sweep.py -- systematic sweep for printed white symbol labels in video frames
of the TU Dresden model-railway SPS practicum plant.

Every switch drive (Weichenantrieb) and reed contact on the plant carries a small
printed white label with its PLC symbol (e.g. "xW02BH1G4", "xW02D", "xR01A").
Two walk-along videos were frame-extracted into
    docs/research/frames/labels_e/   (Einfachweiche.avi, 100 frames)
    docs/research/frames/labels_d/   (Doppelweiche.avi, 193 frames)

This tool:
  detect  -- find candidate label regions in every frame, crop + upscale them,
             deduplicate near-identical crops across consecutive frames,
             and emit a manifest (JSON) with frame + position metadata.
  negctl  -- cut negative-control tiles (plain grass / ballast / motor housing,
             no label present) to prove the OCR model does not invent symbols.
  aggregate -- parse the OCR replies written by see_image.py --each, normalise
             them, match against the authoritative symbol list in
             src/data/variables.json, and print/emit a report.

Detection principle
-------------------
Measured on docs/research/frames/labels_e/f001.jpg (label xW02BH1G4 in frame):

    region            V mean   V p10   sat mean
    label             225.0    137.0   0.015     <- bright AND near-zero saturation
    hand (skin)       216.4    193.0   0.257     <- bright but strongly saturated
    bright ballast    165.2    140.0   0.037     <- unsaturated but much darker
    grass             151.7    138.0   0.529
    rails / motor      57-80            0.14-0.19

So a label = (V >= v_min) AND (saturation <= sat_max).  That single pair of
thresholds separates paper labels from skin, grass, ballast and plastic. The dark
printed glyphs punch holes in the mask, so the mask is morphologically closed
before connected-component labelling, and components are then filtered on size,
aspect and bbox fill ratio.

Python: needs numpy, pillow and scipy. The project's own .venv carries only pip,
so run this with a separate interpreter that has the three packages installed.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from collections import defaultdict

import numpy as np
from PIL import Image
from scipy import ndimage

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# --------------------------------------------------------------------------- #
# detection
# --------------------------------------------------------------------------- #

def label_mask(rgb: np.ndarray, v_min: float, sat_max: float,
               local_delta: float = 0.0, local_size: int = 121) -> np.ndarray:
    """Boolean mask of near-white, low-saturation pixels.

    With local_delta > 0 the absolute brightness test is combined with a
    local-contrast test (pixel brighter than its neighbourhood mean by
    local_delta). That is what finds labels lying in shadow, whose absolute
    V never reaches the value a sunlit label has -- e.g. the partially
    visible label at the bottom edge of labels_d/f_100.png, whose V p90 is
    only 180 while a lit label sits at 250.
    """
    a = rgb.astype(np.float32)
    mx = a.max(2)
    mn = a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)
    m = (mx >= v_min) & (sat <= sat_max)
    if local_delta > 0:
        loc = ndimage.uniform_filter(mx, size=local_size, mode="nearest")
        m &= (mx - loc) >= local_delta
    return m


def sharpness(gray: np.ndarray) -> float:
    """Variance-of-Laplacian focus measure (higher = crisper)."""
    if gray.size == 0:
        return 0.0
    lap = ndimage.laplace(gray.astype(np.float32))
    return float(lap.var())


def detect_frame(path: str, args) -> list[dict]:
    """Return candidate label regions for one frame."""
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    H, W = rgb.shape[:2]
    gray = rgb.astype(np.float32).mean(2)

    m = label_mask(rgb, args.v_min, args.sat_max,
                   args.local_delta, args.local_size)
    # close over the dark printed glyphs so a label becomes one blob
    m = ndimage.binary_closing(m, structure=np.ones((args.close, args.close)))
    # drop 1-px noise
    m = ndimage.binary_opening(m, structure=np.ones((3, 3)))

    lab, n = ndimage.label(m)
    if n == 0:
        return []
    objs = ndimage.find_objects(lab)
    areas = ndimage.sum(m, lab, index=np.arange(1, n + 1))

    out = []
    for i, sl in enumerate(objs):
        if sl is None:
            continue
        ys, xs = sl
        y0, y1 = ys.start, ys.stop
        x0, x1 = xs.start, xs.stop
        w, h = x1 - x0, y1 - y0
        area = float(areas[i])
        if w < args.min_w or h < args.min_h:
            continue
        if w > args.max_w or h > args.max_h:
            continue
        if area < args.min_area:
            continue
        aspect = w / max(h, 1)
        if not (args.min_aspect <= aspect <= args.max_aspect):
            continue
        fill = area / float(w * h)
        if fill < args.min_fill:
            continue

        # a real label is a bright uniform field; require the *inside* of the
        # bbox to be bright on average (rejects thin bright rail-head chains
        # whose bbox is mostly dark)
        patch = gray[y0:y1, x0:x1]
        if patch.mean() < args.min_box_mean:
            continue
        # and require dark pixels inside (the printed glyphs) -- a blank white
        # blob with no dark content carries no symbol
        dark_frac = float((patch < args.dark_level).mean())
        if not (args.min_dark <= dark_frac <= args.max_dark):
            continue

        out.append(
            dict(
                src=os.path.basename(path),
                x0=int(x0), y0=int(y0), x1=int(x1), y1=int(y1),
                w=int(w), h=int(h),
                cx=int((x0 + x1) // 2), cy=int((y0 + y1) // 2),
                area=int(area), fill=round(fill, 3),
                aspect=round(aspect, 2),
                dark_frac=round(dark_frac, 3),
                box_mean=round(float(patch.mean()), 1),
                sharp=round(sharpness(patch), 1),
                frame_w=W, frame_h=H,
            )
        )
    return out


def crop_and_save(cand: dict, src_path: str, outdir: str, name: str,
                  margin_frac: float, upscale_target: int) -> str:
    im = Image.open(src_path).convert("RGB")
    W, H = im.size
    mx = int(round((cand["x1"] - cand["x0"]) * margin_frac))
    my = int(round((cand["y1"] - cand["y0"]) * margin_frac))
    my = max(my, 6)
    mx = max(mx, 6)
    box = (max(0, cand["x0"] - mx), max(0, cand["y0"] - my),
           min(W, cand["x1"] + mx), min(H, cand["y1"] + my))
    crop = im.crop(box)
    # upscale so the label is comfortably readable; cap the factor at 8x
    f = max(2, min(8, int(round(upscale_target / max(crop.width, 1)))))
    crop = crop.resize((crop.width * f, crop.height * f), Image.LANCZOS)
    path = os.path.join(outdir, name)
    crop.save(path)
    cand["crop"] = name
    cand["crop_box"] = list(box)
    cand["upscale"] = f
    return path


def cmd_detect(args) -> None:
    files = []
    for pat in args.inputs:
        files.extend(sorted(glob.glob(pat)))
    files = [f for f in files if os.path.isfile(f)]
    if not files:
        sys.exit(f"no input frames matched {args.inputs}")

    os.makedirs(args.outdir, exist_ok=True)
    all_cands = []
    for k, f in enumerate(files, 1):
        cands = detect_frame(f, args)
        for c in cands:
            c["src_path"] = f
        all_cands.extend(cands)
        if args.verbose:
            print(f"[{k:>4}/{len(files)}] {os.path.basename(f):<12} "
                  f"{len(cands)} candidate(s)")
    print(f"detect: {len(files)} frames -> {len(all_cands)} raw candidates")

    # -- deduplicate: the camera pans slowly, so the same physical label recurs
    # in many consecutive frames at a similar position and size. Bucket by
    # source group + coarse position + coarse size, keep the sharpest few.
    buckets: dict[tuple, list[dict]] = defaultdict(list)
    for c in all_cands:
        grp = os.path.basename(os.path.dirname(c["src_path"]))
        key = (grp,
               c["cx"] // args.bucket_px,
               c["cy"] // args.bucket_px,
               int(round(np.log2(max(c["w"], 1)) * 2)))
        buckets[key].append(c)

    kept = []
    for key, group in sorted(buckets.items()):
        group.sort(key=lambda c: -c["sharp"])
        for c in group[: args.per_bucket]:
            c["bucket"] = "%s_%d_%d_%d" % key
            c["bucket_size"] = len(group)
            kept.append(c)
    print(f"dedupe: {len(buckets)} buckets -> {len(kept)} tiles kept "
          f"(<= {args.per_bucket} per bucket)")

    manifest = []
    for c in sorted(kept, key=lambda c: (c["src"], c["cx"])):
        stem = os.path.splitext(c["src"])[0]
        grp = os.path.basename(os.path.dirname(c["src_path"]))[-1]
        name = f"{grp}_{stem}_x{c['cx']}y{c['cy']}.png"
        crop_and_save(c, c["src_path"], args.outdir, name,
                      args.margin, args.upscale_target)
        manifest.append(c)

    with open(args.manifest, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    print(f"wrote {len(manifest)} tiles to {args.outdir}")
    print(f"manifest: {args.manifest}")


# --------------------------------------------------------------------------- #
# negative controls
# --------------------------------------------------------------------------- #

NEG_REGIONS = [
    # (frame, x0, y0, x1, y1, tag)  -- hand-verified to contain NO label
    ("labels_e/f001.jpg", 1250,  60, 1700, 250, "grass"),
    ("labels_e/f001.jpg", 1450, 790, 1880, 990, "ballast"),
    ("labels_e/f050.jpg",  650, 380, 1120, 520, "motor_housing"),
    ("labels_d/f_100.png", 1400, 380, 1850, 560, "sleepers"),
    ("labels_d/f_020.png",  100, 700,  520, 900, "hand_skin"),
]


def cmd_negctl(args) -> None:
    os.makedirs(args.outdir, exist_ok=True)
    base = os.path.join(REPO, "docs", "research", "frames")
    for frame, x0, y0, x1, y1, tag in NEG_REGIONS:
        p = os.path.join(base, frame)
        if not os.path.isfile(p):
            print(f"  skip (missing) {frame}")
            continue
        im = Image.open(p).convert("RGB").crop((x0, y0, x1, y1))
        f = max(2, min(8, int(round(args.upscale_target / max(im.width, 1)))))
        im = im.resize((im.width * f, im.height * f), Image.LANCZOS)
        name = f"NEGCTL_{tag}_{os.path.basename(frame).split('.')[0]}.png"
        im.save(os.path.join(args.outdir, name))
        print(f"  {name}  ({im.width}x{im.height})")


# --------------------------------------------------------------------------- #
# temporal stacking (for a label too small / too noisy in any single frame)
# --------------------------------------------------------------------------- #

def cmd_stack(args) -> None:
    """Align and average a fixed region across many frames, then upscale.

    Averaging N aligned frames cuts sensor and compression noise by ~sqrt(N),
    which is the only lever left when a label is at the resolution limit.
    Alignment is a brute-force integer shift search maximising normalised
    cross-correlation against the reference frame.
    """
    files = []
    for pat in args.inputs:
        files.extend(sorted(glob.glob(pat)))
    if not files:
        sys.exit("no frames matched")
    x0, y0, x1, y1 = args.box
    pad = args.search

    ref = None
    acc = None
    used = []
    for f in files:
        a = np.asarray(Image.open(f).convert("RGB")).astype(np.float32)
        H, W = a.shape[:2]
        if ref is None:
            ref = a[y0:y1, x0:x1].mean(2)
            acc = a[y0:y1, x0:x1].copy()
            used.append((os.path.basename(f), 0, 0))
            continue
        best, bs = None, -2.0
        rz = ref - ref.mean()
        rn = np.sqrt((rz ** 2).sum()) or 1.0
        for dy in range(-pad, pad + 1):
            for dx in range(-pad, pad + 1):
                yy0, yy1 = y0 + dy, y1 + dy
                xx0, xx1 = x0 + dx, x1 + dx
                if yy0 < 0 or xx0 < 0 or yy1 > H or xx1 > W:
                    continue
                p = a[yy0:yy1, xx0:xx1].mean(2)
                pz = p - p.mean()
                s = float((rz * pz).sum() / ((np.sqrt((pz ** 2).sum()) or 1.0) * rn))
                if s > bs:
                    bs, best = s, (dy, dx)
        if best is None or bs < args.min_ncc:
            continue
        dy, dx = best
        acc += a[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
        used.append((os.path.basename(f), dy, dx))

    out = acc / len(used)
    if args.stretch:
        lo, hi = np.percentile(out, 2), np.percentile(out, 98)
        out = np.clip((out - lo) * 255.0 / max(hi - lo, 1e-6), 0, 255)
    im = Image.fromarray(out.astype(np.uint8))
    im = im.resize((im.width * args.upscale, im.height * args.upscale),
                   Image.LANCZOS)
    im.save(args.out)
    print(f"stacked {len(used)} frames -> {args.out} ({im.width}x{im.height})")
    print("frames used (name, dy, dx):")
    for u in used:
        print("  ", u)


# --------------------------------------------------------------------------- #
# aggregation
# --------------------------------------------------------------------------- #

# the seven drives that appear in the Variablenliste but have no position on
# the Gleisplan -- the whole point of the sweep
TARGETS = ["xW01BH1G3", "xW04BH1G3", "xW01BH1G4", "xW04BH1G4",
           "xW01BH3G2", "xW04BH3G2", "xW01C"]


def known_symbols() -> tuple[set[str], set[str]]:
    """(switch base names, reed base names) from src/data/variables.json."""
    p = os.path.join(REPO, "src", "data", "variables.json")
    data = json.load(open(p, encoding="utf-8"))
    switches, reeds = set(), set()
    for e in data["entries"]:
        s = e["symbol"]
        # the list has a couple of uppercase-X typos (XW03CR, XW05BH1G3R)
        if s.startswith("XW"):
            s = "x" + s[1:]
        m = re.match(r"^x(W\d{2}[A-Z0-9]*?)(G|R)$", s)
        if m:
            switches.add("x" + m.group(1))
            continue
        # reeds: xR01A ... xR03E and xR01BH1G1 ... xR03BH1G4 (no G/R suffix)
        if re.match(r"^xR\d{2}([A-Z]|BH\dG\d)$", s):
            reeds.add(s)
    return switches, reeds


def normalise(text: str) -> str:
    """Fold OCR text to the label alphabet used on the plant."""
    t = text.strip().upper()
    t = re.sub(r"[^A-Z0-9?]", "", t)
    # common confusions on this print: O<->0, I/L<->1, S<->5
    t = t.replace("O", "0").replace("I", "1").replace("L", "1")
    return t


def canon(sym: str) -> str:
    return normalise(sym)


def match_forms(n: str):
    """Variants of an OCR string to test against the canonical symbol set.

    The leading lower-case "x" of the plant symbols is the character most often
    lost -- it is small, and on several labels it sits under a finger or at the
    crop edge. The positive control came back as "*W02D" for a label that
    really reads "xW02D", so accept a missing / mangled leading x.
    """
    yield n
    if not n.startswith("X"):
        yield "X" + n
    else:
        yield n[1:]
    if n.startswith("?"):
        yield "X" + n[1:]


def parse_reply(path: str) -> str | None:
    txt = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r"TEXT\s*:\s*(.+)", txt)
    if m:
        return m.group(1).strip()
    # fall back: last non-empty line
    lines = [l.strip() for l in txt.splitlines() if l.strip()]
    return lines[-1] if lines else None


def cmd_aggregate(args) -> None:
    switches, reeds = known_symbols()
    known = switches | reeds
    canon_known = {canon(s): s for s in known}

    manifest = {}
    if os.path.isfile(args.manifest):
        for c in json.load(open(args.manifest, encoding="utf-8")):
            manifest[os.path.splitext(c["crop"])[0]] = c

    replies = sorted(glob.glob(os.path.join(args.ocrdir, "*.md")))
    if not replies:
        sys.exit(f"no OCR replies in {args.ocrdir}")

    rows = []
    for r in replies:
        stem = os.path.splitext(os.path.basename(r))[0]
        raw = parse_reply(r)
        if raw is None:
            continue
        rows.append(dict(tile=stem, raw=raw, norm=normalise(raw),
                         meta=manifest.get(stem)))

    unreadable = [r for r in rows if "UNREADABLE" in r["raw"].upper()
                  or len(r["norm"].replace("?", "")) < 3]
    readable = [r for r in rows if r not in unreadable]

    hits = defaultdict(list)
    near = defaultdict(list)
    for r in readable:
        n = r["norm"]
        matched = None
        for form in match_forms(n):
            if form in canon_known:
                matched = canon_known[form]
                break
        if matched:
            r["match"] = matched
            hits[matched].append(r)
        else:
            # nearest known symbol by edit distance
            best, bd = None, 99
            for ck, orig in canon_known.items():
                for form in match_forms(n):
                    d = levenshtein(form, ck)
                    if d < bd:
                        best, bd = orig, d
            r["nearest"] = best
            r["dist"] = bd
            near[(r["raw"], best, bd)].append(r)

    print(f"replies parsed      : {len(rows)}")
    print(f"UNREADABLE / too short: {len(unreadable)}")
    print(f"exact known symbols : {sum(len(v) for v in hits.values())} tiles, "
          f"{len(hits)} distinct")
    print()
    print("=== EXACT MATCHES (against the 42 switch + 23 reed symbols) ===")
    for sym in sorted(hits):
        rs = hits[sym]
        frames = sorted({(r["meta"] or {}).get("src", "?") for r in rs})
        pos = sorted({f"({(r['meta'] or {}).get('cx','?')},"
                      f"{(r['meta'] or {}).get('cy','?')})" for r in rs})
        print(f"{sym:<14} {len(rs):>3} tiles  frames: {', '.join(frames[:8])}"
              + (" ..." if len(frames) > 8 else ""))
        print(f"{'':<14}     pos: {', '.join(pos[:8])}"
              + (" ..." if len(pos) > 8 else ""))
    print()
    print("=== TARGET SYMBOLS (in Variablenliste, absent from Gleisplan) ===")
    for t in TARGETS:
        rs = hits.get(t, [])
        nrs = [r for r in readable if r.get("nearest") == t and r.get("dist", 9) <= 2]
        verdict = "FOUND" if rs else ("NEAR-MISS ONLY" if nrs else "not found")
        print(f"{t:<12} {verdict:<15} exact tiles={len(rs)}  "
              f"near(dist<=2)={len(nrs)}"
              + (f"  [{', '.join(sorted({r['raw'] for r in nrs})[:4])}]" if nrs else ""))
    print()
    print("=== NEAR MISSES (not an exact known symbol) ===")
    for (raw, best, d), rs in sorted(near.items(), key=lambda kv: -len(kv[1])):
        frames = sorted({(r["meta"] or {}).get("src", "?") for r in rs})
        print(f"{raw!r:<26} n={len(rs):<3} nearest={best} (dist {d})  "
              f"frames: {', '.join(frames[:5])}")

    if args.out:
        json.dump(
            dict(rows=rows,
                 hits={k: [r["tile"] for r in v] for k, v in hits.items()},
                 unreadable=[r["tile"] for r in unreadable]),
            open(args.out, "w", encoding="utf-8"), indent=1)
        print(f"\nwrote {args.out}")


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1,
                           prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("detect", help="find + crop candidate label regions")
    d.add_argument("inputs", nargs="+", help="frame globs")
    d.add_argument("-o", "--outdir", required=True)
    d.add_argument("--manifest", default=None)
    d.add_argument("--v-min", type=float, default=192.0)
    d.add_argument("--sat-max", type=float, default=0.12)
    d.add_argument("--local-delta", type=float, default=0.0,
                   help="also require V - localmean(V) >= this; >0 enables the "
                        "shadow pass that finds labels the absolute threshold "
                        "misses")
    d.add_argument("--local-size", type=int, default=121)
    d.add_argument("--close", type=int, default=7)
    d.add_argument("--min-w", type=int, default=26)
    d.add_argument("--min-h", type=int, default=9)
    d.add_argument("--max-w", type=int, default=900)
    d.add_argument("--max-h", type=int, default=400)
    d.add_argument("--min-area", type=int, default=260)
    d.add_argument("--min-aspect", type=float, default=0.7)
    d.add_argument("--max-aspect", type=float, default=14.0)
    d.add_argument("--min-fill", type=float, default=0.45)
    d.add_argument("--min-box-mean", type=float, default=140.0)
    d.add_argument("--dark-level", type=float, default=120.0)
    d.add_argument("--min-dark", type=float, default=0.02,
                   help="min fraction of dark px in bbox (the printed glyphs)")
    d.add_argument("--max-dark", type=float, default=0.55)
    d.add_argument("--margin", type=float, default=0.18)
    d.add_argument("--upscale-target", type=int, default=1100)
    d.add_argument("--bucket-px", type=int, default=90)
    d.add_argument("--per-bucket", type=int, default=2)
    d.add_argument("-v", "--verbose", action="store_true")
    d.set_defaults(func=cmd_detect)

    n = sub.add_parser("negctl", help="cut negative-control tiles (no label)")
    n.add_argument("-o", "--outdir", required=True)
    n.add_argument("--upscale-target", type=int, default=1100)
    n.set_defaults(func=cmd_negctl)

    s = sub.add_parser("stack", help="align+average a region over many frames")
    s.add_argument("inputs", nargs="+")
    s.add_argument("--box", nargs=4, type=int, required=True,
                   metavar=("X0", "Y0", "X1", "Y1"))
    s.add_argument("-o", "--out", required=True)
    s.add_argument("--search", type=int, default=12)
    s.add_argument("--min-ncc", type=float, default=0.75)
    s.add_argument("--upscale", type=int, default=8)
    s.add_argument("--stretch", action="store_true")
    s.set_defaults(func=cmd_stack)

    a = sub.add_parser("aggregate", help="parse OCR replies + match symbols")
    a.add_argument("--ocrdir", required=True)
    a.add_argument("--manifest", required=True)
    a.add_argument("--out", default=None)
    a.set_defaults(func=cmd_aggregate)

    args = ap.parse_args()
    if getattr(args, "manifest", None) is None and args.cmd == "detect":
        args.manifest = os.path.join(args.outdir, "manifest.json")
    args.func(args)


if __name__ == "__main__":
    main()
