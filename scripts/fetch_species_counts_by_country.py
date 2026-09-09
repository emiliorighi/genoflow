#!/usr/bin/env python3
"""Fetch per-country Eukaryote species counts from GBIF and iNaturalist.

Reads countries from assemblage/public/data/world-110m.geojson (NAME + ISO_A3),
maps ISO3→ISO2 via GBIF's country enumeration, then for each country:

  - GBIF: distinct speciesKey count via occurrence facets, filtered to
    Eukaryote kingdomKeys (Animalia, Chromista, Fungi, Plantae, Protozoa).
  - iNaturalist: research-grade wild species counts via species_counts,
    filtered to the 12 Eukaryote iconic_taxa (excludes Bacteria/Archaea/
    Viruses and unidentified "unknown").

Writes data/species_counts_by_country.tsv with country_name, iso3, iso2,
gbif_species_count, inat_species_count.

Limitations:
  - Counts are "species with ≥1 qualifying record," not true richness.
  - iNaturalist coverage is geographically biased; GBIF already includes
    iNaturalist research-grade data, so gbif ≥ inat is expected (not additive).
  - No fossil/cultivated/introduced filtering beyond the Eukaryote filters.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_GEOJSON = REPO_ROOT / "assemblage" / "public" / "data" / "world-110m.geojson"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "species_counts_by_country.tsv"
DEFAULT_CACHE_DIR = REPO_ROOT / "data" / ".cache" / "species_counts"
DEFAULT_ENUM_CACHE = REPO_ROOT / "data" / ".cache" / "gbif_country_enum.json"
DEFAULT_PLACE_OVERRIDES = REPO_ROOT / "data" / "inat_place_overrides.json"

USER_AGENT = "genoflow-fetch-species-counts-by-country/1.0"

# GBIF backbone kingdomKeys for Eukaryota (excludes Archaea=2, Bacteria=3,
# Viruses=8, incertae sedis=0).
GBIF_EUKARYOTE_KINGDOM_KEYS = (1, 4, 5, 6, 7)

# iNaturalist iconic_taxa covering Eukaryotes (excludes "unknown").
# Plantae is required for Eukaryota even though some early drafts omitted it.
INAT_EUKARYOTE_ICONIC_TAXA = (
    "Plantae",
    "Animalia",
    "Mollusca",
    "Reptilia",
    "Aves",
    "Amphibia",
    "Actinopterygii",
    "Mammalia",
    "Insecta",
    "Arachnida",
    "Fungi",
    "Protozoa",
    "Chromista",
)

GBIF_FACET_LIMIT = 250_000

# Natural Earth short names → iNaturalist autocomplete queries that resolve to
# admin_level=0 country places.
PLACE_NAME_ALIASES: dict[str, tuple[str, ...]] = {
    "United States of America": ("United States",),
    "Turkey": ("Türkiye",),
    "Bosnia and Herz.": ("Bosnia and Herzegovina", "Bosnia"),
    "Dominican Rep.": ("Dominican Republic",),
    "Dem. Rep. Congo": ("Democratic Republic of the Congo",),
    "W. Sahara": ("Western Sahara",),
    "S. Sudan": ("South Sudan",),
    "Central African Rep.": ("Central African Republic",),
    "Eq. Guinea": ("Equatorial Guinea",),
    "Timor-Leste": ("East Timor", "Timor-Leste"),
    "Fr. S. Antarctic Lands": (
        "French Southern Territories",
        "French Southern and Antarctic Lands",
    ),
}

TSV_COLUMNS = [
    "country_name",
    "iso3",
    "iso2",
    "gbif_species_count",
    "inat_species_count",
]


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


# ---------------------------------------------------------------------------
# HTTP + cache helpers
# ---------------------------------------------------------------------------


class HttpClient:
    def __init__(self, sleep_s: float, timeout: float, retries: int) -> None:
        self.sleep_s = sleep_s
        self.timeout = timeout
        self.retries = retries
        self._last_request = 0.0

    def _pace(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.sleep_s:
            time.sleep(self.sleep_s - elapsed)

    def get_json(self, url: str) -> Any:
        headers = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        last_err: Optional[Exception] = None
        for attempt in range(1, self.retries + 1):
            self._pace()
            req = urllib.request.Request(url, headers=headers)
            try:
                self._last_request = time.monotonic()
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.load(resp)
            except urllib.error.HTTPError as exc:
                last_err = exc
                body = ""
                try:
                    body = exc.read().decode("utf-8", errors="replace")[:300]
                except Exception:  # noqa: BLE001
                    pass
                if exc.code == 429:
                    retry_after = exc.headers.get("Retry-After")
                    wait = (
                        int(retry_after)
                        if retry_after and retry_after.isdigit()
                        else 60
                    )
                    eprint(f"Rate limited (429); sleeping {wait}s")
                    time.sleep(wait)
                    continue
                if 500 <= exc.code < 600 and attempt < self.retries:
                    wait = 2**attempt
                    eprint(f"HTTP {exc.code}; retry in {wait}s ({body})")
                    time.sleep(wait)
                    continue
                raise RuntimeError(f"HTTP {exc.code} for {url}: {body}") from exc
            except urllib.error.URLError as exc:
                last_err = exc
                if attempt < self.retries:
                    wait = 2**attempt
                    eprint(f"Network error: {exc}; retry in {wait}s")
                    time.sleep(wait)
                    continue
                raise
        raise RuntimeError(f"Request failed after retries: {last_err}")


def load_jsonl_cache(path: Path, key_field: str) -> dict[str, dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return cache
    with path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as exc:
                eprint(f"Skipping bad cache line {lineno} in {path}: {exc}")
                continue
            key = rec.get(key_field)
            if key:
                cache[str(key)] = rec
    eprint(f"Loaded {len(cache)} cached entries from {path}")
    return cache


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Country list + ISO mapping
# ---------------------------------------------------------------------------


def load_countries(geojson_path: Path) -> list[dict[str, str]]:
    with geojson_path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    countries: list[dict[str, str]] = []
    for feat in data.get("features") or []:
        props = feat.get("properties") or {}
        name = str(props.get("NAME") or "").strip()
        iso3 = str(props.get("ISO_A3") or "").strip().upper()
        if not name or not iso3 or iso3 in ("-99", "NULL", "N/A"):
            eprint(f"Skipping feature with invalid NAME/ISO_A3: {props!r}")
            continue
        countries.append({"country_name": name, "iso3": iso3})
    # Deduplicate by iso3 (keep first NAME)
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for c in countries:
        if c["iso3"] in seen:
            eprint(f"Duplicate ISO_A3 {c['iso3']} ({c['country_name']}); keeping first")
            continue
        seen.add(c["iso3"])
        unique.append(c)
    return unique


def load_iso3_to_iso2(
    client: HttpClient, enum_cache_path: Path
) -> dict[str, str]:
    if enum_cache_path.exists():
        with enum_cache_path.open(encoding="utf-8") as fh:
            enum = json.load(fh)
        eprint(f"Loaded GBIF country enum cache ({len(enum)} entries)")
    else:
        eprint("Fetching GBIF country enumeration…")
        enum = client.get_json("https://api.gbif.org/v1/enumeration/country")
        enum_cache_path.parent.mkdir(parents=True, exist_ok=True)
        with enum_cache_path.open("w", encoding="utf-8") as fh:
            json.dump(enum, fh, ensure_ascii=False, indent=2)
        eprint(f"Cached GBIF country enum → {enum_cache_path}")

    mapping: dict[str, str] = {}
    for entry in enum:
        iso3 = str(entry.get("iso3") or "").strip().upper()
        iso2 = str(entry.get("iso2") or "").strip().upper()
        if iso3 and iso2:
            mapping[iso3] = iso2
    return mapping


def load_place_overrides(path: Optional[Path]) -> dict[str, int]:
    if path is None:
        return {}
    with path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    out: dict[str, int] = {}
    for key, value in raw.items():
        out[str(key).strip().upper()] = int(value)
    eprint(f"Loaded {len(out)} place overrides from {path}")
    return out


# ---------------------------------------------------------------------------
# GBIF
# ---------------------------------------------------------------------------


def fetch_gbif_species_count(client: HttpClient, iso2: str) -> int:
    """Count distinct Eukaryote speciesKey values for a country.

    Queries each Eukaryote kingdom separately and sums the facet sizes.
    Species cannot belong to more than one kingdom, so the sum is exact and
    avoids facetLimit truncation on megadiverse countries (e.g. USA).
    """
    total = 0
    for kingdom_key in GBIF_EUKARYOTE_KINGDOM_KEYS:
        params: list[tuple[str, str]] = [
            ("country", iso2),
            ("kingdomKey", str(kingdom_key)),
            ("facet", "speciesKey"),
            ("facetLimit", str(GBIF_FACET_LIMIT)),
            ("limit", "0"),
        ]
        url = "https://api.gbif.org/v1/occurrence/search?" + urllib.parse.urlencode(
            params
        )
        payload = client.get_json(url)
        facets = payload.get("facets") or []
        counts: list[Any] = []
        for facet in facets:
            if str(facet.get("field") or "").upper() in ("SPECIES_KEY", "SPECIESKEY"):
                counts = facet.get("counts") or []
                break
        if not counts and facets:
            counts = facets[0].get("counts") or []
        n = len(counts)
        if n >= GBIF_FACET_LIMIT:
            eprint(
                f"WARNING: GBIF facet for {iso2} kingdomKey={kingdom_key} "
                f"returned {n} species (== facetLimit {GBIF_FACET_LIMIT}); "
                "count may be truncated"
            )
        total += n
    return total


def resolve_gbif_counts(
    countries: list[dict[str, str]],
    iso3_to_iso2: dict[str, str],
    client: HttpClient,
    cache_path: Path,
) -> dict[str, Optional[int]]:
    cache = load_jsonl_cache(cache_path, "iso3")
    results: dict[str, Optional[int]] = {}
    for i, country in enumerate(countries, 1):
        iso3 = country["iso3"]
        name = country["country_name"]
        if iso3 in cache and "count" in cache[iso3]:
            results[iso3] = cache[iso3]["count"]
            continue
        iso2 = iso3_to_iso2.get(iso3)
        if not iso2:
            eprint(f"[{i}/{len(countries)}] GBIF skip {name} ({iso3}): no ISO2")
            results[iso3] = None
            continue
        eprint(f"[{i}/{len(countries)}] GBIF {name} ({iso3}/{iso2})…")
        try:
            count = fetch_gbif_species_count(client, iso2)
        except Exception as exc:  # noqa: BLE001
            eprint(f"  ERROR fetching GBIF for {iso3}: {exc}")
            results[iso3] = None
            continue
        rec = {"iso3": iso3, "iso2": iso2, "count": count}
        append_jsonl(cache_path, rec)
        cache[iso3] = rec
        results[iso3] = count
        eprint(f"  → {count} species")
    return results


# ---------------------------------------------------------------------------
# iNaturalist
# ---------------------------------------------------------------------------


def resolve_inat_place_id(
    client: HttpClient, country_name: str
) -> Optional[int]:
    queries = (country_name,) + PLACE_NAME_ALIASES.get(country_name, ())
    seen: set[str] = set()
    for query in queries:
        if query in seen:
            continue
        seen.add(query)
        url = (
            "https://api.inaturalist.org/v1/places/autocomplete?"
            + urllib.parse.urlencode({"q": query})
        )
        payload = client.get_json(url)
        for place in payload.get("results") or []:
            if place.get("admin_level") == 0:
                return int(place["id"])
    return None


def resolve_inat_places(
    countries: list[dict[str, str]],
    client: HttpClient,
    cache_path: Path,
    overrides: dict[str, int],
) -> dict[str, Optional[int]]:
    cache = load_jsonl_cache(cache_path, "iso3")
    results: dict[str, Optional[int]] = {}
    for i, country in enumerate(countries, 1):
        iso3 = country["iso3"]
        name = country["country_name"]
        if iso3 in overrides:
            place_id = overrides[iso3]
            eprint(
                f"[{i}/{len(countries)}] iNat place override {name} ({iso3}) → {place_id}"
            )
            results[iso3] = place_id
            if iso3 not in cache or cache[iso3].get("place_id") != place_id:
                rec = {
                    "iso3": iso3,
                    "country_name": name,
                    "place_id": place_id,
                    "source": "override",
                }
                append_jsonl(cache_path, rec)
                cache[iso3] = rec
            continue
        if iso3 in cache and cache[iso3].get("place_id") is not None:
            results[iso3] = int(cache[iso3]["place_id"])
            continue
        if iso3 in cache and cache[iso3].get("place_id") is None:
            # Previously unresolved; skip unless override provided
            results[iso3] = None
            continue
        eprint(f"[{i}/{len(countries)}] iNat place {name} ({iso3})…")
        try:
            place_id = resolve_inat_place_id(client, name)
        except Exception as exc:  # noqa: BLE001
            eprint(f"  ERROR resolving place for {iso3}: {exc}")
            place_id = None
        rec = {
            "iso3": iso3,
            "country_name": name,
            "place_id": place_id,
            "source": "autocomplete",
        }
        append_jsonl(cache_path, rec)
        cache[iso3] = rec
        results[iso3] = place_id
        if place_id is None:
            eprint(f"  WARNING: no admin_level=0 place for {name!r}")
        else:
            eprint(f"  → place_id={place_id}")
    return results


def fetch_inat_species_count(client: HttpClient, place_id: int) -> int:
    params: list[tuple[str, str]] = [
        ("place_id", str(place_id)),
        ("quality_grade", "research"),
        ("captive", "false"),
        ("hrank", "species"),
        ("lrank", "species"),
        ("per_page", "0"),
    ]
    for taxon in INAT_EUKARYOTE_ICONIC_TAXA:
        params.append(("iconic_taxa[]", taxon))
    url = (
        "https://api.inaturalist.org/v1/observations/species_counts?"
        + urllib.parse.urlencode(params)
    )
    payload = client.get_json(url)
    return int(payload.get("total_results") or 0)


def resolve_inat_counts(
    countries: list[dict[str, str]],
    place_ids: dict[str, Optional[int]],
    client: HttpClient,
    cache_path: Path,
) -> dict[str, Optional[int]]:
    cache = load_jsonl_cache(cache_path, "iso3")
    results: dict[str, Optional[int]] = {}
    for i, country in enumerate(countries, 1):
        iso3 = country["iso3"]
        name = country["country_name"]
        if iso3 in cache and "count" in cache[iso3]:
            results[iso3] = cache[iso3]["count"]
            continue
        place_id = place_ids.get(iso3)
        if place_id is None:
            eprint(f"[{i}/{len(countries)}] iNat count skip {name} ({iso3}): no place")
            results[iso3] = None
            continue
        eprint(f"[{i}/{len(countries)}] iNat count {name} ({iso3}, place={place_id})…")
        try:
            count = fetch_inat_species_count(client, place_id)
        except Exception as exc:  # noqa: BLE001
            eprint(f"  ERROR fetching iNat for {iso3}: {exc}")
            results[iso3] = None
            continue
        rec = {"iso3": iso3, "place_id": place_id, "count": count}
        append_jsonl(cache_path, rec)
        cache[iso3] = rec
        results[iso3] = count
        eprint(f"  → {count} species")
    return results


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def write_tsv(
    path: Path,
    countries: list[dict[str, str]],
    iso3_to_iso2: dict[str, str],
    gbif_counts: dict[str, Optional[int]],
    inat_counts: dict[str, Optional[int]],
) -> None:
    rows: list[dict[str, str]] = []
    for country in sorted(countries, key=lambda c: c["country_name"].lower()):
        iso3 = country["iso3"]
        gbif = gbif_counts.get(iso3)
        inat = inat_counts.get(iso3)
        rows.append(
            {
                "country_name": country["country_name"],
                "iso3": iso3,
                "iso2": iso3_to_iso2.get(iso3, ""),
                "gbif_species_count": "" if gbif is None else str(gbif),
                "inat_species_count": "" if inat is None else str(inat),
            }
        )
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


def print_summary(
    countries: list[dict[str, str]],
    iso3_to_iso2: dict[str, str],
    gbif_counts: dict[str, Optional[int]],
    inat_counts: dict[str, Optional[int]],
) -> None:
    n = len(countries)
    with_iso2 = sum(1 for c in countries if c["iso3"] in iso3_to_iso2)
    with_gbif = sum(1 for c in countries if gbif_counts.get(c["iso3"]) is not None)
    with_inat = sum(1 for c in countries if inat_counts.get(c["iso3"]) is not None)
    eprint("")
    eprint("=== Summary ===")
    eprint(f"Countries:              {n}")
    eprint(f"With ISO2 mapping:      {with_iso2}")
    eprint(f"With GBIF count:        {with_gbif}")
    eprint(f"With iNaturalist count: {with_inat}")

    missing_iso2 = [
        c for c in countries if c["iso3"] not in iso3_to_iso2
    ]
    missing_gbif = [
        c for c in countries if gbif_counts.get(c["iso3"]) is None
    ]
    missing_inat = [
        c for c in countries if inat_counts.get(c["iso3"]) is None
    ]
    if missing_iso2:
        eprint("Missing ISO2:")
        for c in missing_iso2:
            eprint(f"  {c['iso3']}  {c['country_name']}")
    if missing_gbif:
        eprint("Missing GBIF count:")
        for c in missing_gbif:
            eprint(f"  {c['iso3']}  {c['country_name']}")
    if missing_inat:
        eprint("Missing iNaturalist count:")
        for c in missing_inat:
            eprint(f"  {c['iso3']}  {c['country_name']}")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--geojson",
        type=Path,
        default=DEFAULT_GEOJSON,
        help="world-110m.geojson path",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="output TSV path",
    )
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR,
        help="directory for JSONL response caches",
    )
    p.add_argument(
        "--enum-cache",
        type=Path,
        default=DEFAULT_ENUM_CACHE,
        help="GBIF country enumeration JSON cache path",
    )
    p.add_argument(
        "--place-overrides",
        type=Path,
        default=DEFAULT_PLACE_OVERRIDES,
        help=(
            'JSON map of ISO_A3 → iNaturalist place_id, e.g. {"CIV": 12345}. '
            f"Default: {DEFAULT_PLACE_OVERRIDES} (skipped if missing)"
        ),
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=1.0,
        help="seconds between API requests (default 1.0)",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="HTTP timeout seconds (default 120)",
    )
    p.add_argument(
        "--retries",
        type=int,
        default=3,
        help="HTTP retry attempts (default 3)",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="process only first N countries (for testing)",
    )
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if not args.geojson.exists():
        eprint(f"GeoJSON not found: {args.geojson}")
        return 1

    countries = load_countries(args.geojson)
    eprint(f"Loaded {len(countries)} countries from {args.geojson}")
    if args.limit is not None:
        countries = countries[: args.limit]
        eprint(f"Limiting to first {len(countries)} countries")

    cache_dir: Path = args.cache_dir
    cache_dir.mkdir(parents=True, exist_ok=True)

    client = HttpClient(
        sleep_s=args.sleep, timeout=args.timeout, retries=args.retries
    )
    iso3_to_iso2 = load_iso3_to_iso2(client, args.enum_cache)
    overrides_path = args.place_overrides
    if overrides_path is not None and not overrides_path.exists():
        if overrides_path == DEFAULT_PLACE_OVERRIDES:
            eprint(f"No place overrides at {overrides_path} (ok)")
            overrides_path = None
        else:
            eprint(f"Place overrides not found: {overrides_path}")
            return 1
    overrides = load_place_overrides(overrides_path)

    gbif_counts = resolve_gbif_counts(
        countries,
        iso3_to_iso2,
        client,
        cache_dir / "gbif_counts.jsonl",
    )
    place_ids = resolve_inat_places(
        countries,
        client,
        cache_dir / "inat_places.jsonl",
        overrides,
    )
    inat_counts = resolve_inat_counts(
        countries,
        place_ids,
        client,
        cache_dir / "inat_counts.jsonl",
    )

    write_tsv(args.output, countries, iso3_to_iso2, gbif_counts, inat_counts)
    print_summary(countries, iso3_to_iso2, gbif_counts, inat_counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
