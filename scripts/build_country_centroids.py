#!/usr/bin/env python3
"""Build country centroids from world-110m.geojson for the regions atlas.

For each ISO_A3 feature, uses the centroid of the largest polygon (by area)
so multi-part countries (Chile, Indonesia, etc.) land on the main landmass
rather than in the ocean between islands.

Writes assemblage/public/data/country_centroids.json as:
  { "<ISO_A3>": { "name": "...", "lon": ..., "lat": ... }, ... }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional

from shapely.geometry import MultiPolygon, Polygon, shape

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GEOJSON = REPO_ROOT / "assemblage" / "public" / "data" / "world-110m.geojson"
DEFAULT_OUTPUT = REPO_ROOT / "assemblage" / "public" / "data" / "country_centroids.json"


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def largest_part_centroid(geom: Any) -> Optional[tuple[float, float]]:
    """Return (lon, lat) centroid of the largest Polygon part."""
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, Polygon):
        c = geom.centroid
        return float(c.x), float(c.y)
    if isinstance(geom, MultiPolygon):
        parts = [p for p in geom.geoms if not p.is_empty]
        if not parts:
            return None
        largest = max(parts, key=lambda p: p.area)
        c = largest.centroid
        return float(c.x), float(c.y)
    # GeometryCollection / other: try exterior via convex hull of largest poly
    polys = []
    if hasattr(geom, "geoms"):
        for g in geom.geoms:
            if isinstance(g, Polygon) and not g.is_empty:
                polys.append(g)
            elif isinstance(g, MultiPolygon):
                polys.extend(p for p in g.geoms if not p.is_empty)
    if not polys:
        if not geom.is_empty:
            c = geom.centroid
            return float(c.x), float(c.y)
        return None
    largest = max(polys, key=lambda p: p.area)
    c = largest.centroid
    return float(c.x), float(c.y)


def build_centroids(geojson_path: Path) -> dict[str, dict[str, Any]]:
    with geojson_path.open(encoding="utf-8") as fh:
        data = json.load(fh)

    centroids: dict[str, dict[str, Any]] = {}
    skipped = 0
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        name = str(props.get("NAME") or "").strip()
        iso3 = str(props.get("ISO_A3") or "").strip().upper()
        if not name or not iso3 or iso3 in ("-99", "NULL", "N/A"):
            skipped += 1
            continue
        try:
            geom = shape(feat.get("geometry"))
        except Exception as exc:  # noqa: BLE001
            eprint(f"WARNING: bad geometry for {iso3} ({name}): {exc}")
            skipped += 1
            continue
        pair = largest_part_centroid(geom)
        if pair is None:
            eprint(f"WARNING: empty geometry for {iso3} ({name})")
            skipped += 1
            continue
        lon, lat = pair
        if iso3 in centroids:
            eprint(f"Duplicate ISO_A3 {iso3}; keeping first ({centroids[iso3]['name']})")
            continue
        centroids[iso3] = {"name": name, "lon": round(lon, 6), "lat": round(lat, 6)}

    eprint(f"Computed {len(centroids)} centroids ({skipped} features skipped)")
    return centroids


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--geojson", type=Path, default=DEFAULT_GEOJSON)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if not args.geojson.exists():
        eprint(f"ERROR: geojson not found: {args.geojson}")
        return 1
    centroids = build_centroids(args.geojson)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(centroids, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    eprint(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
