#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
video_label_sweep.py -- sweep the TU Dresden "Praktikum SPS" instruction video
(YouTube jOShbi0qjX4) for the small printed white symbol labels that sit next to
every switch drive and every reed contact of the model railway plant.

Goal: find a printed label for any of the seven switch drives that appear in the
Variablenliste but have no position on the Gleisplan
(xW01BH1G3, xW04BH1G3, xW01BH1G4, xW04BH1G4, xW01BH3G2, xW04BH3G2, xW01C).

Relationship to tools/label_sweep.py
------------------------------------
label_sweep.py (owned by another stream) does the same job for the two
walk-along clips Einfachweiche.avi / Doppelweiche.avi, whose frames are
close-ups. The detection principle (near-white AND low-saturation, morphological
closing over the printed glyphs, connected components, size/aspect/fill filters,
variance-of-Laplacian sharpness ranking, positional dedupe buckets) is taken
from there unchanged -- it is the right principle and it was measured on this
same plant. This file is a separate tool because the video differs in three ways
that all matter:

  1. It is 1280x720 (the *native* resolution -- see NOTE below), not a close-up
     clip, and most of the label-bearing footage is an aerial fly-over. A label
     is 60-130 px wide in the best frames and 20-35 px wide in the aerial ones,
     against 200-400 px in the .avi close-ups. All size thresholds must drop.
  2. Frames come from three ffmpeg passes with different -ss/-fps, so a frame
     name must be resolvable back to a video timestamp. That mapping lives here
     (PASSES) and is carried into the manifest, so every OCR hit can be reported
     with the mm:ss at which it was filmed.
  3. Label yield per frame is much higher (a switch cluster shows six at once),
     so the dedupe has to work per-frame-region rather than per-clip.

NOTE on resolution: docs/research/video_design.md calls this video 1080p. That is
wrong. yt-dlp reports the source as 1280x720 (max format 136, 841k); there is no
1080p rendition to fetch. This is the hard ceiling on everything below.

Frame extraction that this tool expects (run once, frames are gitignored):

    ffmpeg -ss 120 -t 195 -i praktikum_sps.mp4 -vf fps=2 a_%04d.png   # 02:00-05:15 plate views
    ffmpeg -ss 764 -t 315 -i praktikum_sps.mp4 -vf fps=1 b_%04d.png   # 12:44-17:59 driving demo
    ffmpeg -ss 160 -t  70 -i praktikum_sps.mp4 -vf fps=5 c_%04d.png   # 02:40-03:50 close-ups, dense

Subcommands
-----------
  detect     find + crop + upscale label candidates over a frame glob
  rank       report the largest / sharpest candidates, so OCR effort goes to the
             frames where a label is physically big enough to carry glyphs
  negctl     cut negative-control tiles from label-free grass/ballast/roof
  stack      align+average one region over many frames (noise, not blur, is what
             this removes -- see the limits section of the report)
  aggregate  parse see_image.py --each replies, normalise, match against the
             authoritative symbol list in src/data/variables.json, verdict per
             target switch

Python: needs numpy, pillow and scipy. cv2 is not available and not needed.
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
# frame name -> video timestamp
# --------------------------------------------------------------------------- #
# (prefix, -ss start seconds, fps used by ffmpeg, human label)
PASSES = {
    "a": (120.0, 2.0, "02:00-05:15 plate views @2fps"),
    "b": (764.0, 1.0, "12:44-17:59 driving demo @1fps"),
    "c": (160.0, 5.0, "02:40-03:50 close-ups @5fps"),
    # every source frame of the longest static camera run (found by measuring
    # frame-to-frame difference over pass c: 3:04.6-3:13.8, meandiff 0.40).
    # 230 frames of the same six-switch throat -> the deepest stack available,
    # which is the only lever left once the camera is on a tripod.
    "d": (184.6, 25.0, "03:04.6-03:13.8 static throat @25fps (all source frames)"),
}


def frame_time(name: str) -> float | None:
    """a_0101.png -> seconds into the video. None if the name is not a pass frame."""
    m = re.match(r"^([abc])_(\d+)\.(?:png|jpg)$", os.path.basename(name))
    if not m:
        return None
    start, fps, _ = PASSES[m.group(1)]
    return start + (int(m.group(2)) - 1) / fps


def tstr(sec: float | None) -> str:
    if sec is None:
        return "?"
    return "%d:%05.2f" % (int(sec // 60), sec % 60)


# --------------------------------------------------------------------------- #
# detection  (principle and thresholds inherited from tools/label_sweep.py)
# --------------------------------------------------------------------------- #

def label_mask(rgb: np.ndarray, v_min: float, sat_max: float,
               local_delta: float = 0.0, local_size: int = 121) -> np.ndarray:
    """Near-white, low-saturation pixels.

    A paper label is bright AND unsaturated. That pair separates it from skin
    (bright but saturated), grass (saturated), ballast (unsaturated but darker)
    and rails/motor housings (dark). With local_delta > 0 an additional
    local-contrast test finds labels lying in shadow, whose absolute brightness
    never reaches that of a lit label.
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
    return float(ndimage.laplace(gray.astype(np.float32)).var())


def detect_frame(path: str, args) -> list[dict]:
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    H, W = rgb.shape[:2]
    gray = rgb.astype(np.float32).mean(2)

    m = label_mask(rgb, args.v_min, args.sat_max, args.local_delta, args.local_size)
    m = ndimage.binary_closing(m, structure=np.ones((args.close, args.close)))
    m = ndimage.binary_opening(m, structure=np.ones((2, 2)))

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
        y0, y1, x0, x1 = ys.start, ys.stop, xs.start, xs.stop
        w, h = x1 - x0, y1 - y0
        area = float(areas[i])
        if w < args.min_w or h < args.min_h or w > args.max_w or h > args.max_h:
            continue
        if area < args.min_area:
            continue
        aspect = w / max(h, 1)
        if not (args.min_aspect <= aspect <= args.max_aspect):
            continue
        fill = area / float(w * h)
        if fill < args.min_fill:
            continue
        patch = gray[y0:y1, x0:x1]
        if patch.mean() < args.min_box_mean:
            continue
        dark_frac = float((patch < args.dark_level).mean())
        if not (args.min_dark <= dark_frac <= args.max_dark):
            continue

        out.append(dict(
            src=os.path.basename(path), t=round(frame_time(path) or -1, 2),
            x0=int(x0), y0=int(y0), x1=int(x1), y1=int(y1), w=int(w), h=int(h),
            cx=int((x0 + x1) // 2), cy=int((y0 + y1) // 2),
            area=int(area), fill=round(fill, 3), aspect=round(aspect, 2),
            dark_frac=round(dark_frac, 3), box_mean=round(float(patch.mean()), 1),
            sharp=round(sharpness(patch), 1), frame_w=W, frame_h=H,
        ))
    return out


def crop_and_save(cand: dict, src_path: str, outdir: str, name: str,
                  margin_frac: float, upscale_target: int) -> None:
    im = Image.open(src_path).convert("RGB")
    W, H = im.size
    mx = max(int(round((cand["x1"] - cand["x0"]) * margin_frac)), 5)
    my = max(int(round((cand["y1"] - cand["y0"]) * margin_frac)), 5)
    box = (max(0, cand["x0"] - mx), max(0, cand["y0"] - my),
           min(W, cand["x1"] + mx), min(H, cand["y1"] + my))
    crop = im.crop(box)
    f = max(4, min(8, int(round(upscale_target / max(crop.width, 1)))))
    crop = crop.resize((crop.width * f, crop.height * f), Image.LANCZOS)
    crop.save(os.path.join(outdir, name))
    cand["crop"] = name
    cand["crop_box"] = list(box)
    cand["upscale"] = f


def gather(inputs) -> list[str]:
    files = []
    for pat in inputs:
        files.extend(sorted(glob.glob(pat)))
    files = [f for f in files if os.path.isfile(f)]
    if not files:
        sys.exit(f"no input frames matched {inputs}")
    return files


def scan(files: list[str], args) -> list[dict]:
    all_cands = []
    for k, f in enumerate(files, 1):
        cands = detect_frame(f, args)
        for c in cands:
            c["src_path"] = f
        all_cands.extend(cands)
        if args.verbose and (k % 50 == 0 or k == len(files)):
            print(f"  [{k:>4}/{len(files)}] {len(all_cands)} candidates so far")
    return all_cands


def cmd_detect(args) -> None:
    files = gather(args.inputs)
    os.makedirs(args.outdir, exist_ok=True)
    all_cands = scan(files, args)
    print(f"detect: {len(files)} frames -> {len(all_cands)} raw candidates")

    # Dedupe. The camera pans slowly, so one physical label recurs in many
    # consecutive frames at a similar place and size. Bucket by pass + coarse
    # position + coarse size and keep the sharpest few per bucket, so we do not
    # OCR hundreds of copies of the same label.
    buckets: dict[tuple, list[dict]] = defaultdict(list)
    for c in all_cands:
        buckets[(c["src"][0],
                 c["cx"] // args.bucket_px,
                 c["cy"] // args.bucket_px,
                 int(round(np.log2(max(c["w"], 1)) * 2)))].append(c)

    kept = []
    for key, group in sorted(buckets.items()):
        # prefer big first, then sharp -- size is what decides legibility here
        group.sort(key=lambda c: (-c["w"], -c["sharp"]))
        for c in group[: args.per_bucket]:
            c["bucket"] = "%s_%d_%d_%d" % key
            c["bucket_size"] = len(group)
            kept.append(c)
    print(f"dedupe: {len(buckets)} buckets -> {len(kept)} tiles kept "
          f"(<= {args.per_bucket} per bucket)")

    if args.min_keep_w:
        before = len(kept)
        kept = [c for c in kept if c["w"] >= args.min_keep_w]
        print(f"width gate >= {args.min_keep_w}px: {before} -> {len(kept)} tiles")
    if args.top:
        kept.sort(key=lambda c: (-c["w"], -c["sharp"]))
        kept = kept[: args.top]
        print(f"top gate: kept {len(kept)} widest tiles")

    manifest = []
    for c in sorted(kept, key=lambda c: (c["src"], c["cx"])):
        stem = os.path.splitext(c["src"])[0]
        crop_and_save(c, c["src_path"], args.outdir,
                      f"{stem}_x{c['cx']}y{c['cy']}_w{c['w']}.png",
                      args.margin, args.upscale_target)
        manifest.append(c)

    with open(args.manifest, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=1)
    print(f"wrote {len(manifest)} tiles to {args.outdir}\nmanifest: {args.manifest}")


def cmd_rank(args) -> None:
    """How big do labels actually get, and where? Decides where OCR is worth it."""
    files = gather(args.inputs)
    cands = scan(files, args)
    cands.sort(key=lambda c: -c["w"])
    print(f"\n{len(cands)} candidates; widest {args.top}:")
    print(f"{'frame':<12} {'t':>9} {'w':>4} {'h':>4} {'pos':>12} {'sharp':>8}")
    for c in cands[: args.top]:
        print(f"{c['src']:<12} {tstr(c['t']):>9} {c['w']:>4} {c['h']:>4} "
              f"{'(%d,%d)' % (c['cx'], c['cy']):>12} {c['sharp']:>8.1f}")
    ws = np.array([c["w"] for c in cands]) if cands else np.array([0])
    print(f"\nwidth percentiles: p50={np.percentile(ws,50):.0f} "
          f"p90={np.percentile(ws,90):.0f} p99={np.percentile(ws,99):.0f} "
          f"max={ws.max():.0f}")
    per = defaultdict(int)
    for c in cands:
        per[c["src"][0]] += 1
    for k in sorted(per):
        print(f"pass {k} ({PASSES[k][2]}): {per[k]} candidates")


# --------------------------------------------------------------------------- #
# negative controls -- mandatory. If these come back with invented symbols the
# whole sweep is worthless.
# --------------------------------------------------------------------------- #

NEG_REGIONS = [
    # (frame, x0, y0, x1, y1, tag) -- hand-verified to contain NO printed label
    ("c_0101.png",  60,  30, 300, 190, "grass_scenery"),
    ("c_0101.png", 760, 560, 1010, 700, "ballast_track"),
    ("c_0271.png", 800,  30, 1060, 190, "grass_trees"),
    ("c_0271.png", 560, 230,  760, 340, "station_roof"),
    ("a_0100.png", 100, 480,  340, 620, "plain_board"),
]


def cmd_negctl(args) -> None:
    os.makedirs(args.outdir, exist_ok=True)
    base = os.path.join(REPO, "docs", "research", "frames", "labels_yt")
    for frame, x0, y0, x1, y1, tag in NEG_REGIONS:
        p = os.path.join(base, frame)
        if not os.path.isfile(p):
            print(f"  skip (missing) {frame}")
            continue
        im = Image.open(p).convert("RGB").crop((x0, y0, x1, y1))
        f = max(4, min(8, int(round(args.upscale_target / max(im.width, 1)))))
        im = im.resize((im.width * f, im.height * f), Image.LANCZOS)
        name = f"NEGCTL_{tag}_{os.path.splitext(frame)[0]}.png"
        im.save(os.path.join(args.outdir, name))
        print(f"  {name}  ({im.width}x{im.height})  from {frame} t={tstr(frame_time(frame))}")


# --------------------------------------------------------------------------- #
# temporal stacking
# --------------------------------------------------------------------------- #

def cmd_stack(args) -> None:
    """Align and average a fixed region across frames, then upscale.

    Averaging N aligned frames cuts sensor and H.264 quantisation noise by
    ~sqrt(N). It does NOT undo optical blur or the encoder's loss of high
    spatial frequency -- if a glyph stroke is below one pixel it stays gone.
    Alignment is a brute-force integer shift search maximising normalised
    cross-correlation against the reference frame.
    """
    files = gather(args.inputs)
    x0, y0, x1, y1 = args.box
    pad = args.search
    ref = acc = None
    used = []
    for f in files:
        a = np.asarray(Image.open(f).convert("RGB")).astype(np.float32)
        H, W = a.shape[:2]
        if ref is None:
            ref = a[y0:y1, x0:x1].mean(2)
            acc = a[y0:y1, x0:x1].copy()
            used.append((os.path.basename(f), 0, 0, 1.0))
            continue
        rz = ref - ref.mean()
        rn = np.sqrt((rz ** 2).sum()) or 1.0
        best, bs = None, -2.0
        for dy in range(-pad, pad + 1):
            for dx in range(-pad, pad + 1):
                yy0, yy1, xx0, xx1 = y0 + dy, y1 + dy, x0 + dx, x1 + dx
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
        used.append((os.path.basename(f), dy, dx, round(bs, 4)))

    out = acc / len(used)
    if args.stretch:
        lo, hi = np.percentile(out, 2), np.percentile(out, 98)
        out = np.clip((out - lo) * 255.0 / max(hi - lo, 1e-6), 0, 255)
    im = Image.fromarray(out.astype(np.uint8))
    im = im.resize((im.width * args.upscale, im.height * args.upscale), Image.LANCZOS)
    im.save(args.out)
    print(f"stacked {len(used)}/{len(files)} frames -> {args.out} ({im.width}x{im.height})")
    for u in used:
        print("  ", u)


# --------------------------------------------------------------------------- #
# enhance: deskew + local contrast + unsharp on a stacked tile
# --------------------------------------------------------------------------- #

def cmd_enhance(args) -> None:
    """Rectify and sharpen a (usually stacked) label tile.

    The labels lie flat on the baseboard and are filmed from above at an angle,
    so the text runs at 10-25 deg to the image rows and the glyphs are only 3-6
    px tall. Three things help, in this order:

      1. deskew -- rotate by the principal axis of the near-white label blob so
         the text runs horizontally. Bicubic rotation of an already-averaged
         tile costs nothing and makes the glyph rows separable.
      2. local contrast -- percentile stretch computed on the label blob only,
         not the whole tile (the dark ballast around it otherwise eats the range).
      3. unsharp mask -- amplifies what stacking recovered. Radius must be about
         one glyph stroke; larger radii just ring.

    This adds no information. It makes the information that survived the H.264
    encoder visible to a reader. Everything it outputs must still be treated as
    a *reading*, never as proof.
    """
    im = Image.open(args.image).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    mx = a.max(2)
    mn = a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)
    blob = (mx >= np.percentile(mx, args.blob_pct)) & (sat <= 0.30)
    blob = ndimage.binary_closing(blob, np.ones((5, 5)))
    lab, n = ndimage.label(blob)
    if n == 0:
        sys.exit("no bright label blob found in tile")
    sizes = ndimage.sum(blob, lab, index=np.arange(1, n + 1))
    big = (lab == (int(np.argmax(sizes)) + 1))

    ys, xs = np.nonzero(big)
    yc, xc = ys.mean(), xs.mean()
    cov = np.cov(np.vstack([xs - xc, ys - yc]))
    evals, evecs = np.linalg.eigh(cov)
    vx, vy = evecs[:, int(np.argmax(evals))]
    ang = float(np.degrees(np.arctan2(vy, vx)))
    if ang > 90:
        ang -= 180
    if ang < -90:
        ang += 180
    if args.angle is not None:
        ang = args.angle
    print(f"label blob: {int(big.sum())} px, principal axis {ang:+.2f} deg")

    gray = a.mean(2)
    rot = ndimage.rotate(gray, ang, reshape=True, order=3, mode="nearest")
    rmask = ndimage.rotate(big.astype(np.float32), ang, reshape=True,
                           order=1, mode="constant", cval=0.0) > 0.5
    if rmask.sum() < 20:
        rmask = np.ones_like(rot, bool)

    # crop to the rotated label, with a little air
    ry, rx = np.nonzero(rmask)
    p = args.pad
    y0, y1 = max(0, ry.min() - p), min(rot.shape[0], ry.max() + p + 1)
    x0, x1 = max(0, rx.min() - p), min(rot.shape[1], rx.max() + p + 1)
    tile = rot[y0:y1, x0:x1]
    inner = rmask[y0:y1, x0:x1]

    lo = np.percentile(tile[inner], args.lo_pct)
    hi = np.percentile(tile[inner], args.hi_pct)
    tile = np.clip((tile - lo) * 255.0 / max(hi - lo, 1e-6), 0, 255)

    if args.upscale > 1:
        im2 = Image.fromarray(tile.astype(np.uint8)).resize(
            (tile.shape[1] * args.upscale, tile.shape[0] * args.upscale),
            Image.LANCZOS)
        tile = np.asarray(im2).astype(np.float32)

    if args.unsharp > 0:
        blur = ndimage.gaussian_filter(tile, args.radius)
        tile = np.clip(tile + args.unsharp * (tile - blur), 0, 255)

    Image.fromarray(tile.astype(np.uint8)).save(args.out)
    print(f"wrote {args.out}  ({tile.shape[1]}x{tile.shape[0]})")


# --------------------------------------------------------------------------- #
# template matching against the closed candidate set
# --------------------------------------------------------------------------- #
# Free-form OCR fails on these tiles because the glyph strokes are ~1 px in the
# source. But the answer set is CLOSED: the plant can only carry one of the 42
# switch names or the reed names. So instead of asking "what does this say",
# render every candidate, degrade it to the observed label's actual pixel scale,
# and score the correlation. That converts an unreadable tile into a *ranked*
# hypothesis with an explicit margin -- and a small margin is an honest
# "inconclusive" rather than a guess.
#
# The font is not guessed either: it is chosen by whichever candidate font best
# reconstructs a label from this same video whose text is certain (the reed
# xR02BH1G4 filmed close-up at 3:37). Calibrating on a known sample from the
# same camera, print and encoder is the only defensible way to pick it.
#
# *** THIS METHOD FAILED ITS OWN VALIDATION -- DO NOT TRUST ITS OUTPUT. ***
# Run against the calibration tile itself (a label whose text is certain), the
# true string xR02BH1G4 did not reach the top 8 of 68 candidates, all NCC values
# sat in a narrow band 0.17-0.24, and the #1-over-#2 margin was +0.003. Cause:
# resizing a rendered string to the observed ink bbox destroys per-character
# registration, and at ~4 px glyph height the ink map is dominated by paper
# texture and H.264 blocking rather than by stroke shape. The subcommand is kept
# only so this negative result stays reproducible -- a future run should not
# spend time rediscovering it, and must never quote a ranking from it as a
# reading. Reproduce with:
#   video_label_sweep.py match enh/CAL_DESKEW_xR02BH1G4.png --pool all \
#     --extra xR02BH1G4 --calibrate xR02BH1G4 \
#     --calibrate-image enh/CAL_DESKEW_xR02BH1G4.png

FONT_DIR = r"C:\Windows\Fonts"
FONT_CANDIDATES = ["arialbd.ttf", "arial.ttf", "arialn.ttf", "arialnb.ttf",
                   "tahomabd.ttf", "tahoma.ttf", "verdanab.ttf", "verdana.ttf",
                   "calibrib.ttf", "seguisb.ttf", "ariblk.ttf"]


def _ink(gray: np.ndarray) -> np.ndarray:
    """Normalised ink map (1 = printed stroke, 0 = paper) from a label tile."""
    g = gray.astype(np.float32)
    lo, hi = np.percentile(g, 3), np.percentile(g, 97)
    g = np.clip((g - lo) / max(hi - lo, 1e-6), 0, 1)
    return 1.0 - g


def _ink_bbox(ink: np.ndarray, thr: float = 0.55):
    m = ink > thr
    m = ndimage.binary_opening(m, np.ones((2, 2)))
    if m.sum() < 5:
        m = ink > (ink.max() * 0.6)
    ys, xs = np.nonzero(m)
    if len(ys) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def render_text(text: str, font_file: str, px: int = 160) -> np.ndarray | None:
    """Ink map of `text` rendered large, cropped to its bounding box."""
    from PIL import ImageFont, ImageDraw as ID
    path = os.path.join(FONT_DIR, font_file)
    if not os.path.isfile(path):
        return None
    try:
        f = ImageFont.truetype(path, px)
    except Exception:
        return None
    img = Image.new("L", (px * len(text) + 4 * px, 3 * px), 255)
    ID.Draw(img).text((px, px // 2), text, font=f, fill=0)
    a = 1.0 - np.asarray(img).astype(np.float32) / 255.0
    ys, xs = np.nonzero(a > 0.5)
    if len(ys) == 0:
        return None
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def score_candidate(obs: np.ndarray, tmpl: np.ndarray, shifts: int = 4) -> float:
    """Best NCC between an observed ink patch and a template resized to it."""
    H, W = obs.shape
    t = Image.fromarray((np.clip(tmpl, 0, 1) * 255).astype(np.uint8)).resize(
        (max(W, 2), max(H, 2)), Image.LANCZOS)
    t = np.asarray(t).astype(np.float32) / 255.0
    # blur the template to the observed stroke width -- the encoder blurred the
    # real one, so comparing a crisp render to a blurred sample is unfair
    t = ndimage.gaussian_filter(t, max(H / 14.0, 0.8))
    oz = obs - obs.mean()
    on = np.sqrt((oz ** 2).sum()) or 1.0
    best = -1.0
    for dx in range(-shifts, shifts + 1):
        for dy in range(-2, 3):
            tt = np.roll(np.roll(t, dx, axis=1), dy, axis=0)
            tz = tt - tt.mean()
            s = float((oz * tz).sum() / ((np.sqrt((tz ** 2).sum()) or 1.0) * on))
            best = max(best, s)
    return best


def cmd_match(args) -> None:
    switches, reeds = known_symbols()
    cands = sorted(switches | reeds) if args.pool == "all" else sorted(switches)
    if args.extra:
        cands = sorted(set(cands) | set(args.extra.split(",")))

    obs_full = _ink(np.asarray(Image.open(args.image).convert("L")).astype(np.float32))
    bb = _ink_bbox(obs_full)
    if bb is None:
        sys.exit("no ink found in tile")
    x0, y0, x1, y1 = bb
    p = args.inkpad
    obs = obs_full[max(0, y0 - p):y1 + p, max(0, x0 - p):x1 + p]
    print(f"ink box {x1-x0} x {y1-y0} px in tile {obs_full.shape[1]}x{obs_full.shape[0]}")

    fonts = [args.font] if args.font else FONT_CANDIDATES
    if args.calibrate:
        truth = args.calibrate
        cal = _ink(np.asarray(Image.open(args.calibrate_image).convert("L")))
        cb = _ink_bbox(cal)
        cal = cal[cb[1]:cb[3], cb[0]:cb[2]]
        best_font, best_s = None, -9
        print(f"\ncalibrating font on known label {truth!r}:")
        for ff in FONT_CANDIDATES:
            t = render_text(truth, ff)
            if t is None:
                continue
            s = score_candidate(cal, t)
            print(f"  {ff:<14} NCC={s:+.4f}")
            if s > best_s:
                best_font, best_s = ff, s
        print(f"  -> font {best_font} (NCC {best_s:+.4f})")
        fonts = [best_font]

    rows = []
    for ff in fonts:
        for c in cands:
            t = render_text(c, ff)
            if t is None:
                continue
            rows.append((score_candidate(obs, t), c, ff))
    rows.sort(reverse=True)
    print(f"\ntop {args.top} of {len(rows)} candidate/font pairs:")
    for s, c, ff in rows[: args.top]:
        star = "  <-- TARGET" if c in TARGETS else ""
        print(f"  NCC={s:+.4f}  {c:<12} [{ff}]{star}")
    if len(rows) > 1:
        margin = rows[0][0] - rows[1][0]
        print(f"\nmargin #1 over #2: {margin:+.4f}"
              f"   ({'DECISIVE' if margin > 0.05 else 'NOT decisive -- inconclusive'})")


# --------------------------------------------------------------------------- #
# aggregation
# --------------------------------------------------------------------------- #

TARGETS = ["xW01BH1G3", "xW04BH1G3", "xW01BH1G4", "xW04BH1G4",
           "xW01BH3G2", "xW04BH3G2", "xW01C"]


def known_symbols() -> tuple[set[str], set[str]]:
    """(switch base names, reed names) from src/data/variables.json."""
    data = json.load(open(os.path.join(REPO, "src", "data", "variables.json"),
                          encoding="utf-8"))
    switches, reeds = set(), set()
    for e in data["entries"]:
        s = e["symbol"]
        if s.startswith("XW"):           # a few uppercase-X typos in the source
            s = "x" + s[1:]
        m = re.match(r"^x(W\d{2}[A-Z0-9]*?)(G|R)$", s)
        if m:
            switches.add("x" + m.group(1))
            continue
        if re.match(r"^xR\d{2}([A-Z]|BH\dG\d)$", s):
            reeds.add(s)
    return switches, reeds


def normalise(text: str) -> str:
    t = re.sub(r"[^A-Z0-9?]", "", text.strip().upper())
    return t.replace("O", "0").replace("I", "1").replace("L", "1")


def match_forms(n: str):
    """The leading lower-case x is the character most often lost (small, often
    at the crop edge or under a finger); accept a missing / mangled one."""
    yield n
    if not n.startswith("X"):
        yield "X" + n
    else:
        yield n[1:]
    if n.startswith("?"):
        yield "X" + n[1:]


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def parse_reply(path: str) -> str | None:
    txt = open(path, encoding="utf-8", errors="replace").read()
    m = re.search(r"TEXT\s*:\s*(.+)", txt)
    if m:
        return m.group(1).strip()
    lines = [l.strip() for l in txt.splitlines() if l.strip()]
    return lines[-1] if lines else None


def cmd_aggregate(args) -> None:
    switches, reeds = known_symbols()
    canon_known = {normalise(s): s for s in (switches | reeds)}

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

    ctl_pos = [r for r in rows if r["tile"].startswith(("L1_", "L2_", "REF_"))]
    ctl_neg = [r for r in rows if r["tile"].startswith("NEGCTL_")]
    body = [r for r in rows if r not in ctl_pos and r not in ctl_neg]

    print("=== CONTROLS ===")
    for r in ctl_pos:
        print(f"  POS  {r['tile']:<44} -> {r['raw']!r}")
    invented = []
    for r in ctl_neg:
        ok = "UNREADABLE" in r["raw"].upper() or len(r["norm"].replace("?", "")) < 3
        if not ok:
            invented.append(r)
        print(f"  NEG  {r['tile']:<44} -> {r['raw']!r}   {'ok' if ok else '*** INVENTED ***'}")
    if invented:
        print(f"\n*** {len(invented)} negative control(s) returned text -> SWEEP UNTRUSTWORTHY ***")

    def is_unread(r):
        return "UNREADABLE" in r["raw"].upper() or len(r["norm"].replace("?", "")) < 3

    unreadable = [r for r in body if is_unread(r)]
    readable = [r for r in body if not is_unread(r)]

    hits, near = defaultdict(list), defaultdict(list)
    for r in readable:
        matched = next((canon_known[f] for f in match_forms(r["norm"])
                        if f in canon_known), None)
        if matched:
            r["match"] = matched
            hits[matched].append(r)
        else:
            best, bd = None, 99
            for ck, orig in canon_known.items():
                for f in match_forms(r["norm"]):
                    d = levenshtein(f, ck)
                    if d < bd:
                        best, bd = orig, d
            r["nearest"], r["dist"] = best, bd
            near[(r["raw"], best, bd)].append(r)

    print(f"\n=== TALLY ===\ntiles OCR'd (excl. controls): {len(body)}")
    print(f"UNREADABLE / too short      : {len(unreadable)}")
    print(f"exact known symbols         : {sum(len(v) for v in hits.values())} tiles, "
          f"{len(hits)} distinct")

    print("\n=== EXACT MATCHES (42 switch + reed symbols of variables.json) ===")
    for sym in sorted(hits):
        rs = hits[sym]
        print(f"{sym:<14} {len(rs):>3} tiles")
        for r in sorted(rs, key=lambda r: (r["meta"] or {}).get("t", 0))[:6]:
            mt = r["meta"] or {}
            print(f"{'':<16}{mt.get('src','?'):<12} t={tstr(mt.get('t')):<9} "
                  f"pos=({mt.get('cx','?')},{mt.get('cy','?')}) w={mt.get('w','?')}")

    print("\n=== TARGET SYMBOLS (in Variablenliste, absent from Gleisplan) ===")
    for t in TARGETS:
        rs = hits.get(t, [])
        nrs = [r for r in readable if r.get("nearest") == t and r.get("dist", 9) <= 2]
        verdict = "FOUND" if rs else ("NEAR-MISS ONLY" if nrs else "not found")
        print(f"{t:<12} {verdict:<15} exact={len(rs)}  near(<=2)={len(nrs)}"
              + (f"  [{', '.join(sorted({r['raw'] for r in nrs})[:4])}]" if nrs else ""))

    print("\n=== NEAR MISSES (not an exact known symbol) ===")
    for (raw, best, d), rs in sorted(near.items(), key=lambda kv: -len(kv[1])):
        srcs = sorted({(r["meta"] or {}).get("src", "?") for r in rs})
        ts = sorted({tstr((r["meta"] or {}).get("t")) for r in rs})
        print(f"{raw!r:<28} n={len(rs):<3} nearest={best} (dist {d})  "
              f"t: {', '.join(ts[:4])}  frames: {', '.join(srcs[:4])}")

    if args.out:
        json.dump(dict(rows=rows,
                       controls=dict(positive=[r["tile"] for r in ctl_pos],
                                     negative=[r["tile"] for r in ctl_neg],
                                     invented=[r["tile"] for r in invented]),
                       hits={k: [r["tile"] for r in v] for k, v in hits.items()},
                       unreadable=[r["tile"] for r in unreadable]),
                  open(args.out, "w", encoding="utf-8"), indent=1)
        print(f"\nwrote {args.out}")


# --------------------------------------------------------------------------- #

def add_detect_args(p) -> None:
    p.add_argument("inputs", nargs="+", help="frame globs")
    p.add_argument("--v-min", type=float, default=188.0)
    p.add_argument("--sat-max", type=float, default=0.14)
    p.add_argument("--local-delta", type=float, default=0.0)
    p.add_argument("--local-size", type=int, default=121)
    p.add_argument("--close", type=int, default=5)
    p.add_argument("--min-w", type=int, default=18)
    p.add_argument("--min-h", type=int, default=6)
    p.add_argument("--max-w", type=int, default=400)
    p.add_argument("--max-h", type=int, default=160)
    p.add_argument("--min-area", type=int, default=110)
    p.add_argument("--min-aspect", type=float, default=0.8)
    p.add_argument("--max-aspect", type=float, default=14.0)
    p.add_argument("--min-fill", type=float, default=0.45)
    p.add_argument("--min-box-mean", type=float, default=140.0)
    p.add_argument("--dark-level", type=float, default=125.0)
    p.add_argument("--min-dark", type=float, default=0.02)
    p.add_argument("--max-dark", type=float, default=0.60)
    p.add_argument("-v", "--verbose", action="store_true")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("detect", help="find + crop candidate label regions")
    add_detect_args(d)
    d.add_argument("-o", "--outdir", required=True)
    d.add_argument("--manifest", default=None)
    d.add_argument("--margin", type=float, default=0.20)
    d.add_argument("--upscale-target", type=int, default=1000)
    d.add_argument("--bucket-px", type=int, default=60)
    d.add_argument("--per-bucket", type=int, default=2)
    d.add_argument("--min-keep-w", type=int, default=0,
                   help="drop tiles narrower than this (glyphs unresolvable)")
    d.add_argument("--top", type=int, default=0, help="keep only the N widest")
    d.set_defaults(func=cmd_detect)

    r = sub.add_parser("rank", help="report largest/sharpest candidates")
    add_detect_args(r)
    r.add_argument("--top", type=int, default=40)
    r.set_defaults(func=cmd_rank)

    n = sub.add_parser("negctl", help="cut negative-control tiles (no label)")
    n.add_argument("-o", "--outdir", required=True)
    n.add_argument("--upscale-target", type=int, default=1000)
    n.set_defaults(func=cmd_negctl)

    s = sub.add_parser("stack", help="align+average a region over many frames")
    s.add_argument("inputs", nargs="+")
    s.add_argument("--box", nargs=4, type=int, required=True,
                   metavar=("X0", "Y0", "X1", "Y1"))
    s.add_argument("-o", "--out", required=True)
    s.add_argument("--search", type=int, default=14)
    s.add_argument("--min-ncc", type=float, default=0.70)
    s.add_argument("--upscale", type=int, default=8)
    s.add_argument("--stretch", action="store_true")
    s.set_defaults(func=cmd_stack)

    e = sub.add_parser("enhance", help="deskew + stretch + unsharp a stacked tile")
    e.add_argument("image")
    e.add_argument("-o", "--out", required=True)
    e.add_argument("--angle", type=float, default=None,
                   help="override the measured principal-axis angle (deg)")
    e.add_argument("--blob-pct", type=float, default=88.0)
    e.add_argument("--lo-pct", type=float, default=2.0)
    e.add_argument("--hi-pct", type=float, default=99.0)
    e.add_argument("--pad", type=int, default=3)
    e.add_argument("--upscale", type=int, default=10)
    e.add_argument("--unsharp", type=float, default=1.1)
    e.add_argument("--radius", type=float, default=3.0)
    e.set_defaults(func=cmd_enhance)

    mt = sub.add_parser("match", help="template-match a tile against the 42 candidates")
    mt.add_argument("image")
    mt.add_argument("--pool", choices=["switches", "all"], default="switches")
    mt.add_argument("--extra", default=None, help="comma-separated extra candidates")
    mt.add_argument("--font", default=None)
    mt.add_argument("--calibrate", default=None,
                    help="known text of --calibrate-image; picks the font")
    mt.add_argument("--calibrate-image", default=None)
    mt.add_argument("--inkpad", type=int, default=2)
    mt.add_argument("--top", type=int, default=10)
    mt.set_defaults(func=cmd_match)

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
