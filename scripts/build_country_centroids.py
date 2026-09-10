#!/usr/bin/env python3
"""Build country centroids from world-110m.geojson for the regions atlas.

For each ISO_A3 feature, uses the centroid of the largest polygon (by area)
so multi-part countries (Chile, Indonesia, etc.) land on the main landmass
rather than in the ocean between islands.

Writes assemblage/public/data/country_centroids.json as:
  { "<ISO_A3>": { "name": "...", "lon": ..., "lat": ... }, ... }

Also merges CENTROID_OVERRIDES for territories missing from Natural Earth 110m,
synthetic ocean/sea basins, and vague regional labels used in BioSample metadata.
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

# Manual points for places absent from world-110m, plus synthetic basin/region codes.
# Format: ISO3_OR_CODE -> (name, lon, lat)
CENTROID_OVERRIDES: dict[str, tuple[str, float, float]] = {
    # Territories / small states missing from Natural Earth 110m
    "SGP": ("Singapore", 103.82, 1.35),
    "HKG": ("Hong Kong", 114.17, 22.32),
    "GUF": ("French Guiana", -53.0, 4.0),
    "PYF": ("French Polynesia", -149.4, -17.7),
    "GUM": ("Guam", 144.79, 13.44),
    "STP": ("Sao Tome and Principe", 6.73, 0.34),
    "REU": ("Reunion", 55.54, -21.12),
    "CUW": ("Curacao", -68.99, 12.17),
    "CPV": ("Cape Verde", -23.61, 15.12),
    "FRO": ("Faroe Islands", -6.91, 62.0),
    "SYC": ("Seychelles", 55.45, -4.68),
    "MUS": ("Mauritius", 57.55, -20.3),
    "VGB": ("British Virgin Islands", -64.62, 18.42),
    "MNP": ("Northern Mariana Islands", 145.75, 15.2),
    "MHL": ("Marshall Islands", 171.18, 7.13),
    "VCT": ("Saint Vincent and the Grenadines", -61.2, 13.25),
    "DMA": ("Dominica", -61.37, 15.43),
    "PLW": ("Palau", 134.58, 7.5),
    "KNA": ("Saint Kitts and Nevis", -62.78, 17.34),
    "LCA": ("Saint Lucia", -60.98, 13.91),
    "GLP": ("Guadeloupe", -61.55, 16.25),
    "MYT": ("Mayotte", 45.17, -12.83),
    "BRB": ("Barbados", -59.55, 13.19),
    "SHN": ("Saint Helena", -5.72, -15.96),
    "TCA": ("Turks and Caicos Islands", -71.8, 21.7),
    "TON": ("Tonga", -175.2, -21.18),
    "SJM": ("Svalbard", 18.75, 78.22),
    "BMU": ("Bermuda", -64.75, 32.3),
    "COM": ("Comoros", 43.33, -11.65),
    "MLT": ("Malta", 14.51, 35.9),
    "MCO": ("Monaco", 7.42, 43.74),
    "MAC": ("Macao", 113.54, 22.2),
    "ASM": ("American Samoa", -170.7, -14.3),
    "PCN": ("Pitcairn Islands", -130.1, -25.07),
    "CCK": ("Cocos Islands", 96.87, -12.16),
    "JEY": ("Jersey", -2.13, 49.21),
    "BLM": ("Saint Barthelemy", -62.83, 17.9),
    "SGS": ("South Georgia and the South Sandwich Islands", -36.5, -54.5),
    "VIR": ("Virgin Islands", -64.9, 18.35),
    "FSM": ("Micronesia", 158.2, 6.9),
    "GRD": ("Grenada", -61.68, 12.11),
    "BHR": ("Bahrain", 50.55, 26.03),
    "MDV": ("Maldives", 73.51, 4.17),
    "WSM": ("Samoa", -172.1, -13.8),
    "XKX": ("Kosovo", 20.9, 42.55),
    "MTQ": ("Martinique", -61.02, 14.64),
    # Synthetic ocean / sea basins
    "XPA": ("Pacific Ocean", -160.0, 0.0),
    "XIN": ("Indian Ocean", 80.0, -20.0),
    "XAT": ("Atlantic Ocean", -30.0, 0.0),
    "XME": ("Mediterranean Sea", 18.0, 35.0),
    "XNS": ("North Sea", 3.0, 56.0),
    "XBA": ("Baltic Sea", 20.0, 58.0),
    "XSO": ("Southern Ocean", 0.0, -60.0),
    "XAR": ("Arctic Ocean", 0.0, 85.0),
    # Vague / regional BioSample labels
    "XBN": ("Borneo", 114.0, 0.5),
    "XWA": ("W. Africa", -5.0, 8.0),
    "XAF": ("Africa", 20.0, 5.0),
    "XUN": ("Unknown", 0.0, 0.0),
}


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


def apply_overrides(centroids: dict[str, dict[str, Any]]) -> int:
    """Merge CENTROID_OVERRIDES; overrides win when a key already exists."""
    added = 0
    for iso3, (name, lon, lat) in CENTROID_OVERRIDES.items():
        was_present = iso3 in centroids
        centroids[iso3] = {
            "name": name,
            "lon": round(float(lon), 6),
            "lat": round(float(lat), 6),
        }
        if not was_present:
            added += 1
    return added


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
    added = apply_overrides(centroids)
    eprint(f"Applied {len(CENTROID_OVERRIDES)} overrides ({added} new keys)")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(centroids, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    eprint(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes, {len(centroids)} entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
