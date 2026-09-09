#!/usr/bin/env python3
"""Build a species-flow Parquet dataset for the Assemblage map.

Joins eukaryote_assemblies.tsv, taxonomic_tree.tsv, and submitter_institutes.tsv
into one row per species: prefer the latest coordinate-bearing assembly, else the
latest assembly with a BioSample collection country (lat/lon null). Includes
collection/institute endpoints plus flattened taxonomic ranks for filtering.

Human (9606) and lab mouse (10090) are excluded by default.
South/North classification is deferred to a later step.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Optional

import pyarrow as pa
import pyarrow.parquet as pq

EUKARYOTA_TAXID = "2759"
MAX_WALK_DEPTH = 200
DEFAULT_EXCLUDE_TAXIDS = frozenset({"9606", "10090"})  # Homo sapiens, Mus musculus
TARGET_RANKS = ("kingdom", "phylum", "class", "order", "family", "genus")
ACCESSION_RE = re.compile(r"^[A-Z]+_(\d+)\.(\d+)$")

PARQUET_COLUMNS = [
    "species_taxid",
    "species_scientific_name",
    "is_species_name_binomial",
    "assembly_accession",
    "assembly_level",
    "assembly_refseq_category",
    "assemblies_count_total",
    "kingdom_taxid",
    "kingdom_name",
    "phylum_taxid",
    "phylum_name",
    "class_taxid",
    "class_name",
    "order_taxid",
    "order_name",
    "family_taxid",
    "family_name",
    "genus_taxid",
    "genus_name",
    "collection_lat",
    "collection_lon",
    "collection_country",
    "collection_continent",
    "collection_country_iso3",
    "submitter_name",
    "institute_name",
    "institute_ror_id",
    "institute_country",
    "institute_continent",
    "institute_country_iso3",
    "institute_lat",
    "institute_lon",
    "has_institute_coordinates",
]

# BioSample collection_country free-text -> (continent, ISO_A3 for basemap highlight).
# ISO3 is None when there is no matching Natural Earth 110m polygon (oceans, tiny islands).
# Dependent territories map to the nearest visible sovereign polygon's ISO3.
COUNTRY_TO_REGION: dict[str, tuple[str, Optional[str]]] = {
    "": ("Unknown", None),
    "Albania": ("Europe", "ALB"),
    "Algeria": ("Africa", "DZA"),
    "American Samoa": ("Oceania", None),
    "Angola": ("Africa", "AGO"),
    "Antarctica": ("Antarctica", "ATA"),
    "Arctic Ocean": ("Unknown", None),
    "Argentina": ("South America", "ARG"),
    "Armenia": ("Asia", "ARM"),
    "Atlantic Ocean": ("Unknown", None),
    "Australia": ("Oceania", "AUS"),
    "Austria": ("Europe", "AUT"),
    "Azerbaijan": ("Asia", "AZE"),
    "Baltic Sea": ("Unknown", None),
    "Bangladesh": ("Asia", "BGD"),
    "Belarus": ("Europe", "BLR"),
    "Belgium": ("Europe", "BEL"),
    "Belize": ("North America", "BLZ"),
    "Benin": ("Africa", "BEN"),
    "Bermuda": ("North America", None),
    "Bhutan": ("Asia", "BTN"),
    "Bolivia": ("South America", "BOL"),
    "Borneo": ("Asia", None),
    "Botswana": ("Africa", "BWA"),
    "Brazil": ("South America", "BRA"),
    "Brunei": ("Asia", "BRN"),
    "Bulgaria": ("Europe", "BGR"),
    "Burkina Faso": ("Africa", "BFA"),
    "Burundi": ("Africa", "BDI"),
    "Cameroon": ("Africa", "CMR"),
    "Canada": ("North America", "CAN"),
    "Cape Verde": ("Africa", None),
    "Central African Republic": ("Africa", "CAF"),
    "Chile": ("South America", "CHL"),
    "China": ("Asia", "CHN"),
    "Cocos Islands": ("Asia", None),
    "Colombia": ("South America", "COL"),
    "Comoros": ("Africa", None),
    "Costa Rica": ("North America", "CRI"),
    "Cote d'Ivoire": ("Africa", "CIV"),
    "Croatia": ("Europe", "HRV"),
    "Cuba": ("North America", "CUB"),
    "Curacao": ("North America", None),
    "Cyprus": ("Asia", "CYP"),
    "Czech Republic": ("Europe", "CZE"),
    "Czechia": ("Europe", "CZE"),
    "Democratic Republic of the Congo": ("Africa", "COD"),
    "Denmark": ("Europe", "DNK"),
    "Djibouti": ("Africa", "DJI"),
    "Dominica": ("North America", None),
    "Dominican Republic": ("North America", "DOM"),
    "Ecuador": ("South America", "ECU"),
    "Egypt": ("Africa", "EGY"),
    "Estonia": ("Europe", "EST"),
    "Eswatini": ("Africa", "SWZ"),
    "Ethiopia": ("Africa", "ETH"),
    "Falkland Islands (Islas Malvinas)": ("South America", "FLK"),
    "Faroe Islands": ("Europe", None),
    "Fiji": ("Oceania", "FJI"),
    "Finland": ("Europe", "FIN"),
    "France": ("Europe", "FRA"),
    "French Guiana": ("South America", None),
    "Gabon": ("Africa", "GAB"),
    "Gambia": ("Africa", "GMB"),
    "Georgia": ("Asia", "GEO"),
    "Germany": ("Europe", "DEU"),
    "Ghana": ("Africa", "GHA"),
    "Greece": ("Europe", "GRC"),
    "Greenland": ("North America", "GRL"),
    "Guadeloupe": ("North America", None),
    "Guam": ("Oceania", None),
    "Guatemala": ("North America", "GTM"),
    "Guyana": ("South America", "GUY"),
    "Honduras": ("North America", "HND"),
    "Hong Kong": ("Asia", None),
    "Hungary": ("Europe", "HUN"),
    "Iceland": ("Europe", "ISL"),
    "India": ("Asia", "IND"),
    "Indian Ocean": ("Unknown", None),
    "Indonesia": ("Asia", "IDN"),
    "Iran": ("Asia", "IRN"),
    "Iraq": ("Asia", "IRQ"),
    "Ireland": ("Europe", "IRL"),
    "Israel": ("Asia", "ISR"),
    "Italy": ("Europe", "ITA"),
    "Japan": ("Asia", "JPN"),
    "Jordan": ("Asia", "JOR"),
    "Kazakhstan": ("Asia", "KAZ"),
    "Kenya": ("Africa", "KEN"),
    "Korea": ("Asia", "KOR"),
    "Kuwait": ("Asia", "KWT"),
    "Kyrgyzstan": ("Asia", "KGZ"),
    "Latvia": ("Europe", "LVA"),
    "Lebanon": ("Asia", "LBN"),
    "Lesotho": ("Africa", "LSO"),
    "Liberia": ("Africa", "LBR"),
    "Libya": ("Africa", "LBY"),
    "Lithuania": ("Europe", "LTU"),
    "Luxembourg": ("Europe", "LUX"),
    "Macao": ("Asia", None),
    "Madagascar": ("Africa", "MDG"),
    "Malawi": ("Africa", "MWI"),
    "Malaysia": ("Asia", "MYS"),
    "Mali": ("Africa", "MLI"),
    "Malta": ("Europe", None),
    "Martinique": ("North America", None),
    "Mauritius": ("Africa", None),
    "Mayotte": ("Africa", None),
    "Mediterranean Sea": ("Unknown", None),
    "Mexico": ("North America", "MEX"),
    "Monaco": ("Europe", None),
    "Mongolia": ("Asia", "MNG"),
    "Montenegro": ("Europe", "MNE"),
    "Morocco": ("Africa", "MAR"),
    "Mozambique": ("Africa", "MOZ"),
    "Myanmar": ("Asia", "MMR"),
    "Namibia": ("Africa", "NAM"),
    "Nepal": ("Asia", "NPL"),
    "Netherlands": ("Europe", "NLD"),
    "New Caledonia": ("Oceania", "NCL"),
    "New Zealand": ("Oceania", "NZL"),
    "Nicaragua": ("North America", "NIC"),
    "Nigeria": ("Africa", "NGA"),
    "North Macedonia": ("Europe", "MKD"),
    "North Sea": ("Unknown", None),
    "Norway": ("Europe", "NOR"),
    "Oman": ("Asia", "OMN"),
    "Pacific Ocean": ("Unknown", None),
    "Pakistan": ("Asia", "PAK"),
    "Palau": ("Oceania", None),
    "Panama": ("North America", "PAN"),
    "Papua New Guinea": ("Oceania", "PNG"),
    "Paraguay": ("South America", "PRY"),
    "Peru": ("South America", "PER"),
    "Philippines": ("Asia", "PHL"),
    "Pitcairn Islands": ("Oceania", None),
    "Poland": ("Europe", "POL"),
    "Portugal": ("Europe", "PRT"),
    "Puerto Rico": ("North America", "PRI"),
    "Qatar": ("Asia", "QAT"),
    "Reunion": ("Africa", None),
    "Romania": ("Europe", "ROU"),
    "Russia": ("Europe", "RUS"),
    "Réunion": ("Africa", None),
    "Saint Vincent and the Grenadines": ("North America", None),
    "Saudi Arabia": ("Asia", "SAU"),
    "Senegal": ("Africa", "SEN"),
    "Serbia": ("Europe", "SRB"),
    "Seychelles": ("Africa", None),
    "Sierra Leone": ("Africa", "SLE"),
    "Singapore": ("Asia", None),
    "Slovakia": ("Europe", "SVK"),
    "Slovenia": ("Europe", "SVN"),
    "Solomon Islands": ("Oceania", "SLB"),
    "Somalia": ("Africa", "SOM"),
    "South Africa": ("Africa", "ZAF"),
    "South Korea": ("Asia", "KOR"),
    "Southern Ocean": ("Unknown", None),
    "Spain": ("Europe", "ESP"),
    "Sri Lanka": ("Asia", "LKA"),
    "St Kitts and Nevis": ("North America", None),
    "Sudan": ("Africa", "SDN"),
    "Suriname": ("South America", "SUR"),
    "Svalbard": ("Europe", None),
    "Sweden": ("Europe", "SWE"),
    "Switzerland": ("Europe", "CHE"),
    "Taiwan": ("Asia", "TWN"),
    "Tajikistan": ("Asia", "TJK"),
    "Tanzania": ("Africa", "TZA"),
    "Thailand": ("Asia", "THA"),
    "The Netherlands": ("Europe", "NLD"),
    "Togo": ("Africa", "TGO"),
    "Tonga": ("Oceania", None),
    "Trinidad and Tobago": ("North America", "TTO"),
    "Tunisia": ("Africa", "TUN"),
    "Turkey": ("Asia", "TUR"),
    "Türkiye": ("Asia", "TUR"),
    "USA": ("North America", "USA"),
    "Uganda": ("Africa", "UGA"),
    "Ukraine": ("Europe", "UKR"),
    "United Arab Emirates": ("Asia", "ARE"),
    "United Kingdom": ("Europe", "GBR"),
    "United States": ("North America", "USA"),
    "Uruguay": ("South America", "URY"),
    "Uzbekistan": ("Asia", "UZB"),
    "Venezuela": ("South America", "VEN"),
    "Viet Nam": ("Asia", "VNM"),
    "Vietnam": ("Asia", "VNM"),
    "Yemen": ("Asia", "YEM"),
    "Zambia": ("Africa", "ZMB"),
    "Zimbabwe": ("Africa", "ZWE"),
}


def resolve_collection_region(country: str) -> tuple[str, Optional[str]]:
    """Map a BioSample collection_country string to (continent, iso3)."""
    return COUNTRY_TO_REGION.get(country, ("Unknown", None))


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def parse_accession_key(accession: str) -> Optional[tuple[int, int]]:
    """Parse GCA_XXXXXXXXX.N into (numeric_id, version) for latest selection."""
    match = ACCESSION_RE.match((accession or "").strip())
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def parse_float(raw: Any) -> Optional[float]:
    text = (str(raw) if raw is not None else "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_tree_nodes(path: Path) -> dict[str, dict[str, str]]:
    """Load taxonomic_tree.tsv into taxid -> {parent_taxid, rank, scientific_name}."""
    nodes: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        required = {"taxid", "parent_taxid", "rank", "scientific_name"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(
                f"Tree {path} missing columns {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            taxid = (row.get("taxid") or "").strip()
            if not taxid:
                continue
            nodes[taxid] = {
                "parent_taxid": (row.get("parent_taxid") or "").strip(),
                "rank": (row.get("rank") or "").strip().casefold(),
                "scientific_name": (row.get("scientific_name") or "").strip(),
            }
    eprint(f"Loaded {len(nodes)} taxonomy nodes from {path}")
    return nodes


def flatten_ranks(
    taxid: str,
    nodes: dict[str, dict[str, str]],
    cache: dict[str, dict[str, tuple[str, str]]],
) -> dict[str, tuple[str, str]]:
    """Walk taxid -> parent up to Eukaryota; return rank -> (taxid, name).

    Records the first ancestor whose rank matches each TARGET_RANKS entry.
    Missing ranks are simply absent from the returned dict.
    """
    if taxid in cache:
        return cache[taxid]

    found: dict[str, tuple[str, str]] = {}
    seen: set[str] = set()
    cur: Optional[str] = taxid
    depth = 0
    while cur:
        if cur in seen:
            eprint(f"WARNING: cycle at taxid {cur} while walking from {taxid}")
            break
        seen.add(cur)
        depth += 1
        if depth > MAX_WALK_DEPTH:
            eprint(f"WARNING: walk depth exceeded for taxid {taxid}")
            break
        node = nodes.get(cur)
        if node is None:
            break
        rank = node["rank"]
        if rank in TARGET_RANKS and rank not in found:
            found[rank] = (cur, node["scientific_name"])
        if cur == EUKARYOTA_TAXID:
            break
        parent = node["parent_taxid"]
        cur = parent if parent else None

    cache[taxid] = found
    return found


def load_institutes(path: Path) -> dict[str, dict[str, str]]:
    """Load submitter_institutes.tsv keyed by submitter_name."""
    institutes: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        required = {
            "submitter_name",
            "institute_name_ror",
            "ror_id",
            "country",
            "lat",
            "lon",
            "has_coordinates",
        }
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(
                f"Institutes {path} missing columns {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            name = (row.get("submitter_name") or "").strip()
            if name:
                institutes[name] = row
    eprint(f"Loaded {len(institutes)} submitter institutes from {path}")
    return institutes


def select_latest_assemblies(
    path: Path,
    exclude_taxids: set[str],
) -> tuple[dict[str, dict[str, str]], dict[str, int], int, int]:
    """Exclude taxa; pick one assembly per species (coords preferred, else country).

    Returns:
      selected: species_taxid -> assembly row
      totals: species_taxid -> assemblies_count_total (all assemblies, excl. taxa)
      skipped_excluded: count of rows dropped for excluded taxids
      skipped_bad_acc: count of eligible rows with unparseable accession
    """
    totals: dict[str, int] = Counter()
    coord_candidates: dict[str, tuple[tuple[int, int], dict[str, str]]] = {}
    country_candidates: dict[str, tuple[tuple[int, int], dict[str, str]]] = {}
    skipped_excluded = 0
    skipped_bad_acc = 0
    required = {
        "assembly_accession",
        "species_taxid",
        "species_scientific_name",
        "has_biosample_coordinates",
        "biosample_lat",
        "biosample_lon",
        "biosample_collection_country",
        "assembly_submitter",
    }

    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(
                f"Assemblies {path} missing columns {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            taxid = (row.get("species_taxid") or "").strip()
            if not taxid:
                continue
            if taxid in exclude_taxids:
                skipped_excluded += 1
                continue
            totals[taxid] += 1

            has_coords = (
                (row.get("has_biosample_coordinates") or "").strip().casefold()
                == "true"
            )
            has_country = bool(
                (row.get("biosample_collection_country") or "").strip()
            )
            if not has_coords and not has_country:
                continue

            key = parse_accession_key(row.get("assembly_accession") or "")
            if key is None:
                skipped_bad_acc += 1
                eprint(
                    f"WARNING: unparseable accession "
                    f"{(row.get('assembly_accession') or '')!r} for taxid {taxid}"
                )
                continue

            bucket = coord_candidates if has_coords else country_candidates
            prev = bucket.get(taxid)
            if prev is None or key > prev[0]:
                bucket[taxid] = (key, row)

    selected = {tid: pair[1] for tid, pair in coord_candidates.items()}
    n_with_coords = len(selected)
    for tid, pair in country_candidates.items():
        if tid not in selected:
            selected[tid] = pair[1]
    n_country_only = len(selected) - n_with_coords
    eprint(
        f"Selected {len(selected)} species "
        f"({n_with_coords} with coordinates, {n_country_only} country-only; "
        f"excluded {skipped_excluded} human/mouse rows; "
        f"{skipped_bad_acc} bad accessions)"
    )
    return selected, dict(totals), skipped_excluded, skipped_bad_acc


def assemble_records(
    selected: dict[str, dict[str, str]],
    totals: dict[str, int],
    nodes: dict[str, dict[str, str]],
    institutes: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    """Join lineage + institute geo into one output record per species."""
    rank_cache: dict[str, dict[str, tuple[str, str]]] = {}
    records: list[dict[str, Any]] = []

    for taxid in sorted(selected.keys(), key=lambda t: (len(t), t)):
        row = selected[taxid]
        ranks = flatten_ranks(taxid, nodes, rank_cache)

        submitter = (row.get("assembly_submitter") or "").strip()
        inst = institutes.get(submitter) if submitter else None
        has_inst_coords = bool(
            inst
            and (inst.get("has_coordinates") or "").strip().casefold() == "true"
            and parse_float(inst.get("lat")) is not None
            and parse_float(inst.get("lon")) is not None
        )

        collection_country = (row.get("biosample_collection_country") or "").strip()
        continent, country_iso3 = resolve_collection_region(collection_country)

        record: dict[str, Any] = {
            "species_taxid": taxid,
            "species_scientific_name": (row.get("species_scientific_name") or "").strip(),
            "is_species_name_binomial": (
                (row.get("is_species_name_binomial") or "").strip().casefold() == "true"
            ),
            "assembly_accession": (row.get("assembly_accession") or "").strip(),
            "assembly_level": (row.get("assembly_level") or "").strip(),
            "assembly_refseq_category": (
                row.get("assembly_refseq_category") or ""
            ).strip(),
            "assemblies_count_total": int(totals.get(taxid, 0)),
            "collection_lat": parse_float(row.get("biosample_lat")),
            "collection_lon": parse_float(row.get("biosample_lon")),
            "collection_country": collection_country,
            "collection_continent": continent,
            "collection_country_iso3": country_iso3,
            "submitter_name": submitter,
            "institute_name": None,
            "institute_ror_id": None,
            "institute_country": None,
            "institute_continent": None,
            "institute_country_iso3": None,
            "institute_lat": None,
            "institute_lon": None,
            "has_institute_coordinates": has_inst_coords,
        }

        for rank in TARGET_RANKS:
            pair = ranks.get(rank)
            record[f"{rank}_taxid"] = pair[0] if pair else None
            record[f"{rank}_name"] = pair[1] if pair else None

        if has_inst_coords and inst is not None:
            record["institute_name"] = (inst.get("institute_name_ror") or "").strip() or None
            record["institute_ror_id"] = (inst.get("ror_id") or "").strip() or None
            institute_country = (inst.get("country") or "").strip() or None
            record["institute_country"] = institute_country
            if institute_country:
                inst_continent, inst_iso3 = resolve_collection_region(institute_country)
                record["institute_continent"] = inst_continent
                record["institute_country_iso3"] = inst_iso3
            record["institute_lat"] = parse_float(inst.get("lat"))
            record["institute_lon"] = parse_float(inst.get("lon"))

        records.append(record)

    return records


def write_parquet(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Build columns in a stable order for a predictable schema
    arrays: dict[str, list[Any]] = {col: [] for col in PARQUET_COLUMNS}
    for rec in records:
        for col in PARQUET_COLUMNS:
            arrays[col].append(rec.get(col))

    table = pa.table(
        {
            "species_taxid": pa.array(arrays["species_taxid"], type=pa.string()),
            "species_scientific_name": pa.array(
                arrays["species_scientific_name"], type=pa.string()
            ),
            "is_species_name_binomial": pa.array(
                arrays["is_species_name_binomial"], type=pa.bool_()
            ),
            "assembly_accession": pa.array(
                arrays["assembly_accession"], type=pa.string()
            ),
            "assembly_level": pa.array(arrays["assembly_level"], type=pa.string()),
            "assembly_refseq_category": pa.array(
                arrays["assembly_refseq_category"], type=pa.string()
            ),
            "assemblies_count_total": pa.array(
                arrays["assemblies_count_total"], type=pa.int32()
            ),
            "kingdom_taxid": pa.array(arrays["kingdom_taxid"], type=pa.string()),
            "kingdom_name": pa.array(arrays["kingdom_name"], type=pa.string()),
            "phylum_taxid": pa.array(arrays["phylum_taxid"], type=pa.string()),
            "phylum_name": pa.array(arrays["phylum_name"], type=pa.string()),
            "class_taxid": pa.array(arrays["class_taxid"], type=pa.string()),
            "class_name": pa.array(arrays["class_name"], type=pa.string()),
            "order_taxid": pa.array(arrays["order_taxid"], type=pa.string()),
            "order_name": pa.array(arrays["order_name"], type=pa.string()),
            "family_taxid": pa.array(arrays["family_taxid"], type=pa.string()),
            "family_name": pa.array(arrays["family_name"], type=pa.string()),
            "genus_taxid": pa.array(arrays["genus_taxid"], type=pa.string()),
            "genus_name": pa.array(arrays["genus_name"], type=pa.string()),
            "collection_lat": pa.array(arrays["collection_lat"], type=pa.float64()),
            "collection_lon": pa.array(arrays["collection_lon"], type=pa.float64()),
            "collection_country": pa.array(
                arrays["collection_country"], type=pa.string()
            ),
            "collection_continent": pa.array(
                arrays["collection_continent"], type=pa.string()
            ),
            "collection_country_iso3": pa.array(
                arrays["collection_country_iso3"], type=pa.string()
            ),
            "submitter_name": pa.array(arrays["submitter_name"], type=pa.string()),
            "institute_name": pa.array(arrays["institute_name"], type=pa.string()),
            "institute_ror_id": pa.array(arrays["institute_ror_id"], type=pa.string()),
            "institute_country": pa.array(
                arrays["institute_country"], type=pa.string()
            ),
            "institute_continent": pa.array(
                arrays["institute_continent"], type=pa.string()
            ),
            "institute_country_iso3": pa.array(
                arrays["institute_country_iso3"], type=pa.string()
            ),
            "institute_lat": pa.array(arrays["institute_lat"], type=pa.float64()),
            "institute_lon": pa.array(arrays["institute_lon"], type=pa.float64()),
            "has_institute_coordinates": pa.array(
                arrays["has_institute_coordinates"], type=pa.bool_()
            ),
        }
    )
    pq.write_table(table, path, compression="snappy")
    eprint(f"Wrote {len(records)} rows to {path} ({path.stat().st_size:,} bytes)")


def print_summary(
    records: list[dict[str, Any]],
    skipped_excluded: int,
    output: Path,
) -> None:
    n = len(records)
    with_coords = sum(
        1 for r in records if r.get("collection_lat") is not None and r.get("collection_lon") is not None
    )
    country_only = n - with_coords
    with_arc = sum(1 for r in records if r["has_institute_coordinates"])
    eprint("")
    eprint("=== Summary ===")
    eprint(f"Species in output:            {n}")
    eprint(f"With collection coordinates:  {with_coords}")
    eprint(f"Country-only (null lat/lon):  {country_only}")
    eprint(f"With institute arcs:          {with_arc} ({100 * with_arc / n:.1f}%)" if n else "With institute arcs:          0")
    eprint(f"Collection-only (no arc):     {n - with_arc}")
    eprint(f"Excluded human/mouse rows:    {skipped_excluded}")
    eprint(f"Output:                       {output} ({output.stat().st_size:,} bytes)")
    eprint("Rank coverage:")
    for rank in TARGET_RANKS:
        key = f"{rank}_taxid"
        covered = sum(1 for r in records if r.get(key))
        pct = 100 * covered / n if n else 0.0
        eprint(f"  {rank:<8} {covered:>6} / {n} ({pct:.1f}%)")

    continents = Counter(r.get("collection_continent") or "Unknown" for r in records)
    eprint("Continent coverage:")
    for name, count in sorted(continents.items(), key=lambda x: (-x[1], x[0])):
        pct = 100 * count / n if n else 0.0
        eprint(f"  {name:<16} {count:>6} / {n} ({pct:.1f}%)")
    with_iso3 = sum(1 for r in records if r.get("collection_country_iso3"))
    eprint(
        f"With country ISO3 (highlightable): {with_iso3} / {n} "
        f"({100 * with_iso3 / n:.1f}%)" if n else "With country ISO3: 0"
    )
    unmapped = sorted(
        {
            r["collection_country"]
            for r in records
            if r["collection_country"] not in COUNTRY_TO_REGION
        }
    )
    if unmapped:
        eprint(f"WARNING: unmapped collection_country values: {unmapped}")

    # Sanity: excluded taxids must not appear
    leaked = [r for r in records if r["species_taxid"] in DEFAULT_EXCLUDE_TAXIDS]
    if leaked:
        eprint(f"ERROR: excluded taxids present in output: {leaked}")


def parse_exclude_taxids(raw: str) -> set[str]:
    return {t.strip() for t in raw.split(",") if t.strip()}


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(
        description="Build species-flow Parquet for the Assemblage map."
    )
    p.add_argument(
        "--assemblies-input",
        type=Path,
        default=repo_root / "data" / "eukaryote_assemblies.tsv",
        help="Assemblies TSV",
    )
    p.add_argument(
        "--tree-input",
        type=Path,
        default=repo_root / "data" / "taxonomic_tree.tsv",
        help="Taxonomic tree TSV",
    )
    p.add_argument(
        "--institutes-input",
        type=Path,
        default=repo_root / "data" / "submitter_institutes.tsv",
        help="Submitter institutes TSV",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=repo_root / "assemblage" / "public" / "data" / "species_flows.parquet",
        help="Output Parquet path",
    )
    p.add_argument(
        "--exclude-taxids",
        default="9606,10090",
        help="Comma-separated species taxids to exclude (default: human, lab mouse)",
    )
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    for path, label in (
        (args.assemblies_input, "assemblies"),
        (args.tree_input, "tree"),
        (args.institutes_input, "institutes"),
    ):
        if not path.exists():
            eprint(f"{label} input not found: {path}")
            return 1

    exclude = parse_exclude_taxids(args.exclude_taxids)
    eprint(f"Excluding taxids: {sorted(exclude, key=lambda t: (len(t), t))}")

    nodes = load_tree_nodes(args.tree_input)
    institutes = load_institutes(args.institutes_input)
    selected, totals, skipped_excluded, _bad = select_latest_assemblies(
        args.assemblies_input, exclude
    )
    if not selected:
        eprint("No species with coordinates or country after filtering; writing empty table")
        write_parquet(args.output, [])
        return 0

    eprint(f"Flattening ranks and joining institutes for {len(selected)} species...")
    records = assemble_records(selected, totals, nodes, institutes)
    write_parquet(args.output, records)
    print_summary(records, skipped_excluded, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
