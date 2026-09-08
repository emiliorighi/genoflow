#!/usr/bin/env python3
"""Resolve species taxids missing from the ENA taxonomy cache via NCBI datasets.

Some recently minted NCBI taxids are present on assemblies but not yet in ENA's
taxonomy API (or even in NCBI's canonical Taxonomy DB by ID). This script falls
back to resolving each missing species by looking up its *genus* with
`datasets summary taxonomy taxon <Genus> --parents`, caching the genus lineage
(truncated at Eukaryota) into the shared ena_taxonomy_nodes.jsonl cache, and
attaching each species as a synthetic leaf under that genus.
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
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

EUKARYOTA_TAXID = "2759"
MAX_WALK_DEPTH = 200

# First alphabetic token, allowing leading brackets/quotes stripped beforehand.
GENUS_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z-]*")


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def load_node_cache(path: Path) -> dict[str, dict[str, str]]:
    nodes: dict[str, dict[str, str]] = {}
    if not path.exists():
        return nodes
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
            taxid = str(rec.get("taxid") or "").strip()
            if not taxid:
                continue
            nodes[taxid] = {
                "taxid": taxid,
                "parent_taxid": str(rec.get("parent_taxid") or ""),
                "rank": str(rec.get("rank") or "no rank"),
                "scientific_name": str(rec.get("scientific_name") or ""),
            }
    eprint(f"Loaded {len(nodes)} cached taxonomy nodes from {path}")
    return nodes


def append_node_cache(path: Path, record: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def remember_node(
    nodes: dict[str, dict[str, str]],
    cache_file: Path,
    taxid: str,
    parent_taxid: str,
    rank: str,
    scientific_name: str,
) -> bool:
    """Append node to cache if new. Returns True if newly added."""
    if taxid in nodes:
        return False
    record = {
        "taxid": taxid,
        "parent_taxid": parent_taxid,
        "rank": rank or "no rank",
        "scientific_name": scientific_name,
    }
    nodes[taxid] = record
    append_node_cache(cache_file, record)
    return True


def normalize_rank(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return "no rank"
    return text.lower().replace("_", " ")


def extract_genus(scientific_name: str) -> Optional[str]:
    """Extract genus as the first alphabetic token of a scientific name."""
    text = (scientific_name or "").strip()
    # Strip leading brackets / quotes commonly used for provisional names
    while text and text[0] in "[(\"'" :
        text = text[1:].lstrip()
    match = GENUS_TOKEN_RE.match(text)
    if not match:
        return None
    genus = match.group(0)
    # Require capitalized genus (NCBI style); reject empty / single-letter noise
    if len(genus) < 2:
        return None
    return genus


def load_missing_species(
    input_path: Path, nodes: dict[str, dict[str, str]]
) -> dict[str, dict[str, str]]:
    """Return species_taxid -> {name, binomial} for taxids not in the cache."""
    required = {"species_taxid", "species_scientific_name"}
    missing: dict[str, dict[str, str]] = {}
    with input_path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        fields = set(reader.fieldnames or [])
        absent = required - fields
        if absent:
            raise SystemExit(
                f"Input {input_path} missing columns {sorted(absent)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            taxid = (row.get("species_taxid") or "").strip()
            if not taxid or taxid in nodes or taxid in missing:
                continue
            name = (row.get("species_scientific_name") or "").strip()
            binomial = (
                (row.get("is_species_name_binomial") or "").strip().casefold()
                == "true"
            )
            missing[taxid] = {
                "scientific_name": name,
                "is_binomial": "true" if binomial else "false",
            }
    return missing


def datasets_base_cmd(api_key: Optional[str]) -> list[str]:
    cmd = ["datasets"]
    if api_key:
        cmd.extend(["--api-key", api_key])
    return cmd


def fetch_genus_lineage(
    genus: str,
    api_key: Optional[str],
    max_retries: int,
) -> Optional[list[dict[str, Any]]]:
    """Call datasets for genus + parents; return list of taxonomy dicts or None."""
    cmd = datasets_base_cmd(api_key) + [
        "summary",
        "taxonomy",
        "taxon",
        genus,
        "--parents",
        "--as-json-lines",
    ]
    last_err: Optional[str] = None
    for attempt in range(1, max_retries + 1):
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )
        # Filter version-banner noise from stdout
        entries: list[dict[str, Any]] = []
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            tax = payload.get("taxonomy")
            if isinstance(tax, dict) and tax.get("tax_id") is not None:
                entries.append(tax)

        if proc.returncode == 0 and entries:
            return entries

        err = (proc.stderr or "").strip()
        # Strip update banner lines for cleaner logs
        err_lines = [
            ln
            for ln in err.splitlines()
            if ln.strip() and not ln.startswith("New version of client")
        ]
        last_err = "\n".join(err_lines)[:500] or f"exit {proc.returncode}"

        # Non-retryable: name not exact / no matching taxid
        lower = last_err.casefold()
        if (
            "does not match" in lower
            or "is not exact" in lower
            or "no valid taxons" in lower
        ):
            eprint(f"  genus '{genus}' unresolved by NCBI: {last_err.splitlines()[0]}")
            return None

        if attempt < max_retries:
            wait = 2**attempt
            eprint(
                f"  genus '{genus}' attempt {attempt} failed "
                f"(exit {proc.returncode}); retry in {wait}s"
            )
            time.sleep(wait)

    eprint(f"  genus '{genus}' failed permanently: {last_err}")
    return None


def _taxon_name(tax: dict[str, Any]) -> str:
    name_obj = tax.get("current_scientific_name") or {}
    if isinstance(name_obj, dict):
        name = str(name_obj.get("name") or "")
    elif name_obj:
        name = str(name_obj)
    else:
        name = ""
    if not name:
        name = str(tax.get("group_name") or "")
    return name


def cache_lineage_from_entries(
    entries: list[dict[str, Any]],
    nodes: dict[str, dict[str, str]],
    cache_file: Path,
) -> tuple[Optional[str], Optional[str], int]:
    """Cache genus + ancestors truncated at Eukaryota.

    Returns (genus_taxid, genus_rank, nodes_added) or (None, None, 0) if the
    lineage never reaches Eukaryota.
    """
    if not entries:
        return None, None, 0

    by_id: dict[str, dict[str, Any]] = {}
    for tax in entries:
        tid = str(tax.get("tax_id"))
        by_id[tid] = tax

    # Queried taxon = entry with the longest parents list
    target = max(entries, key=lambda e: len(e.get("parents") or []))
    target_id = str(target.get("tax_id"))
    # parents ordered root -> immediate parent
    parent_ids = [str(p) for p in (target.get("parents") or [])]

    if EUKARYOTA_TAXID not in parent_ids and target_id != EUKARYOTA_TAXID:
        return None, None, 0

    # Keep target + ancestors down through Eukaryota (drop cellular organisms / root)
    keep: set[str] = {target_id}
    if target_id != EUKARYOTA_TAXID:
        # Walk parent_ids from the end (immediate parent) until Eukaryota inclusive
        for pid in reversed(parent_ids):
            keep.add(pid)
            if pid == EUKARYOTA_TAXID:
                break

    added = 0
    for tid in keep:
        tax = by_id.get(tid)
        if tax is None:
            continue
        if tid == EUKARYOTA_TAXID:
            parent = ""
        else:
            parents = [str(p) for p in (tax.get("parents") or [])]
            parent = parents[-1] if parents else ""
            # If immediate parent is above Eukaryota, re-parent under Eukaryota
            # only when this node is itself Eukaryota (handled above). For the
            # child of Eukaryota, parents[-1] should be 2759.
            if parent not in keep and tid != EUKARYOTA_TAXID:
                # Find nearest kept ancestor along this taxon's parents list
                parent = ""
                for pid in reversed(parents):
                    if pid in keep:
                        parent = pid
                        break
                if not parent and EUKARYOTA_TAXID in keep:
                    parent = EUKARYOTA_TAXID
        rank = normalize_rank(tax.get("rank"))
        name = _taxon_name(tax)
        if remember_node(nodes, cache_file, tid, parent, rank, name):
            added += 1

    genus_rank = normalize_rank(target.get("rank"))
    return target_id, genus_rank, added


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(
        description=(
            "Resolve ENA-missing species taxids via NCBI datasets genus lookup "
            "and append them to the shared taxonomy node cache."
        )
    )
    p.add_argument(
        "--input",
        type=Path,
        default=repo_root / "data" / "eukaryote_assemblies.tsv",
        help="Assemblies TSV with species_taxid / species_scientific_name",
    )
    p.add_argument(
        "--cache-file",
        type=Path,
        default=repo_root / "data" / "raw" / "ena_taxonomy_nodes.jsonl",
        help="Shared JSONL taxonomy node cache (same as build_taxonomic_tree.py)",
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=0.3,
        help="Minimum seconds between datasets genus lookups (default 0.3)",
    )
    p.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Retries per genus lookup on transient errors",
    )
    p.add_argument(
        "--api-key",
        default=os.environ.get("NCBI_API_KEY"),
        help="NCBI API key (or set NCBI_API_KEY)",
    )
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if not args.input.exists():
        eprint(f"Input not found: {args.input}")
        return 1

    nodes = load_node_cache(args.cache_file)
    missing = load_missing_species(args.input, nodes)
    eprint(f"Species taxids missing from cache: {len(missing)}")
    if not missing:
        eprint("Nothing to resolve")
        return 0

    # Group by genus
    by_genus: dict[str, list[str]] = defaultdict(list)
    no_genus: list[str] = []
    for taxid, meta in missing.items():
        genus = extract_genus(meta["scientific_name"])
        if genus is None:
            no_genus.append(taxid)
            continue
        by_genus[genus].append(taxid)

    eprint(
        f"Grouped into {len(by_genus)} unique genera "
        f"({len(no_genus)} species with no extractable genus)"
    )

    genera_resolved = 0
    genera_failed = 0
    species_resolved: list[str] = []
    species_failed: list[str] = list(no_genus)
    nodes_added = 0
    last_request = 0.0

    genera = sorted(by_genus.keys(), key=str.casefold)
    for gi, genus in enumerate(genera, 1):
        species_ids = by_genus[genus]
        eprint(
            f"[{gi}/{len(genera)}] Resolving genus '{genus}' "
            f"({len(species_ids)} species)..."
        )
        elapsed = time.monotonic() - last_request
        if elapsed < args.sleep:
            time.sleep(args.sleep - elapsed)
        last_request = time.monotonic()

        entries = fetch_genus_lineage(
            genus=genus,
            api_key=args.api_key,
            max_retries=args.max_retries,
        )
        if entries is None:
            genera_failed += 1
            species_failed.extend(species_ids)
            continue

        genus_taxid, genus_rank, added = cache_lineage_from_entries(
            entries, nodes, args.cache_file
        )
        if genus_taxid is None:
            eprint(
                f"  WARNING: genus '{genus}' lineage does not reach Eukaryota; "
                f"skipping ({len(species_ids)} species)"
            )
            genera_failed += 1
            species_failed.extend(species_ids)
            continue

        # Sanity: prefer attaching under a genus-rank node when available
        if genus_rank not in ("genus", "subgenus", "species group", "no rank", "clade"):
            eprint(
                f"  NOTE: resolved '{genus}' as taxid={genus_taxid} "
                f"rank={genus_rank!r} (not genus); still attaching species under it"
            )

        nodes_added += added

        for taxid in species_ids:
            meta = missing[taxid]
            rank = (
                "species" if meta["is_binomial"] == "true" else "no rank"
            )
            if remember_node(
                nodes,
                args.cache_file,
                taxid,
                genus_taxid,
                rank,
                meta["scientific_name"],
            ):
                nodes_added += 1
            species_resolved.append(taxid)

        genera_resolved += 1
        eprint(
            f"  ok: genus taxid={genus_taxid} rank={genus_rank}; "
            f"attached {len(species_ids)} species; "
            f"+{added} ancestor nodes"
        )

    eprint("")
    eprint("=== Summary ===")
    eprint(f"Species missing at start:   {len(missing)}")
    eprint(f"Genera attempted:           {len(by_genus)}")
    eprint(f"Genera resolved:            {genera_resolved}")
    eprint(f"Genera unresolved:          {genera_failed}")
    eprint(f"Species newly resolved:     {len(species_resolved)}")
    eprint(f"Species still unresolved:   {len(species_failed)}")
    eprint(f"Nodes appended to cache:    {nodes_added}")
    eprint(f"Cache size now:             {len(nodes)}")
    if species_failed:
        eprint("Still unresolved:")
        for taxid in species_failed[:30]:
            meta = missing.get(taxid, {})
            eprint(
                f"  taxid={taxid}  name={meta.get('scientific_name', '')!r}"
            )
        if len(species_failed) > 30:
            eprint(f"  ... and {len(species_failed) - 30} more")

    return 0 if not species_failed else 0  # soft-fail: still allow rebuild


if __name__ == "__main__":
    raise SystemExit(main())
