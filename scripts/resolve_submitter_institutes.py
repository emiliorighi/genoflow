#!/usr/bin/env python3
"""Resolve NCBI assembly submitter names to ROR institute country/coordinates.

Reads unique assembly_submitter values from eukaryote_assemblies.tsv and matches
each via the ROR affiliation API (chosen:true only), with a quoted query exact-
name/acronym fallback. Writes a TSV suitable for joining back to assemblies.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any, Optional

ROR_BASE = "https://api.ror.org/v2/organizations"
USER_AGENT = "genoflow-resolve-submitter-institutes/1.0"

TSV_COLUMNS = [
    "submitter_name",
    "institute_name_ror",
    "ror_id",
    "country",
    "lat",
    "lon",
    "has_ror_match",
    "has_coordinates",
    "match_method",
    "assembly_count",
]


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def bool_str(value: bool) -> str:
    return "true" if value else "false"


def format_coord(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return ""
    return f"{num:.8f}".rstrip("0").rstrip(".")


def sanitize_tsv_field(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\t", " ").replace("\r", " ").split())


def normalize_submitter(name: str) -> str:
    return name.strip()


def strip_outer_quotes(name: str) -> str:
    text = name.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1].strip()
    return text


def load_submitter_counts(path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        if "assembly_submitter" not in (reader.fieldnames or []):
            raise SystemExit(
                f"Input {path} missing assembly_submitter column; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            name = normalize_submitter(row.get("assembly_submitter") or "")
            if name:
                counts[name] += 1
    return counts


def load_cache(path: Path) -> dict[str, dict[str, Any]]:
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
                eprint(f"Skipping bad cache line {lineno}: {exc}")
                continue
            key = rec.get("submitter_name")
            if key:
                cache[str(key)] = rec
    eprint(f"Loaded {len(cache)} cached ROR lookups from {path}")
    return cache


def append_cache(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


class RorClient:
    def __init__(self, client_id: str, sleep_s: float) -> None:
        self.client_id = client_id
        self.sleep_s = sleep_s
        self._last_request = 0.0

    def _pace(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.sleep_s:
            time.sleep(self.sleep_s - elapsed)

    def get_json(self, url: str, max_retries: int = 3) -> dict[str, Any]:
        headers = {
            "Client-Id": self.client_id,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        last_err: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            self._pace()
            req = urllib.request.Request(url, headers=headers)
            try:
                self._last_request = time.monotonic()
                with urllib.request.urlopen(req, timeout=60) as resp:
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
                    wait = int(retry_after) if retry_after and retry_after.isdigit() else 60
                    eprint(f"Rate limited (429); sleeping {wait}s")
                    time.sleep(wait)
                    continue
                if 500 <= exc.code < 600 and attempt < max_retries:
                    wait = 2**attempt
                    eprint(f"HTTP {exc.code}; retry in {wait}s ({body})")
                    time.sleep(wait)
                    continue
                raise RuntimeError(f"ROR HTTP {exc.code} for {url}: {body}") from exc
            except urllib.error.URLError as exc:
                last_err = exc
                if attempt < max_retries:
                    wait = 2**attempt
                    eprint(f"Network error: {exc}; retry in {wait}s")
                    time.sleep(wait)
                    continue
                raise
        raise RuntimeError(f"ROR request failed after retries: {last_err}")


def ror_display_name(org: dict[str, Any]) -> str:
    names = org.get("names") or []
    for entry in names:
        types = entry.get("types") or []
        if "ror_display" in types:
            return str(entry.get("value") or "")
    if names:
        return str(names[0].get("value") or "")
    return ""


def extract_geo(org: dict[str, Any]) -> tuple[str, Optional[float], Optional[float]]:
    locations = org.get("locations") or []
    if not locations:
        return "", None, None
    details = locations[0].get("geonames_details") or {}
    country = str(details.get("country_name") or "")
    lat = details.get("lat")
    lon = details.get("lng")
    try:
        lat_f = float(lat) if lat is not None else None
    except (TypeError, ValueError):
        lat_f = None
    try:
        lon_f = float(lon) if lon is not None else None
    except (TypeError, ValueError):
        lon_f = None
    return country, lat_f, lon_f


def org_name_values(
    org: dict[str, Any], wanted_types: tuple[str, ...]
) -> list[str]:
    values: list[str] = []
    for entry in org.get("names") or []:
        types = entry.get("types") or []
        if any(t in types for t in wanted_types):
            value = str(entry.get("value") or "").strip()
            if value:
                values.append(value)
    return values


def match_from_affiliation(payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    for item in payload.get("items") or []:
        if item.get("chosen") is True:
            org = item.get("organization")
            if isinstance(org, dict):
                return org
    return None


def match_from_query_exact(
    payload: dict[str, Any], submitter: str
) -> Optional[dict[str, Any]]:
    """Accept only unambiguous exact ror_display or acronym matches.

    Acronym collisions (e.g. BGI) are rejected when more than one result shares
    the same acronym; display-name equality is preferred when unique.
    """
    target = strip_outer_quotes(submitter).casefold()
    if not target:
        return None

    items = [i for i in (payload.get("items") or []) if isinstance(i, dict)]

    display_hits = [
        org
        for org in items
        if any(v.casefold() == target for v in org_name_values(org, ("ror_display",)))
    ]
    if len(display_hits) == 1:
        return display_hits[0]
    if len(display_hits) > 1:
        return None

    acronym_hits = [
        org
        for org in items
        if any(v.casefold() == target for v in org_name_values(org, ("acronym",)))
    ]
    if len(acronym_hits) == 1:
        return acronym_hits[0]
    return None


def resolve_submitter(
    client: RorClient,
    submitter: str,
    cache: dict[str, dict[str, Any]],
    cache_file: Path,
    skip_fetch: bool,
) -> dict[str, Any]:
    if submitter in cache:
        return cache[submitter]

    if skip_fetch:
        record = {
            "submitter_name": submitter,
            "match_method": "none",
            "ror_id": "",
            "institute_name_ror": "",
            "country": "",
            "lat": None,
            "lon": None,
            "affiliation_response": None,
            "query_response": None,
            "skipped_no_fetch": True,
        }
        cache[submitter] = record
        return record

    aff_url = f"{ROR_BASE}?affiliation={urllib.parse.quote(submitter)}"
    aff_payload = client.get_json(aff_url)
    org = match_from_affiliation(aff_payload)
    method = "affiliation_chosen"
    query_payload: Optional[dict[str, Any]] = None

    if org is None:
        quoted = f'"{strip_outer_quotes(submitter)}"'
        query_url = f"{ROR_BASE}?query={urllib.parse.quote(quoted)}"
        query_payload = client.get_json(query_url)
        org = match_from_query_exact(query_payload, submitter)
        method = "query_exact" if org is not None else "none"

    if org is None:
        record = {
            "submitter_name": submitter,
            "match_method": "none",
            "ror_id": "",
            "institute_name_ror": "",
            "country": "",
            "lat": None,
            "lon": None,
            "affiliation_response": {
                "number_of_results": aff_payload.get("number_of_results"),
                "chosen_count": sum(
                    1 for i in (aff_payload.get("items") or []) if i.get("chosen")
                ),
            },
            "query_response": {
                "number_of_results": (query_payload or {}).get("number_of_results")
            }
            if query_payload is not None
            else None,
        }
    else:
        country, lat, lon = extract_geo(org)
        record = {
            "submitter_name": submitter,
            "match_method": method,
            "ror_id": str(org.get("id") or ""),
            "institute_name_ror": ror_display_name(org),
            "country": country,
            "lat": lat,
            "lon": lon,
            "affiliation_response": {
                "number_of_results": aff_payload.get("number_of_results"),
            },
            "query_response": {
                "number_of_results": (query_payload or {}).get("number_of_results")
            }
            if query_payload is not None
            else None,
        }

    cache[submitter] = record
    append_cache(cache_file, record)
    return record


def record_to_row(record: dict[str, Any], assembly_count: int) -> dict[str, str]:
    lat = record.get("lat")
    lon = record.get("lon")
    has_match = record.get("match_method") not in (None, "none", "")
    has_coords = lat is not None and lon is not None
    return {
        "submitter_name": sanitize_tsv_field(record.get("submitter_name")),
        "institute_name_ror": sanitize_tsv_field(record.get("institute_name_ror")),
        "ror_id": sanitize_tsv_field(record.get("ror_id")),
        "country": sanitize_tsv_field(record.get("country")),
        "lat": format_coord(lat),
        "lon": format_coord(lon),
        "has_ror_match": bool_str(bool(has_match)),
        "has_coordinates": bool_str(has_coords),
        "match_method": sanitize_tsv_field(record.get("match_method") or "none"),
        "assembly_count": str(assembly_count),
    }


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
    matched = sum(1 for r in rows if r["has_ror_match"] == "true")
    with_coords = sum(1 for r in rows if r["has_coordinates"] == "true")
    methods = Counter(r["match_method"] for r in rows)
    eprint("")
    eprint("=== Summary ===")
    eprint(f"Unique submitters:   {n}")
    eprint(f"With ROR match:      {matched} ({100 * matched / n:.1f}%)")
    eprint(f"With coordinates:    {with_coords} ({100 * with_coords / n:.1f}%)")
    eprint("Match methods:")
    for method, count in methods.most_common():
        eprint(f"  {method}: {count}")
    unmatched = [
        r for r in rows if r["has_ror_match"] != "true"
    ]
    unmatched.sort(key=lambda r: -int(r["assembly_count"] or 0))
    eprint("Top unmatched by assembly_count:")
    for row in unmatched[:15]:
        eprint(f"  {row['assembly_count']:>5}  {row['submitter_name']}")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(
        description="Map NCBI assembly submitters to ROR institute geo."
    )
    p.add_argument(
        "--input",
        type=Path,
        default=repo_root / "data" / "eukaryote_assemblies.tsv",
        help="Assemblies TSV with assembly_submitter column",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=repo_root / "data" / "submitter_institutes.tsv",
        help="Output institutes TSV",
    )
    p.add_argument(
        "--cache-file",
        type=Path,
        default=repo_root / "data" / "raw" / "ror_submitter_cache.jsonl",
        help="JSONL cache of ROR lookups",
    )
    p.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Only use cache; do not call ROR API for missing names",
    )
    p.add_argument(
        "--client-id",
        default=os.environ.get("ROR_CLIENT_ID"),
        help="ROR Client-Id header (or set ROR_CLIENT_ID)",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only resolve the first N unique submitters (smoke tests)",
    )
    p.add_argument(
        "--prefer",
        nargs="*",
        default=None,
        help="Submitter names to resolve first (still counted toward --limit)",
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=0.3,
        help="Minimum seconds between ROR requests (default 0.3)",
    )
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if not args.skip_fetch and not args.client_id:
        eprint("ROR Client-Id required via --client-id or ROR_CLIENT_ID "
               "(unless --skip-fetch)")
        return 1
    if not args.input.exists():
        eprint(f"Input not found: {args.input}")
        return 1

    counts = load_submitter_counts(args.input)
    eprint(f"Found {len(counts)} unique submitters in {args.input}")

    names = list(counts.keys())
    # Stable order: highest assembly_count first (better for smoke/manual review)
    names.sort(key=lambda n: (-counts[n], n.casefold()))

    prefer = args.prefer or []
    if prefer:
        preferred = [n for n in prefer if n in counts]
        rest = [n for n in names if n not in preferred]
        names = preferred + rest

    if args.limit is not None:
        names = names[: args.limit]
        eprint(f"Limiting to {len(names)} submitters")

    cache = load_cache(args.cache_file)
    client = RorClient(client_id=args.client_id or "", sleep_s=args.sleep)

    rows: list[dict[str, str]] = []
    for i, name in enumerate(names, 1):
        if i == 1 or i % 50 == 0 or i == len(names):
            eprint(f"Resolving {i}/{len(names)}: {name[:80]}")
        record = resolve_submitter(
            client=client,
            submitter=name,
            cache=cache,
            cache_file=args.cache_file,
            skip_fetch=args.skip_fetch,
        )
        rows.append(record_to_row(record, counts[name]))

    write_tsv(args.output, rows)
    print_summary(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
