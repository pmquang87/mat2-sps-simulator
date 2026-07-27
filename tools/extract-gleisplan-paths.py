"""tools/extract-gleisplan-paths.py — pull the track network's path primitives out of
`Gleisplan SPS.pdf` and write them to `tools/gleisplan-paths.json`.

Why the JSON artefact exists: the PDF is course material and is gitignored (`*.pdf`), so
the extracted geometry has to be committed for `tools/smooth-trackplan.ts` and the data
tests to be reproducible without it. Re-run this script only when the PDF changes.

What is extracted: every stroked path on **page 3** whose width is 4.56 pt. That width is
the grey track network (see docs/research/gleisplan.md); page 3 is used because pages 1/2
overpaint part of the network with the red Aufgabe route, while pages 3 and 4 carry the
complete grey network — and their path lists are byte-identical, which this script asserts.

Output: 74 paths, each either
    {"kind": "line",  "pts": [[x, y], [x, y]]}                       — one straight
    {"kind": "curve", "beziers": [[[x, y] x 4], ...]}                 — chained cubics
in Gleisplan points (origin top left, y downward), rounded to 3 decimals.

Run (repo root), with a Python that has PyMuPDF installed:

    python tools/extract-gleisplan-paths.py
"""
import json
import math
import sys
from pathlib import Path

import fitz  # PyMuPDF

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "Gleisplan SPS.pdf"
OUT = ROOT / "tools" / "gleisplan-paths.json"
TRACK_WIDTH_PT = 4.56


def path_items(page):
    """[(width, [item...])] for every drawing on the page, items as plain tuples."""
    out = []
    for p in page.get_drawings():
        items = []
        for it in p["items"]:
            pts = [(round(q.x, 3), round(q.y, 3)) for q in it[1:] if hasattr(q, "x")]
            items.append((it[0], pts))
        out.append((round(p.get("width") or 0.0, 2), items))
    return out


def track_paths(page):
    return [items for width, items in path_items(page) if width == TRACK_WIDTH_PT]


def main() -> int:
    if not PDF.exists():
        print(f"extract-gleisplan-paths: {PDF} not found (the PDF is gitignored course material)")
        return 1
    doc = fitz.open(PDF)
    p3 = track_paths(doc[2])
    p4 = track_paths(doc[3])
    if p3 != p4:
        print("extract-gleisplan-paths: pages 3 and 4 disagree — inspect before trusting either")
        return 1

    paths = []
    for items in p3:
        kinds = {k for k, _ in items}
        if kinds == {"l"}:
            pts = [items[0][1][0]]
            for _k, seg in items:
                pts.append(seg[1])
            paths.append({"kind": "line", "pts": [list(p) for p in pts]})
        elif kinds == {"c"}:
            paths.append({"kind": "curve",
                          "beziers": [[list(p) for p in seg] for _k, seg in items]})
        else:
            print(f"extract-gleisplan-paths: unexpected mixed path {sorted(kinds)}")
            return 1

    head = {
        "source": "Gleisplan SPS.pdf page 3, stroke width 4.56 pt = the grey track network",
        "note": ("Pages 3 and 4 carry the complete network; pages 1/2 overpaint part of it "
                 "with the red Aufgabe route. Verified identical between pages 3 and 4."),
        "generator": "tools/extract-gleisplan-paths.py (PyMuPDF get_drawings())",
        "unit": "gleisplanPt (origin top left, y downward)",
    }
    # hand-formatted so one point sits on one line: 74 paths stay reviewable in a diff
    lines_out = ["{"]
    for k, v in head.items():
        lines_out.append(f"  {json.dumps(k)}: {json.dumps(v)},")
    lines_out.append('  "paths": [')
    for n, p in enumerate(paths):
        tail = "" if n == len(paths) - 1 else ","
        lines_out.append("    {")
        lines_out.append(f'      "kind": {json.dumps(p["kind"])},')
        key = "pts" if p["kind"] == "line" else "beziers"
        lines_out.append(f'      "{key}": [')
        rows = [p["pts"]] if p["kind"] == "line" else p["beziers"]
        for m, row in enumerate(rows):
            sep = "" if m == len(rows) - 1 else ","
            body = ", ".join(f"[{q[0]}, {q[1]}]" for q in row)
            lines_out.append(f"        [{body}]{sep}" if p["kind"] != "line" else f"        {body}{sep}")
        lines_out.append("      ]")
        lines_out.append("    }" + tail)
    lines_out.append("  ]")
    lines_out.append("}")
    text = "\n".join(lines_out) + "\n"
    # self-check: the hand-formatted text must parse back to exactly the same structure
    assert json.loads(text)["paths"] == paths, "hand-formatted JSON does not round-trip"
    OUT.write_text(text, encoding="utf-8")
    lines = sum(1 for p in paths if p["kind"] == "line")
    curves = len(paths) - lines
    total = 0.0
    for p in paths:
        if p["kind"] == "line":
            total += sum(math.dist(p["pts"][i], p["pts"][i + 1]) for i in range(len(p["pts"]) - 1))
    print(f"extract-gleisplan-paths: {len(paths)} paths ({lines} lines, {curves} curve chains), "
          f"{total:.1f} pt of straight track -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
