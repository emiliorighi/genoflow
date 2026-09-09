#!/usr/bin/env python3
"""Export data/species_counts_by_country.tsv as JSON for the regions atlas.

Writes assemblage/public/data/species_counts_by_country.json as an array of:
  { country_name, iso3, iso2, gbif_species_count, inat_species_count }
with blank numeric cells as null.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "data" / "species_counts_by_country.tsv"
DEFAULT_OUTPUT = (
    REPO_ROOT / "assemblage" / "public" / "data" / "species_counts_by_country.json"
)


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def parse_optional_int(raw: Optional[str]) -> Optional[int]:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def export_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        required = {
            "country_name",
            "iso3",
            "iso2",
            "gbif_species_count",
            "inat_species_count",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(
                f"Input {path} missing columns {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            rows.append(
                {
                    "country_name": (row.get("country_name") or "").strip(),
                    "iso3": (row.get("iso3") or "").strip().upper() or None,
                    "iso2": (row.get("iso2") or "").strip().upper() or None,
                    "gbif_species_count": parse_optional_int(
                        row.get("gbif_species_count")
                    ),
                    "inat_species_count": parse_optional_int(
                        row.get("inat_species_count")
                    ),
                }
            )
    return rows


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if not args.input.exists():
        eprint(f"ERROR: input not found: {args.input}")
        return 1
    rows = export_rows(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(rows, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    eprint(f"Wrote {len(rows)} rows to {args.output} ({args.output.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
