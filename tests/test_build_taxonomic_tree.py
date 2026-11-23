"""Tests for the ENA 404 handling and REST fallback in build_taxonomic_tree."""

from __future__ import annotations

import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_taxonomic_tree as btt  # noqa: E402

SPECIES = "3686943"
GENUS = "3686942"


class FakeClient:
    """Stands in for EnaClient: scripted XML and REST answers, no network."""

    def __init__(self, missing_xml=(), rest=None):
        self.missing_xml = set(missing_xml)
        self.rest = rest or {}
        self.xml_calls: list[list[str]] = []
        self.rest_calls: list[str] = []

    def fetch_xml(self, accessions):
        self.xml_calls.append(list(accessions))
        if self.missing_xml & set(accessions):
            raise btt.EnaNotFound("ENA HTTP 404")
        body = "".join(
            f'<taxon taxId="{t}" scientificName="sp{t}" rank="species">'
            '<lineage><taxon taxId="2759" scientificName="Eukaryota" rank="domain"/>'
            "</lineage></taxon>"
            for t in accessions
        )
        return f"<TAXON_SET>{body}</TAXON_SET>"

    def get_json(self, url):
        self.rest_calls.append(url)
        return self.rest.get(url)


def rest_for_new_species():
    return {
        btt.ENA_REST_TAXID_URL + SPECIES: {
            "taxId": SPECIES,
            "scientificName": "Stomacoccus platani",
            "rank": "species",
            "lineage": "Eukaryota; Metazoa; Stomacoccus; ",
        },
        # "Stomacoccus" is not cached: found by name, matched on its lineage.
        btt.ENA_REST_NAME_URL + "Stomacoccus": [
            {"taxId": "999", "scientificName": "Stomacoccus", "lineage": "Eukaryota; Plantae; "},
            {"taxId": GENUS, "scientificName": "Stomacoccus", "lineage": "Eukaryota; Metazoa; "},
        ],
    }


def cached_nodes():
    return {
        "2759": {"taxid": "2759", "parent_taxid": "", "rank": "domain", "scientific_name": "Eukaryota"},
        "33208": {"taxid": "33208", "parent_taxid": "2759", "rank": "kingdom", "scientific_name": "Metazoa"},
    }


def test_fetch_xml_raises_enanotfound_on_404(monkeypatch):
    def boom(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 404, "nf", {}, None)

    monkeypatch.setattr(btt.urllib.request, "urlopen", boom)
    client = btt.EnaClient(sleep_s=0, max_retries=2)
    with pytest.raises(btt.EnaNotFound):
        client.fetch_xml(["1"])


def test_rest_fallback_builds_full_chain(tmp_path):
    nodes = cached_nodes()
    cache = tmp_path / "nodes.jsonl"
    client = FakeClient(rest=rest_for_new_species())
    assert btt.fetch_taxon_via_rest(SPECIES, nodes, cache, client)
    assert nodes[SPECIES]["parent_taxid"] == GENUS
    assert nodes[SPECIES]["rank"] == "species"
    assert nodes[GENUS]["parent_taxid"] == "33208"  # homonym 999 was ignored
    assert nodes["33208"]["parent_taxid"] == "2759"
    assert nodes["2759"]["parent_taxid"] == ""
    # New nodes were persisted to the cache file.
    reloaded = btt.load_node_cache(cache)
    assert SPECIES in reloaded and GENUS in reloaded


def test_rest_fallback_fails_cleanly(tmp_path):
    nodes = cached_nodes()
    client = FakeClient(rest={})  # REST knows nothing
    assert not btt.fetch_taxon_via_rest(SPECIES, nodes, tmp_path / "n.jsonl", client)
    assert SPECIES not in nodes


def test_rest_fallback_rejects_unresolvable_ancestor(tmp_path):
    rest = rest_for_new_species()
    del rest[btt.ENA_REST_NAME_URL + "Stomacoccus"]
    nodes = cached_nodes()
    assert not btt.fetch_taxon_via_rest(SPECIES, nodes, tmp_path / "n.jsonl", FakeClient(rest=rest))
    assert SPECIES not in nodes


def test_batch_404_is_bisected_and_only_culprit_uses_rest(tmp_path):
    nodes = cached_nodes()
    batch = ["10", "20", SPECIES, "30", "40"]
    client = FakeClient(missing_xml={SPECIES}, rest=rest_for_new_species())
    returned = btt.fetch_batch_with_fallback(client, batch, nodes, tmp_path / "n.jsonl")
    assert returned == set(batch)
    assert client.rest_calls[0] == btt.ENA_REST_TAXID_URL + SPECIES
    for t in batch:
        assert t in nodes


def test_unresolvable_taxid_is_skipped_not_fatal(tmp_path):
    nodes = cached_nodes()
    client = FakeClient(missing_xml={"20"})
    returned = btt.fetch_batch_with_fallback(client, ["10", "20", "30"], nodes, tmp_path / "n.jsonl")
    assert returned == {"10", "30"}


def test_fetch_missing_lineages_reports_unresolved(tmp_path, monkeypatch):
    client = FakeClient(missing_xml={"20"})
    monkeypatch.setattr(btt, "EnaClient", lambda **kw: client)
    nodes = cached_nodes()
    unresolved, _ = btt.fetch_missing_lineages(
        ["10", "20"], nodes, tmp_path / "n.jsonl",
        batch_size=100, sleep_s=0, max_retries=1, skip_fetch=False,
    )
    assert unresolved == {"20"}
    assert "10" in nodes
