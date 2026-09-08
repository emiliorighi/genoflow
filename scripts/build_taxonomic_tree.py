#!/usr/bin/env python3
"""Build a taxonomic tree TSV rolled up from eukaryote assemblies.

Reads data/eukaryote_assemblies.tsv, fetches ancestor lineages for each unique
species_taxid from the ENA taxonomy XML API (batched), and writes a TSV with
one row per taxon from Eukaryota down to every species that has assemblies,
with rolled-up counts at each node.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator, Optional

ENA_XML_URL = "https://www.ebi.ac.uk/ena/browser/api/xml"
EUKARYOTA_TAXID = "2759"
USER_AGENT = "genoflow-build-taxonomic-tree/1.0"
MAX_BATCH_SIZE = 10000
MAX_WALK_DEPTH = 200

TSV_COLUMNS = [
    "taxid",
    "parent_taxid",
    "assemblies_count",
    "biosamples_count",
    "institutes_count",
    "countries_count",
    "biosamples_with_coordinates_count",
    "rank",
    "scientific_name",
]


@dataclass
class LeafStats:
    assemblies: int = 0
    coords: int = 0
    institutes: set[str] = field(default_factory=set)
    countries: set[str] = field(default_factory=set)


@dataclass
class NodeAgg:
    assemblies: int = 0
    coords: int = 0
    institutes: set[str] = field(default_factory=set)
    countries: set[str] = field(default_factory=set)


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def sanitize_tsv_field(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\t", " ").replace("\r", " ").split())


def chunked(items: list[str], size: int) -> Iterator[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def load_leaf_stats(path: Path) -> dict[str, LeafStats]:
    """Parse assemblies TSV into per-species_taxid leaf stats."""
    stats: dict[str, LeafStats] = {}
    required = {
        "species_taxid",
        "assembly_submitter",
        "biosample_collection_country",
        "has_biosample_coordinates",
    }
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        fields = set(reader.fieldnames or [])
        missing = required - fields
        if missing:
            raise SystemExit(
                f"Input {path} missing columns {sorted(missing)}; "
                f"found {reader.fieldnames}"
            )
        for row in reader:
            taxid = (row.get("species_taxid") or "").strip()
            if not taxid:
                continue
            leaf = stats.get(taxid)
            if leaf is None:
                leaf = LeafStats()
                stats[taxid] = leaf
            leaf.assemblies += 1
            if (row.get("has_biosample_coordinates") or "").strip().casefold() == "true":
                leaf.coords += 1
            submitter = (row.get("assembly_submitter") or "").strip()
            if submitter:
                leaf.institutes.add(submitter)
            country = (row.get("biosample_collection_country") or "").strip()
            if country:
                leaf.countries.add(country)
    return stats


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
) -> None:
    if taxid in nodes:
        return
    record = {
        "taxid": taxid,
        "parent_taxid": parent_taxid,
        "rank": rank or "no rank",
        "scientific_name": scientific_name,
    }
    nodes[taxid] = record
    append_node_cache(cache_file, record)


def _attr(elem: ET.Element, name: str) -> str:
    return (elem.get(name) or "").strip()


def parse_ena_taxon_xml(
    xml_text: str,
    nodes: dict[str, dict[str, str]],
    cache_file: Path,
) -> set[str]:
    """Parse ENA TAXON_SET XML; cache nodes truncated at Eukaryota.

    Returns the set of top-level (requested) taxids that were present in the
    response.
    """
    returned: set[str] = set()
    root = ET.fromstring(xml_text)
    for taxon in root.findall("taxon"):
        taxid = _attr(taxon, "taxId")
        if not taxid:
            continue
        returned.add(taxid)

        lineage_el = taxon.find("lineage")
        # Chain from queried taxon toward root: self, then lineage[0], lineage[1], ...
        chain: list[tuple[str, str, str]] = [
            (taxid, _attr(taxon, "rank") or "no rank", _attr(taxon, "scientificName"))
        ]
        if lineage_el is not None:
            for anc in lineage_el:
                if anc.tag != "taxon":
                    continue
                anc_id = _attr(anc, "taxId")
                if not anc_id:
                    continue
                chain.append(
                    (
                        anc_id,
                        _attr(anc, "rank") or "no rank",
                        _attr(anc, "scientificName"),
                    )
                )

        # Truncate at Eukaryota: keep Eukaryota, drop cellular organisms / root.
        cut = None
        for i, (tid, _rank, _name) in enumerate(chain):
            if tid == EUKARYOTA_TAXID:
                cut = i
                break
        if cut is None:
            # Lineage never reaches Eukaryota — still record what we have, but
            # do not invent a parent link past the last known ancestor.
            truncated = chain
        else:
            truncated = chain[: cut + 1]

        for i, (tid, rank, name) in enumerate(truncated):
            if tid == EUKARYOTA_TAXID:
                parent = ""
            elif i + 1 < len(truncated):
                parent = truncated[i + 1][0]
            else:
                # Last node and not Eukaryota (shouldn't happen for eukaryote species)
                parent = ""
            remember_node(nodes, cache_file, tid, parent, rank, name)

        # Ensure Eukaryota itself is recorded even if somehow only ancestors above it.
        if any(tid == EUKARYOTA_TAXID for tid, _, _ in chain):
            euk = next((c for c in chain if c[0] == EUKARYOTA_TAXID), None)
            if euk is not None:
                remember_node(
                    nodes,
                    cache_file,
                    EUKARYOTA_TAXID,
                    "",
                    euk[1] or "domain",
                    euk[2] or "Eukaryota",
                )

    return returned


class EnaClient:
    def __init__(self, sleep_s: float, max_retries: int) -> None:
        self.sleep_s = sleep_s
        self.max_retries = max_retries
        self._last_request = 0.0

    def _pace(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.sleep_s:
            time.sleep(self.sleep_s - elapsed)

    def fetch_xml(self, accessions: list[str]) -> str:
        body = json.dumps(
            {"accessions": accessions, "expanded": True},
            separators=(",", ":"),
        ).encode("utf-8")
        headers = {
            "Accept": "application/xml",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        }
        last_err: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            self._pace()
            req = urllib.request.Request(
                ENA_XML_URL, data=body, headers=headers, method="POST"
            )
            try:
                self._last_request = time.monotonic()
                with urllib.request.urlopen(req, timeout=300) as resp:
                    return resp.read().decode("utf-8")
            except urllib.error.HTTPError as exc:
                last_err = exc
                body_snip = ""
                try:
                    body_snip = exc.read().decode("utf-8", errors="replace")[:300]
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
                if 500 <= exc.code < 600 and attempt < self.max_retries:
                    wait = 2**attempt
                    eprint(f"HTTP {exc.code}; retry in {wait}s ({body_snip})")
                    time.sleep(wait)
                    continue
                raise RuntimeError(
                    f"ENA HTTP {exc.code}: {body_snip}"
                ) from exc
            except urllib.error.URLError as exc:
                last_err = exc
                if attempt < self.max_retries:
                    wait = 2**attempt
                    eprint(f"Network error: {exc}; retry in {wait}s")
                    time.sleep(wait)
                    continue
                raise
        raise RuntimeError(f"ENA request failed after retries: {last_err}")


def fetch_missing_lineages(
    species_taxids: list[str],
    nodes: dict[str, dict[str, str]],
    cache_file: Path,
    batch_size: int,
    sleep_s: float,
    max_retries: int,
    skip_fetch: bool,
) -> tuple[set[str], float]:
    """Fetch lineages for species not yet in the node cache.

    Returns (unresolved_species_taxids, fetch_elapsed_seconds).
    """
    missing = [tid for tid in species_taxids if tid not in nodes]
    if not missing:
        eprint("All species taxids already present in node cache")
        return set(), 0.0

    if skip_fetch:
        eprint(
            f"--skip-fetch set but {len(missing)} species taxids missing from cache"
        )
        return set(missing), 0.0

    batch_size = max(1, min(batch_size, MAX_BATCH_SIZE))
    batches = list(chunked(missing, batch_size))
    eprint(
        f"Fetching lineages for {len(missing)} species taxids "
        f"in {len(batches)} batch(es) of up to {batch_size}"
    )
    client = EnaClient(sleep_s=sleep_s, max_retries=max_retries)
    returned_all: set[str] = set()
    t0 = time.monotonic()
    for bi, batch in enumerate(batches, 1):
        eprint(f"  ENA batch {bi}/{len(batches)} ({len(batch)} taxids)...")
        xml_text = client.fetch_xml(batch)
        returned = parse_ena_taxon_xml(xml_text, nodes, cache_file)
        returned_all.update(returned)
        eprint(
            f"  batch {bi} ok: returned {len(returned)}/{len(batch)}; "
            f"cache now {len(nodes)} nodes"
        )
    elapsed = time.monotonic() - t0
    unresolved = set(missing) - returned_all
    # Also treat species that came back but somehow weren't cached as unresolved
    unresolved |= {tid for tid in missing if tid not in nodes}
    return unresolved, elapsed


def rollup_tree(
    leaf_stats: dict[str, LeafStats],
    nodes: dict[str, dict[str, str]],
    resolved_species: list[str],
) -> dict[str, NodeAgg]:
    """Walk each species to Eukaryota, merging leaf stats into every ancestor."""
    aggs: dict[str, NodeAgg] = {}
    for taxid in resolved_species:
        leaf = leaf_stats[taxid]
        seen: set[str] = set()
        cur: Optional[str] = taxid
        depth = 0
        while cur is not None and cur != "":
            if cur in seen:
                eprint(f"WARNING: cycle detected at taxid {cur}; stopping walk")
                break
            seen.add(cur)
            depth += 1
            if depth > MAX_WALK_DEPTH:
                eprint(f"WARNING: walk depth exceeded for species {taxid}")
                break
            if cur not in nodes:
                eprint(
                    f"WARNING: missing node {cur} while walking from species {taxid}"
                )
                break
            agg = aggs.get(cur)
            if agg is None:
                agg = NodeAgg()
                aggs[cur] = agg
            agg.assemblies += leaf.assemblies
            agg.coords += leaf.coords
            agg.institutes.update(leaf.institutes)
            agg.countries.update(leaf.countries)

            if cur == EUKARYOTA_TAXID:
                break
            parent = nodes[cur].get("parent_taxid") or ""
            cur = parent if parent else None
    return aggs


def dfs_ordered_rows(
    nodes: dict[str, dict[str, str]],
    aggs: dict[str, NodeAgg],
) -> list[dict[str, str]]:
    """DFS from Eukaryota; children sorted by assemblies_count desc, then name."""
    children: dict[str, list[str]] = defaultdict(list)
    for taxid in aggs:
        if taxid == EUKARYOTA_TAXID:
            continue
        parent = nodes.get(taxid, {}).get("parent_taxid") or ""
        if parent and parent in aggs:
            children[parent].append(taxid)
        elif taxid in aggs and parent == "":
            # Orphan under truncated tree — attach under Eukaryota if possible
            if EUKARYOTA_TAXID in aggs and taxid != EUKARYOTA_TAXID:
                children[EUKARYOTA_TAXID].append(taxid)

    def sort_key(tid: str) -> tuple[int, str]:
        a = aggs[tid]
        name = (nodes.get(tid, {}).get("scientific_name") or "").casefold()
        return (-a.assemblies, name)

    for parent in children:
        children[parent].sort(key=sort_key)

    rows: list[dict[str, str]] = []

    def visit(taxid: str) -> None:
        node = nodes.get(taxid)
        if node is None:
            return
        agg = aggs[taxid]
        parent = "" if taxid == EUKARYOTA_TAXID else (node.get("parent_taxid") or "")
        rows.append(
            {
                "taxid": taxid,
                "parent_taxid": parent,
                "assemblies_count": str(agg.assemblies),
                "biosamples_count": str(agg.assemblies),  # proxy
                "institutes_count": str(len(agg.institutes)),
                "countries_count": str(len(agg.countries)),
                "biosamples_with_coordinates_count": str(agg.coords),
                "rank": sanitize_tsv_field(node.get("rank") or "no rank"),
                "scientific_name": sanitize_tsv_field(node.get("scientific_name") or ""),
            }
        )
        for child in children.get(taxid, []):
            visit(child)

    if EUKARYOTA_TAXID not in aggs:
        raise SystemExit(
            f"Eukaryota ({EUKARYOTA_TAXID}) missing from aggregated tree; "
            "cannot write output rooted at Eukaryota"
        )
    # Ensure Eukaryota node metadata exists
    if EUKARYOTA_TAXID not in nodes:
        remember_node_in_memory = {
            "taxid": EUKARYOTA_TAXID,
            "parent_taxid": "",
            "rank": "domain",
            "scientific_name": "Eukaryota",
        }
        nodes[EUKARYOTA_TAXID] = remember_node_in_memory

    visit(EUKARYOTA_TAXID)
    return rows


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


def print_summary(
    rows: list[dict[str, str]],
    leaf_stats: dict[str, LeafStats],
    resolved: list[str],
    unresolved: set[str],
    fetch_elapsed: float,
) -> None:
    total_species = len(leaf_stats)
    total_assemblies = sum(s.assemblies for s in leaf_stats.values())
    resolved_assemblies = sum(leaf_stats[t].assemblies for t in resolved)
    unresolved_assemblies = sum(
        leaf_stats[t].assemblies for t in unresolved if t in leaf_stats
    )
    eprint("")
    eprint("=== Summary ===")
    eprint(f"Input unique species:     {total_species}")
    eprint(f"Species resolved:         {len(resolved)}")
    eprint(f"Species unresolved:       {len(unresolved)}")
    eprint(f"Input assemblies:         {total_assemblies}")
    eprint(f"Assemblies covered:       {resolved_assemblies}")
    eprint(f"Assemblies dropped:       {unresolved_assemblies}")
    eprint(f"Tree nodes written:       {len(rows)}")
    eprint(f"ENA fetch elapsed:        {fetch_elapsed:.1f}s")
    if rows:
        root = rows[0]
        eprint(
            f"Eukaryota root:           assemblies={root['assemblies_count']} "
            f"institutes={root['institutes_count']} "
            f"countries={root['countries_count']} "
            f"coords={root['biosamples_with_coordinates_count']}"
        )
    if unresolved:
        sample = sorted(unresolved, key=lambda t: -leaf_stats[t].assemblies)[:20]
        eprint("Top unresolved by assemblies:")
        for tid in sample:
            eprint(f"  {leaf_stats[tid].assemblies:>5}  taxid={tid}")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(
        description="Build taxonomic tree TSV from eukaryote assemblies + ENA lineages."
    )
    p.add_argument(
        "--input",
        type=Path,
        default=repo_root / "data" / "eukaryote_assemblies.tsv",
        help="Assemblies TSV with species_taxid column",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=repo_root / "data" / "taxonomic_tree.tsv",
        help="Output taxonomic tree TSV",
    )
    p.add_argument(
        "--cache-file",
        type=Path,
        default=repo_root / "data" / "raw" / "ena_taxonomy_nodes.jsonl",
        help="JSONL cache of ENA taxonomy nodes",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=3000,
        help=f"Tax IDs per ENA request (max {MAX_BATCH_SIZE})",
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=0.5,
        help="Minimum seconds between ENA requests (default 0.5)",
    )
    p.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Retries per ENA batch on transient errors",
    )
    p.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Only use cache; do not call ENA for missing taxids",
    )
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    if not args.input.exists():
        eprint(f"Input not found: {args.input}")
        return 1
    if args.batch_size > MAX_BATCH_SIZE:
        eprint(f"Clamping --batch-size from {args.batch_size} to {MAX_BATCH_SIZE}")
        args.batch_size = MAX_BATCH_SIZE

    leaf_stats = load_leaf_stats(args.input)
    species_taxids = sorted(leaf_stats.keys(), key=lambda t: (len(t), t))
    eprint(
        f"Loaded {len(species_taxids)} unique species taxids "
        f"({sum(s.assemblies for s in leaf_stats.values())} assemblies) "
        f"from {args.input}"
    )

    nodes = load_node_cache(args.cache_file)
    unresolved, fetch_elapsed = fetch_missing_lineages(
        species_taxids=species_taxids,
        nodes=nodes,
        cache_file=args.cache_file,
        batch_size=args.batch_size,
        sleep_s=args.sleep,
        max_retries=args.max_retries,
        skip_fetch=args.skip_fetch,
    )

    if args.skip_fetch and unresolved:
        eprint(
            f"WARNING: --skip-fetch but {len(unresolved)} species taxids "
            "missing from cache; continuing with resolved set only"
        )

    # Ensure Eukaryota is always present after a successful fetch
    if EUKARYOTA_TAXID not in nodes and not args.skip_fetch:
        eprint("Eukaryota missing from cache after fetch; requesting directly")
        client = EnaClient(sleep_s=args.sleep, max_retries=args.max_retries)
        xml_text = client.fetch_xml([EUKARYOTA_TAXID])
        parse_ena_taxon_xml(xml_text, nodes, args.cache_file)

    resolved = [t for t in species_taxids if t in nodes and t not in unresolved]
    if not resolved:
        eprint("No species taxids resolved; nothing to write")
        return 1

    eprint(f"Rolling up stats for {len(resolved)} species across the tree...")
    aggs = rollup_tree(leaf_stats, nodes, resolved)
    rows = dfs_ordered_rows(nodes, aggs)
    write_tsv(args.output, rows)
    print_summary(rows, leaf_stats, resolved, unresolved, fetch_elapsed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
