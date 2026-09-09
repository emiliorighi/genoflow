#!/usr/bin/env python3
"""Collect NCBI GenBank eukaryote assemblies into a TSV dataset.

Uses the NCBI `datasets` CLI to:
  1. Stream genome summaries for a taxon (default: Eukaryota, GenBank only)
  2. Extract biosample geo/country from GenBank/DDBJ lat_lon, ENA lat/lon
     attributes, Darwin Core decimal_latitude/longitude, and related aliases
  3. Resolve species-level taxonomy via batched `datasets summary taxonomy`
  4. Write a TSV suitable for later geo / parquet analysis
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

MISSING_TOKENS = frozenset(
    {
        "not collected",
        "not provided",
        "not applicable",
        "missing",
        "restricted access",
        "na",
        "n/a",
        "none",
        "null",
        "unknown",
    }
)

# NCBI lat_lon: "6.755 S 51.069 W" or "51.69 N 1.32 W"
LAT_LON_RE = re.compile(
    r"""
    ^\s*
    (?P<lat_num>-?\d+(?:\.\d+)?)\s*(?P<lat_hem>[NnSs])
    \s+
    (?P<lon_num>-?\d+(?:\.\d+)?)\s*(?P<lon_hem>[EeWw])
    \s*$
    """,
    re.VERBOSE,
)

# Strict binomial: Genus species (letters/hyphens only, no subsp/sp/cf/aff/x/brackets)
BINOMIAL_RE = re.compile(r"^[A-Z][a-z-]+ [a-z-]+$")

TSV_COLUMNS = [
    "assembly_accession",
    "assembly_level",
    "assembly_submitter",
    "assembly_refseq_category",
    "species_taxid",
    "species_scientific_name",
    "biosample_lat",
    "biosample_lon",
    "biosample_collection_country",
    "is_species_name_binomial",
    "has_biosample_coordinates",
    "has_submitter",
]


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def is_missing(value: Optional[str]) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    if not text:
        return True
    return text.casefold() in MISSING_TOKENS


def sanitize_tsv_field(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    return re.sub(r"[\t\r\n]+", " ", text).strip()


def attr_map(biosample: dict[str, Any]) -> dict[str, str]:
    """Build case-insensitive attribute name -> value map from biosample."""
    out: dict[str, str] = {}
    for item in biosample.get("attributes") or []:
        name = item.get("name")
        value = item.get("value")
        if name is None or value is None:
            continue
        out[str(name).casefold()] = str(value)
    return out


def parse_lat_lon_combined(raw: str) -> tuple[Optional[float], Optional[float]]:
    text = raw.strip()
    match = LAT_LON_RE.match(text)
    if match:
        lat = float(match.group("lat_num"))
        lon = float(match.group("lon_num"))
        if match.group("lat_hem").upper() == "S":
            lat = -abs(lat)
        else:
            lat = abs(lat)
        if match.group("lon_hem").upper() == "W":
            lon = -abs(lon)
        else:
            lon = abs(lon)
        return lat, lon

    # Comma-separated decimals: "52.622282,1.2190789"
    if "," in text:
        comma_parts = [p.strip() for p in text.split(",")]
        if len(comma_parts) == 2:
            try:
                return float(comma_parts[0]), float(comma_parts[1])
            except ValueError:
                pass

    # Plain "lat lon" decimals without hemisphere letters
    parts = text.replace(",", " ").split()
    if len(parts) == 2:
        try:
            return float(parts[0]), float(parts[1])
        except ValueError:
            return None, None
    return None, None


def parse_decimal_coord(raw: Optional[str]) -> Optional[float]:
    if raw is None or is_missing(raw):
        return None
    text = raw.strip().rstrip("°")
    # Allow trailing N/S/E/W on ENA-style values
    hem = None
    if text and text[-1] in "NnSsEeWw":
        hem = text[-1].upper()
        text = text[:-1].strip()
    try:
        value = float(text)
    except ValueError:
        return None
    if hem in ("S", "W"):
        value = -abs(value)
    elif hem in ("N", "E"):
        value = abs(value)
    return value


def try_lat_lon_pair(
    attrs: dict[str, str],
    lat_keys: tuple[str, ...],
    lon_keys: tuple[str, ...],
) -> tuple[Optional[float], Optional[float]]:
    """Return (lat, lon) from the first present key in each list, or (None, None)."""
    lat_raw = None
    for key in lat_keys:
        if key in attrs and not is_missing(attrs[key]):
            lat_raw = attrs[key]
            break
    lon_raw = None
    for key in lon_keys:
        if key in attrs and not is_missing(attrs[key]):
            lon_raw = attrs[key]
            break
    if lat_raw is None or lon_raw is None:
        return None, None
    lat = parse_decimal_coord(lat_raw)
    lon = parse_decimal_coord(lon_raw)
    if lat is None or lon is None:
        return None, None
    return lat, lon


def extract_coordinates(
    biosample: dict[str, Any], attrs: dict[str, str]
) -> tuple[Optional[float], Optional[float]]:
    # Prefer collection-site fields, then transect start, then material/lab coords.
    # 1–2. GenBank / DDBJ combined lat_lon (+ aliases)
    for candidate in (
        biosample.get("lat_lon"),
        attrs.get("lat_lon"),
        attrs.get("lat_long"),
        attrs.get("latitude and lonitude"),
    ):
        if candidate is not None and not is_missing(str(candidate)):
            lat, lon = parse_lat_lon_combined(str(candidate))
            if lat is not None and lon is not None:
                return lat, lon

    # 3–8. Separate lat/lon attribute pairs (collection site first)
    for lat_keys, lon_keys in (
        (("geographic location (latitude)",), ("geographic location (longitude)",)),
        (("geographic_location_latitude",), ("geographic_location_longitude",)),
        (
            ("decimal_latitude", "decimallatitude"),
            ("decimal_longitude", "decimallongitude"),
        ),
        (("latitude",), ("longitude",)),
        (("north -lat",), ("east - lon",)),
        (
            ("original geographic location (latitude)",),
            ("original geographic location (longitude)",),
        ),
        # 9. Transect start (not end-only)
        (
            (
                "latitude_start",
                "latitude start",
                "geographic location start (latitude_start)",
            ),
            (
                "longitude_start",
                "longitude start",
                "geographic location start (longitude_start)",
            ),
        ),
        # 10. Herbarium / culture-collection style (last resort)
        (("biological material latitude",), ("biological material longitude",)),
        (("material source latitude",), ("material source longitude",)),
    ):
        lat, lon = try_lat_lon_pair(attrs, lat_keys, lon_keys)
        if lat is not None and lon is not None:
            return lat, lon

    return None, None


def extract_country(biosample: dict[str, Any], attrs: dict[str, str]) -> str:
    raw = attrs.get("geo_loc_name") or biosample.get("geo_loc_name")
    if raw is None or is_missing(str(raw)):
        return ""
    text = str(raw).strip()
    country = text.split(":", 1)[0].strip()
    return "" if is_missing(country) else country


def is_binomial(name: str) -> bool:
    if not name or is_missing(name):
        return False
    # Reject common non-binomial markers early
    lower = name.casefold()
    if any(
        token in lower
        for token in (
            " subsp.",
            " var.",
            " f.",
            " sp.",
            " cf.",
            " aff.",
            " x ",
            "[",
            "]",
            "(",
            ")",
        )
    ):
        return False
    if lower.endswith(" sp") or " nom." in lower:
        return False
    return bool(BINOMIAL_RE.match(name))


def format_coord(value: Optional[float]) -> str:
    if value is None:
        return ""
    # Trim trailing zeros but keep enough precision for mapping
    return f"{value:.8f}".rstrip("0").rstrip(".")


def bool_str(value: bool) -> str:
    return "true" if value else "false"


def datasets_base_cmd(api_key: Optional[str]) -> list[str]:
    cmd = ["datasets"]
    if api_key:
        cmd.extend(["--api-key", api_key])
    return cmd


def fetch_genome_reports(
    taxon: str,
    assembly_source: str,
    cache_file: Path,
    api_key: Optional[str],
    limit: Optional[str],
) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cmd = datasets_base_cmd(api_key) + [
        "summary",
        "genome",
        "taxon",
        taxon,
        "--assembly-source",
        assembly_source,
        "--as-json-lines",
    ]
    if limit:
        cmd.extend(["--limit", str(limit)])

    eprint(f"Fetching genome summaries: {' '.join(cmd)}")
    eprint(f"Writing cache to {cache_file}")

    with cache_file.open("w", encoding="utf-8") as out:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        assert proc.stderr is not None

        n = 0
        for line in proc.stdout:
            # Skip version-update banner lines that may leak to stdout
            if not line.startswith("{"):
                eprint(line.rstrip())
                continue
            out.write(line)
            n += 1
            if n % 5000 == 0:
                eprint(f"  ... {n} assemblies streamed")

        stderr = proc.stderr.read()
        rc = proc.wait()
        if stderr:
            for err_line in stderr.splitlines():
                if err_line.strip():
                    eprint(err_line)
        if rc != 0:
            raise RuntimeError(f"datasets genome summary failed with exit code {rc}")
        eprint(f"Fetched {n} genome report lines")


def iter_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                eprint(f"Skipping bad JSON on line {lineno}: {exc}")


def extract_rows(cache_file: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for rec in iter_jsonl(cache_file):
        ai = rec.get("assembly_info") or {}
        organism = rec.get("organism") or {}
        biosample = ai.get("biosample") or {}
        attrs = attr_map(biosample) if biosample else {}

        lat, lon = (None, None)
        country = ""
        if biosample:
            lat, lon = extract_coordinates(biosample, attrs)
            country = extract_country(biosample, attrs)

        submitter = ai.get("submitter") or ""
        submitter = str(submitter).strip()

        raw_tax_id = organism.get("tax_id")
        raw_name = organism.get("organism_name") or ""

        rows.append(
            {
                "assembly_accession": rec.get("accession") or "",
                "assembly_level": ai.get("assembly_level") or "",
                "assembly_submitter": submitter,
                "assembly_refseq_category": ai.get("refseq_category") or "",
                "raw_tax_id": raw_tax_id,
                "raw_organism_name": raw_name,
                "biosample_lat": lat,
                "biosample_lon": lon,
                "biosample_collection_country": country,
            }
        )
    eprint(f"Extracted {len(rows)} assembly rows from cache")
    return rows


def chunked(items: list[Any], size: int) -> Iterator[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def resolve_species_taxonomy(
    tax_ids: Iterable[Any],
    batch_size: int,
    api_key: Optional[str],
    max_retries: int = 3,
) -> dict[str, tuple[str, str]]:
    """Map raw tax_id -> (species_taxid, species_scientific_name)."""
    unique: list[str] = []
    seen: set[str] = set()
    for tid in tax_ids:
        if tid is None:
            continue
        key = str(tid)
        if key not in seen:
            seen.add(key)
            unique.append(key)

    eprint(f"Resolving species taxonomy for {len(unique)} unique tax IDs "
           f"(batch size {batch_size})")

    mapping: dict[str, tuple[str, str]] = {}
    batches = list(chunked(unique, batch_size))
    for bi, batch in enumerate(batches, 1):
        cmd = datasets_base_cmd(api_key) + [
            "summary",
            "taxonomy",
            "taxon",
            *batch,
            "--as-json-lines",
        ]
        last_err: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if proc.returncode != 0:
                    raise RuntimeError(
                        f"taxonomy exit {proc.returncode}: {proc.stderr.strip()[:500]}"
                    )
                for line in proc.stdout.splitlines():
                    if not line.startswith("{"):
                        continue
                    payload = json.loads(line)
                    taxonomy = payload.get("taxonomy") or {}
                    query = payload.get("query") or []
                    raw_id = str(query[0]) if query else str(taxonomy.get("tax_id", ""))
                    classification = taxonomy.get("classification") or {}
                    species = classification.get("species") or {}
                    if species.get("id") is not None and species.get("name"):
                        mapping[raw_id] = (str(species["id"]), str(species["name"]))
                    else:
                        # No species parent: leave unset so caller falls back
                        mapping.setdefault(raw_id, ("", ""))
                eprint(f"  taxonomy batch {bi}/{len(batches)} ok "
                       f"({len(batch)} ids, attempt {attempt})")
                last_err = None
                break
            except Exception as exc:  # noqa: BLE001 - retry any failure
                last_err = exc
                wait = 2 ** attempt
                eprint(f"  taxonomy batch {bi} attempt {attempt} failed: {exc}; "
                       f"retry in {wait}s")
                time.sleep(wait)
        if last_err is not None:
            eprint(f"  WARNING: taxonomy batch {bi} failed permanently; "
                   f"falling back to assembly organism for those IDs")
            for tid in batch:
                mapping.setdefault(tid, ("", ""))

    return mapping


def assemble_tsv_rows(
    rows: list[dict[str, Any]],
    species_map: dict[str, tuple[str, str]],
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in rows:
        raw_tid = row["raw_tax_id"]
        raw_key = str(raw_tid) if raw_tid is not None else ""
        sp_tid, sp_name = species_map.get(raw_key, ("", ""))
        if not sp_tid:
            sp_tid = raw_key
        if not sp_name:
            sp_name = row["raw_organism_name"] or ""

        lat = row["biosample_lat"]
        lon = row["biosample_lon"]
        has_coords = lat is not None and lon is not None
        submitter = row["assembly_submitter"] or ""
        has_submitter = bool(submitter)

        out.append(
            {
                "assembly_accession": sanitize_tsv_field(row["assembly_accession"]),
                "assembly_level": sanitize_tsv_field(row["assembly_level"]),
                "assembly_submitter": sanitize_tsv_field(submitter),
                "assembly_refseq_category": sanitize_tsv_field(
                    row["assembly_refseq_category"]
                ),
                "species_taxid": sanitize_tsv_field(sp_tid),
                "species_scientific_name": sanitize_tsv_field(sp_name),
                "biosample_lat": format_coord(lat),
                "biosample_lon": format_coord(lon),
                "biosample_collection_country": sanitize_tsv_field(
                    row["biosample_collection_country"]
                ),
                "is_species_name_binomial": bool_str(is_binomial(sp_name)),
                "has_biosample_coordinates": bool_str(has_coords),
                "has_submitter": bool_str(has_submitter),
            }
        )
    return out


def load_species_by_accession(path: Path) -> dict[str, tuple[str, str]]:
    """Load assembly_accession -> (species_taxid, species_scientific_name) from a TSV."""
    out: dict[str, tuple[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            acc = (row.get("assembly_accession") or "").strip()
            if not acc:
                continue
            tid = (row.get("species_taxid") or "").strip()
            name = (row.get("species_scientific_name") or "").strip()
            if tid or name:
                out[acc] = (tid, name)
    return out


def species_map_from_existing(
    rows: list[dict[str, Any]],
    existing_by_acc: dict[str, tuple[str, str]],
) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Build tax_id -> species map from prior TSV; return unresolved tax ids."""
    species_map: dict[str, tuple[str, str]] = {}
    need_resolve: list[str] = []
    seen_need: set[str] = set()
    for row in rows:
        raw_tid = row.get("raw_tax_id")
        if raw_tid is None:
            continue
        raw_key = str(raw_tid)
        if raw_key in species_map:
            continue
        acc = row.get("assembly_accession") or ""
        if acc in existing_by_acc:
            species_map[raw_key] = existing_by_acc[acc]
        elif raw_key not in seen_need:
            seen_need.add(raw_key)
            need_resolve.append(raw_key)
    return species_map, need_resolve


def write_tsv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=TSV_COLUMNS,
            delimiter="\t",
            lineterminator="\n",
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rows)
    eprint(f"Wrote {len(rows)} rows to {path}")


def print_summary(rows: list[dict[str, str]]) -> None:
    n = len(rows)
    if n == 0:
        eprint("Summary: 0 rows")
        return
    with_coords = sum(1 for r in rows if r["has_biosample_coordinates"] == "true")
    with_submitter = sum(1 for r in rows if r["has_submitter"] == "true")
    binomial = sum(1 for r in rows if r["is_species_name_binomial"] == "true")
    levels = Counter(r["assembly_level"] or "(blank)" for r in rows)

    eprint("")
    eprint("=== Summary ===")
    eprint(f"Total assemblies:           {n}")
    eprint(f"With biosample coordinates: {with_coords} ({100 * with_coords / n:.1f}%)")
    eprint(f"With submitter:             {with_submitter} ({100 * with_submitter / n:.1f}%)")
    eprint(f"Binomial species names:     {binomial} ({100 * binomial / n:.1f}%)")
    eprint("Assembly levels:")
    for level, count in levels.most_common():
        eprint(f"  {level}: {count}")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    default_cache = repo_root / "data" / "raw" / "eukaryote_genome_reports.jsonl"
    default_output = repo_root / "data" / "eukaryote_assemblies.tsv"

    p = argparse.ArgumentParser(
        description="Collect NCBI eukaryote assemblies into a TSV dataset."
    )
    p.add_argument("--taxon", default="Eukaryota", help="NCBI taxon name or taxid")
    p.add_argument(
        "--assembly-source",
        default="GenBank",
        choices=["GenBank", "RefSeq", "all"],
        help="Assembly source filter (default: GenBank)",
    )
    p.add_argument(
        "--limit",
        default=None,
        help="Pass-through to datasets --limit (e.g. 5 or all)",
    )
    p.add_argument(
        "--cache-file",
        type=Path,
        default=default_cache,
        help="Path for raw JSONL genome reports cache",
    )
    p.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Reuse existing --cache-file instead of calling datasets",
    )
    p.add_argument(
        "--taxonomy-batch-size",
        type=int,
        default=300,
        help="Tax IDs per datasets taxonomy call",
    )
    p.add_argument(
        "--skip-taxonomy",
        action="store_true",
        help=(
            "Do not call datasets taxonomy; use each assembly's organism.tax_id "
            "and organism_name as species_taxid / species_scientific_name"
        ),
    )
    p.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help="Output TSV path",
    )
    p.add_argument(
        "--api-key",
        default=os.environ.get("NCBI_API_KEY"),
        help="NCBI API key (or set NCBI_API_KEY)",
    )
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)

    if args.skip_fetch:
        if not args.cache_file.exists():
            eprint(f"--skip-fetch set but cache missing: {args.cache_file}")
            return 1
        eprint(f"Skipping fetch; using cache {args.cache_file}")
    else:
        fetch_genome_reports(
            taxon=args.taxon,
            assembly_source=args.assembly_source,
            cache_file=args.cache_file,
            api_key=args.api_key,
            limit=args.limit,
        )

    rows = extract_rows(args.cache_file)
    if not rows:
        eprint("No assemblies found; writing empty TSV with header only")
        write_tsv(args.output, [])
        print_summary([])
        return 0

    if args.skip_taxonomy:
        eprint(
            "Skipping species taxonomy resolution; using assembly organism "
            "tax_id/name as species columns"
        )
        species_map: dict[str, tuple[str, str]] = {}
    else:
        existing_by_acc: dict[str, tuple[str, str]] = {}
        if args.output.exists():
            existing_by_acc = load_species_by_accession(args.output)
            eprint(
                f"Loaded species columns for {len(existing_by_acc)} accessions "
                f"from {args.output}"
            )
        species_map, need_resolve = species_map_from_existing(rows, existing_by_acc)
        if existing_by_acc:
            eprint(
                f"Reused species taxonomy for {len(species_map)} tax IDs from existing TSV"
            )
        if need_resolve:
            eprint(
                f"Resolving {len(need_resolve)} tax IDs not found in existing TSV"
            )
            fetched = resolve_species_taxonomy(
                need_resolve,
                batch_size=args.taxonomy_batch_size,
                api_key=args.api_key,
            )
            species_map.update(fetched)
        elif not existing_by_acc:
            species_map = resolve_species_taxonomy(
                (r["raw_tax_id"] for r in rows),
                batch_size=args.taxonomy_batch_size,
                api_key=args.api_key,
            )
    tsv_rows = assemble_tsv_rows(rows, species_map)
    write_tsv(args.output, tsv_rows)
    print_summary(tsv_rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
