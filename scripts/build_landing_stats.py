#!/usr/bin/env python3
"""Build assemblage/public/data/landing-stats.json for the Assemblage landing page.

Aggregates KPI counts from eukaryote_assemblies.tsv + submitter_institutes.tsv
(human and lab mouse excluded, matching the map), offshore country leaderboards
from species_flows.parquet, plus authored pipeline copy and disclaimers (with
interpolated numbers). Run after build_map_dataset.py.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import pyarrow.parquet as pq

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PARQUET = REPO_ROOT / "assemblage" / "public" / "data" / "species_flows.parquet"
DEFAULT_ASSEMBLIES = REPO_ROOT / "data" / "eukaryote_assemblies.tsv"
DEFAULT_INSTITUTES = REPO_ROOT / "data" / "submitter_institutes.tsv"
DEFAULT_OUTPUT = REPO_ROOT / "assemblage" / "public" / "data" / "landing-stats.json"
# Match scripts/build_map_dataset.py defaults (Homo sapiens, Mus musculus)
DEFAULT_EXCLUDE_TAXIDS = frozenset({"9606", "10090"})
TOP_INSTITUTE_COUNT = 5
TOP_COUNTRY_COUNT = 5

PIPELINE_STEPS = [
    {
        "step": 1,
        "title": "Fetch assemblies & taxonomy",
        "description": (
            "Stream NCBI GenBank eukaryote genome summaries via the datasets CLI, "
            "extract BioSample coordinates and geo_loc_name, and resolve each "
            "assembly to a species-level taxid."
        ),
    },
    {
        "step": 2,
        "title": "Build the taxonomic tree",
        "description": (
            "Walk ENA taxonomy lineages up to Eukaryota for every species with "
            "assemblies, then roll up counts for kingdom → genus filters on the map."
        ),
    },
    {
        "step": 3,
        "title": "Resolve institute geography",
        "description": (
            "Match each unique assembly_submitter string to a Research Organization "
            "Registry (ROR) record — affiliation chosen-match first, exact query "
            "fallback — and attach country plus coordinates."
        ),
    },
    {
        "step": 4,
        "title": "Assemble species flows",
        "description": (
            "Join assemblies, taxonomy, and institutes into one row per species "
            "(prefer latest coordinate-bearing assembly, else country-only; "
            "human and lab mouse excluded) and write the map parquet."
        ),
    },
]


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


def pct(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(100 * numerator / denominator, 1)


def institute_key(institute_name: Optional[str], ror_id: Optional[str]) -> Optional[str]:
    """Mirrors instituteKey() in assemblage/app/map/types.ts (ROR id, else name)."""
    ror = (ror_id or "").strip()
    if ror:
        return ror
    name = (institute_name or "").strip()
    return name or None


def load_assembly_kpis(
    path: Path,
    exclude_taxids: frozenset[str] = DEFAULT_EXCLUDE_TAXIDS,
) -> dict[str, int]:
    species_all: set[str] = set()
    species_with_coords: set[str] = set()
    species_with_geography: set[str] = set()
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        required = {
            "species_taxid",
            "has_biosample_coordinates",
            "biosample_collection_country",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(
                f"Assemblies {path} missing columns {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            tid = (row.get("species_taxid") or "").strip()
            if not tid or tid in exclude_taxids:
                continue
            species_all.add(tid)
            has_coords = (row.get("has_biosample_coordinates") or "").strip().casefold() == "true"
            has_country = bool((row.get("biosample_collection_country") or "").strip())
            if has_coords:
                species_with_coords.add(tid)
            if has_coords or has_country:
                species_with_geography.add(tid)
    return {
        "speciesWithAssemblies": len(species_all),
        "speciesWithCoordinates": len(species_with_coords),
        "speciesWithGeography": len(species_with_geography),
    }


def load_institute_kpis(path: Path) -> dict[str, int]:
    total = 0
    with_coords = 0
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        required = {"has_coordinates"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(
                f"Institutes {path} missing columns {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            total += 1
            if (row.get("has_coordinates") or "").strip().casefold() == "true":
                with_coords += 1
    return {
        "totalInstitutes": total,
        "institutesWithCoordinates": with_coords,
    }


def load_parquet_records(path: Path) -> list[dict[str, Any]]:
    table = pq.read_table(
        path,
        columns=[
            "has_institute_coordinates",
            "institute_name",
            "institute_ror_id",
            "collection_country",
            "collection_country_iso3",
            "institute_country",
            "institute_country_iso3",
        ],
    )
    return table.to_pylist()


def country_entry(
    country: str,
    offshore_count: int,
    total_with_geo: int,
) -> dict[str, Any]:
    return {
        "country": country,
        "offshoreCount": offshore_count,
        "totalWithGeo": total_with_geo,
        "offshorePct": pct(offshore_count, total_with_geo),
    }


def build_stats(
    assembly_kpis: dict[str, int],
    institute_kpis: dict[str, int],
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    total_species = len(records)
    resolved = [r for r in records if r.get("has_institute_coordinates")]
    resolved_count = len(resolved)

    # Institute concentration (by ROR/name key, same as map UI)
    key_counts: Counter[str] = Counter()
    name_by_key: dict[str, str] = {}
    for row in resolved:
        key = institute_key(row.get("institute_name"), row.get("institute_ror_id"))
        if not key:
            continue
        key_counts[key] += 1
        name = (row.get("institute_name") or "").strip()
        if name and key not in name_by_key:
            name_by_key[key] = name

    top_n = key_counts.most_common(TOP_INSTITUTE_COUNT)
    top_n_total = sum(count for _, count in top_n)
    top_institute_share = pct(top_n_total, resolved_count) if resolved else 0.0

    top_key, top_count = (top_n[0] if top_n else (None, 0))
    top_name = name_by_key.get(top_key or "", "the leading institute") if top_key else "the leading institute"
    top_single_share = pct(top_count, resolved_count) if resolved and top_count else 0.0

    # Offshore: collection ISO3 != institute ISO3 among rows with both resolved
    by_collection_offshore: Counter[str] = Counter()
    by_collection_total: Counter[str] = Counter()
    by_institute_offshore: Counter[str] = Counter()
    by_institute_total: Counter[str] = Counter()
    offshore = 0
    comparable = 0

    for row in resolved:
        coll_iso = (row.get("collection_country_iso3") or "").strip() or None
        inst_iso = (row.get("institute_country_iso3") or "").strip() or None
        coll_country = (row.get("collection_country") or "").strip()
        inst_country = (row.get("institute_country") or "").strip()
        if not coll_iso or not inst_iso or not coll_country or not inst_country:
            continue
        comparable += 1
        by_collection_total[coll_country] += 1
        by_institute_total[inst_country] += 1
        if coll_iso != inst_iso:
            offshore += 1
            by_collection_offshore[coll_country] += 1
            by_institute_offshore[inst_country] += 1

    # Top collection countries whose species were sequenced/assembled abroad
    # (collection country ISO3 != submitter institute country ISO3).
    top_collection = [
        country_entry(c, by_collection_offshore[c], by_collection_total[c])
        for c, _ in by_collection_offshore.most_common(TOP_COUNTRY_COUNT)
    ]
    # Top institute countries that assemble the most specimens collected abroad.
    top_institute_countries = [
        country_entry(c, by_institute_offshore[c], by_institute_total[c])
        for c, _ in by_institute_offshore.most_common(TOP_COUNTRY_COUNT)
    ]

    species_with_assemblies = assembly_kpis["speciesWithAssemblies"]
    species_with_coords = assembly_kpis["speciesWithCoordinates"]
    species_with_geography = assembly_kpis["speciesWithGeography"]
    total_institutes = institute_kpis["totalInstitutes"]
    institutes_with_coords = institute_kpis["institutesWithCoordinates"]

    disclaimers = [
        {
            "id": "institute-concentration",
            "text": (
                f"High counts for a few institutes — notably {top_name} "
                f"({top_count:,} species, ~{top_single_share}% of resolved arcs) — "
                "can reflect stricter control over sample and assembly metadata "
                "rather than exclusive sequencing capacity. Incomplete geo metadata "
                "elsewhere will under-count other labs."
            ),
        },
        {
            "id": "missing-geography",
            "text": (
                f"Only {species_with_geography:,} of {species_with_assemblies:,} "
                f"species with GenBank assemblies "
                f"({pct(species_with_geography, species_with_assemblies)}%) "
                "carry some retrievable geography (country and/or coordinates). "
                "Many species never enter the atlas, so visible flows are a biased "
                "slice of real sequencing geography."
            ),
        },
        {
            "id": "geo-is-proxy",
            "text": (
                "geo_loc_name is sample collection locality, not always wild origin. "
                "Submitter country (via ROR) is a proxy for where the assembly was "
                "deposited — not necessarily where sequencing was performed. "
                "Data sourced from INSDC / NCBI GenBank eukaryote assemblies and ROR."
            ),
        },
    ]

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "kpis": {
            "speciesWithAssemblies": species_with_assemblies,
            "speciesWithCoordinates": species_with_coords,
            "speciesWithCoordinatesPct": pct(species_with_coords, species_with_assemblies),
            "speciesWithGeography": species_with_geography,
            "speciesWithGeographyPct": pct(species_with_geography, species_with_assemblies),
            "totalInstitutes": total_institutes,
            "institutesWithCoordinates": institutes_with_coords,
            "institutesWithCoordinatesPct": pct(institutes_with_coords, total_institutes),
            "speciesInAtlas": total_species,
            "speciesWithInstituteArc": resolved_count,
            "speciesWithInstituteArcPct": pct(resolved_count, total_species),
            "topInstituteCount": len(top_n),
            "topInstituteSharePct": top_institute_share,
            "topInstituteName": top_name,
            "topInstituteSpeciesCount": top_count,
            "topInstituteShareSinglePct": top_single_share,
        },
        "pipeline": PIPELINE_STEPS,
        "offshore": {
            "definitionNote": (
                "Offshore = collection country ISO3 differs from submitter institute "
                "country ISO3, among species with both endpoints resolved."
            ),
            "comparableSpecies": comparable,
            "offshoreSpecies": offshore,
            "offshoreSpeciesPct": pct(offshore, comparable),
            "topCollectionCountries": top_collection,
            "topInstituteCountries": top_institute_countries,
        },
        "disclaimers": disclaimers,
    }


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--parquet",
        type=Path,
        default=DEFAULT_PARQUET,
        help="species_flows.parquet path",
    )
    p.add_argument(
        "--assemblies",
        type=Path,
        default=DEFAULT_ASSEMBLIES,
        help="eukaryote_assemblies.tsv path",
    )
    p.add_argument(
        "--institutes",
        type=Path,
        default=DEFAULT_INSTITUTES,
        help="submitter_institutes.tsv path",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="landing-stats.json output path",
    )
    # Backward-compatible alias used by earlier version of this script
    p.add_argument(
        "--input",
        type=Path,
        default=None,
        help=argparse.SUPPRESS,
    )
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    parquet_path = args.input if args.input is not None else args.parquet

    for path, label in (
        (parquet_path, "parquet"),
        (args.assemblies, "assemblies"),
        (args.institutes, "institutes"),
    ):
        if not path.exists():
            eprint(f"ERROR: {label} not found: {path}")
            if label == "parquet":
                eprint("Run scripts/build_map_dataset.py first, or pass --parquet explicitly.")
            return 1

    assembly_kpis = load_assembly_kpis(args.assemblies)
    institute_kpis = load_institute_kpis(args.institutes)
    records = load_parquet_records(parquet_path)
    if not records:
        eprint(f"ERROR: no rows read from {parquet_path}")
        return 1

    stats = build_stats(assembly_kpis, institute_kpis, records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n")

    eprint(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    eprint(
        f"KPIs: {stats['kpis']['speciesWithAssemblies']} species w/ assemblies; "
        f"{stats['kpis']['speciesWithGeography']} w/ geography; "
        f"{stats['kpis']['speciesWithCoordinates']} w/ coords; "
        f"{stats['kpis']['institutesWithCoordinates']}/{stats['kpis']['totalInstitutes']} "
        f"institutes geocoded; offshore {stats['offshore']['offshoreSpeciesPct']}%"
    )
    top_offshore = stats["offshore"]["topCollectionCountries"]
    if top_offshore:
        ranking = ", ".join(
            f"{row['country']} ({row['offshoreCount']}, {row['offshorePct']}%)"
            for row in top_offshore
        )
        eprint(f"Top {len(top_offshore)} collection countries sequenced offshore: {ranking}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
