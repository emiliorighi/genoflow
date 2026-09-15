#!/usr/bin/env python3
"""Audit unresolved NCBI submitters and rematch them against ROR.

The production resolver only accepts affiliation chosen:true or a unique
quoted exact display/acronym hit. That misses aliases such as UW-Madison
(en-dash vs hyphen) and compound names such as Genoscope CEA.

This audit:
  1. writes the original unmatched rows
  2. matches against the ROR data dump (all name types, dash-normalized)
  3. falls back to the ROR query/affiliation APIs
  4. writes an audit TSV with any new matches
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Optional

ROR_BASE = "https://api.ror.org/v2/organizations"
USER_AGENT = "genoflow-audit-unresolved-institutes/1.0"

ORIGINAL_COLUMNS = [
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
AUDIT_COLUMNS = ORIGINAL_COLUMNS + [
    "match_note",
    "likely_category",
    "matched_name_variant",
]

DASH_RE = re.compile(r"[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00ad~]+")
PUNCT_RE = re.compile(r"[^\w\s]+", re.UNICODE)
SPACE_RE = re.compile(r"\s+")
SEGMENT_RE = re.compile(r"\s*(?:/|\||;|,|\s[-–—]\s+)\s*")
LEADING_THE_RE = re.compile(r"^the\s+")
FUNCTION_WORDS = frozenset(
    {
        "of",
        "for",
        "and",
        "in",
        "at",
        "de",
        "di",
        "del",
        "da",
        "the",
        "und",
        "et",
        "y",
        "e",
        "van",
        "von",
        "der",
        "den",
        "la",
        "le",
        "el",
        "du",
        "des",
        "das",
        "zu",
        "zum",
        "zur",
        "ao",
        "aos",
        "do",
        "dos",
        "a",
        "an",
        "on",
        "to",
        "by",
        "with",
        "from",
        "via",
        "&",
    }
)
GENERIC_NAMES = frozenset(
    {
        "university",
        "institute",
        "college",
        "hospital",
        "academy",
        "center",
        "centre",
        "laboratory",
        "department",
        "ministry",
        "council",
        "society",
        "foundation",
        "group",
        "lab",
        "school",
        "faculty",
        "campus",
        "national",
        "research",
        "sciences",
        "science",
        "biology",
        "genomics",
        "genome",
        "china",
        "france",
        "india",
        "germany",
        "japan",
        "canada",
        "australia",
        "california",
        "texas",
        "florida",
        "institute of microbiology",
        "school of medicine",
        "college of medicine",
        "department of biology",
        "department of microbiology",
        "university of",
        "institute of",
        "college of",
        "school of",
        "center for",
        "center of",
        "department of",
        "directorate of",
        "platform for",
        "consortium",
        "platform",
        "biological",
        "environmental",
        "bioinformatics",
        "agriculture",
        "technology",
        "identification",
        "worldwide",
        "resource",
        "mycology",
        "parasitology",
        "cellular and",
        "control and",
        "universidad de",
        "university school",
        "academy of",
        "partnership",
        "recherche",
        "bioengineering",
        "fundacion",
        "natural resources",
        "university of south",
        "institute of science",
        "education",
        "fisheries research institute",
    }
)
TOKEN_STOP = FUNCTION_WORDS | GENERIC_NAMES | {
    "research",
    "national",
    "international",
    "state",
    "federal",
    "medical",
    "health",
    "public",
    "new",
    "north",
    "south",
    "east",
    "west",
}
PROJECT_RE = re.compile(
    r"\b(consortium|project|initiative|platform|network|tree of life|"
    r"10k|1000|10000|genomes project|sequencing and analysis)\b",
    re.I,
)
LAB_RE = re.compile(r"\b(lab|laboratory|group)\b", re.I)
PERSONISH_RE = re.compile(r"^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$")


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


def strip_outer_quotes(name: str) -> str:
    text = name.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1].strip()
    return text


FILLER_TOKENS = frozenset({"the", "at"})

# Extra dump lookups for names that are obvious to humans but absent as ROR aliases.
ALIAS_LOOKUPS: dict[str, str] = {
    "usda ars": "agricultural research service",
    "us department of agriculture agriculture research service": "agricultural research service",
    "ucsc genomics institute": "university of california santa cruz",
    "swiss federal research institute wsl": "swiss federal institute for forest snow and landscape research",
    "northwestern university feinberg school of medicine": "northwestern university",
    "university of california at davis": "university of california davis",
    "bgi shenzhen": "bgi group china",
    "bgi sz": "bgi group china",
    "vib kuleuven": "vlaams instituut voor biotechnologie",
    "vib ku leuven": "vlaams instituut voor biotechnologie",
    "mpi for developmental biology": "max planck institute for developmental biology",
    "csiro applied genomics initiative": "csiro",
    "wageningen university": "wageningen university and research",
    "uppsala univeristy": "uppsala university",
    "institut de recherche pour le developpement": "institut de recherche pour le developpement",
}

# Leftover high-count names verified via ROR website/API (not unique in the dump).
WEB_VERIFIED: dict[str, str] = {
    "university of arkansas": "https://ror.org/05jbt9m15",
    "university of maryland": "https://ror.org/047s2c258",
    "senckenberg": "https://ror.org/00xmqmx64",
    "ipk gatersleben": "https://ror.org/02skbsp27",
    "indian biological data center": "https://ror.org/00nc5f834",
    "yeast genomics lab nova unl portugal": "https://ror.org/02xankh89",
    "center of molecular and environmental biology um portugal": "https://ror.org/037wpkx04",
    "chu liege": "https://ror.org/044s61914",
    "niab east malling research": "https://ror.org/010jx2260",
    "geisel school of medicine dartmouth": "https://ror.org/049s0rh22",
    "washington university school of medicine": "https://ror.org/01yc7t268",
    "mcdonnell genome institute washington university": "https://ror.org/01yc7t268",
    "university of california": "https://ror.org/00pjdza24",
    "georg august university of goettingen": "https://ror.org/01y9bpm73",
    "institute of phytopathology christian albrechts universitaet kiel": "https://ror.org/04v76ef78",
    "flanders research institute for agriculture fisheries and food": "https://ror.org/05cjt1n05",
    "universidad de los andes": "https://ror.org/02mhbdp94",
    "sciensano": "https://ror.org/04ejags36",
    "novogene": "https://ror.org/0105k4695",
    "bgi qingdao": "https://ror.org/045pn2j94",
    "sir h n reliance foundation hospital": "https://ror.org/014ezkx63",
    "alfred wegener institute helmholtz center for polar and marine research": "https://ror.org/032e6b942",
}


def normalize_key(name: str) -> str:
    text = strip_outer_quotes(name)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = DASH_RE.sub(" ", text)
    text = text.replace("&", " and ")
    text = text.replace("@", " ")
    text = text.casefold()
    text = re.sub(r"\bcentres\b", "centers", text)
    text = re.sub(r"\bcentre\b", "center", text)
    text = re.sub(r"\borganisations\b", "organizations", text)
    text = re.sub(r"\borganisation\b", "organization", text)
    text = PUNCT_RE.sub(" ", text)
    text = SPACE_RE.sub(" ", text).strip()
    text = LEADING_THE_RE.sub("", text)
    tokens = [t for t in text.split() if t not in FILLER_TOKENS]
    return " ".join(tokens)


def compact_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", normalize_key(name))


def ror_display_name(org: dict[str, Any]) -> str:
    for entry in org.get("names") or []:
        if "ror_display" in (entry.get("types") or []):
            return str(entry.get("value") or "")
    names = org.get("names") or []
    return str(names[0].get("value") or "") if names else ""


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


def likely_category(submitter: str) -> str:
    raw = strip_outer_quotes(submitter)
    if PROJECT_RE.search(raw):
        return "project_or_consortium"
    if PERSONISH_RE.match(raw) and not LAB_RE.search(raw):
        return "person_or_lab"
    if LAB_RE.search(raw) and "university" not in raw.casefold():
        return "person_or_lab"
    compact = re.sub(r"[^A-Za-z0-9]", "", raw)
    if len(raw) <= 4 or (compact.isupper() and len(raw.split()) <= 2 and len(raw) <= 12):
        return "short_or_acronym"
    return "institute_candidate"


def unique_org(ids: list[str]) -> Optional[str]:
    distinct = {i for i in ids if i}
    if len(distinct) == 1:
        return next(iter(distinct))
    return None


def pick_org(
    ids: list[str],
    orgs: dict[str, dict[str, Any]],
    resolved_counts: Counter[str],
    country_counts: Counter[str],
) -> Optional[str]:
    distinct = list(dict.fromkeys(i for i in ids if i and i in orgs))
    if not distinct:
        return None
    if len(distinct) == 1:
        return distinct[0]
    scored: list[tuple[int, str]] = []
    for ror_id in distinct:
        org = orgs[ror_id]
        score = 40 * int(resolved_counts.get(ror_id, 0))
        if org.get("status") == "active":
            score += 5
        if org.get("has_wikipedia"):
            score += 8
        if org.get("domains"):
            score += 6
        types = set(org.get("types") or [])
        if "funder" in types:
            score += 4
        if "education" in types:
            score += 2
        score += min(int(org.get("n_relationships") or 0), 30)
        score += min(int(country_counts.get(org.get("country") or "", 0)), 40) // 8
        scored.append((score, ror_id))
    scored.sort(reverse=True)
    if scored[0][0] >= scored[1][0] + 8:
        return scored[0][1]
    return None


class RorDumpIndex:
    def __init__(
        self,
        orgs: dict[str, dict[str, Any]],
        resolved_counts: Counter[str],
        country_counts: Counter[str],
    ) -> None:
        self.orgs = orgs
        self.resolved_counts = resolved_counts
        self.country_counts = country_counts
        self.by_name: dict[str, list[str]] = defaultdict(list)
        self.by_acronym: dict[str, list[str]] = defaultdict(list)
        self.by_compact: dict[str, list[str]] = defaultdict(list)
        self.by_token: dict[str, set[str]] = defaultdict(set)
        for ror_id, org in orgs.items():
            seen_keys: set[str] = set()
            for value, types in org["name_entries"]:
                key = normalize_key(value)
                if not key or key in seen_keys:
                    continue
                seen_keys.add(key)
                is_acronym = "acronym" in types and " " not in key and len(key) <= 12
                if is_acronym:
                    self.by_acronym[key].append(ror_id)
                else:
                    self.by_name[key].append(ror_id)
                compact = compact_key(value)
                if 5 <= len(compact) <= 40:
                    self.by_compact[compact].append(ror_id)
                for token in key.split():
                    if token not in TOKEN_STOP and len(token) >= 4:
                        self.by_token[token].add(ror_id)
            extra_keys: list[str] = []
            country_key = normalize_key(org.get("country") or "")
            for key in list(seen_keys):
                if country_key and key.endswith(" " + country_key):
                    stripped = key[: -(len(country_key) + 1)]
                    if stripped and len(stripped) >= 6:
                        extra_keys.append(stripped)
            for extra in extra_keys:
                if extra and extra not in seen_keys and extra not in GENERIC_NAMES:
                    self.by_name[extra].append(ror_id)
                    seen_keys.add(extra)

    def _pick(self, ids: list[str]) -> Optional[str]:
        return pick_org(ids, self.orgs, self.resolved_counts, self.country_counts)

    def lookup_name(self, key: str) -> Optional[str]:
        if not key or key in GENERIC_NAMES:
            return None
        return self._pick(self.by_name.get(key, []))

    def lookup_acronym(self, key: str) -> Optional[str]:
        if len(key) < 3:
            return None
        return self._pick(self.by_acronym.get(key, []))

    def lookup_compact(self, key: str, original_norm: str = "") -> Optional[str]:
        if not (5 <= len(key) <= 40):
            return None
        if original_norm in GENERIC_NAMES:
            return None
        return self._pick(self.by_compact.get(key, []))

    def lookup_any(self, key: str) -> Optional[str]:
        return self.lookup_name(key) or self.lookup_acronym(key)

    def live_org(self, ror_id: str) -> dict[str, Any]:
        org = self.orgs[ror_id]
        if org.get("status") == "active":
            return org
        for sid in org.get("successors") or []:
            succ = self.orgs.get(sid)
            if succ and succ.get("status") == "active":
                return succ
        return org


def load_ror_dump(zip_path: Path) -> dict[str, dict[str, Any]]:
    eprint(f"Loading ROR dump from {zip_path}")
    json_name = None
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            if name.endswith(".json"):
                json_name = name
                break
        if not json_name:
            raise SystemExit(f"No JSON file in {zip_path}")
        with zf.open(json_name) as fh:
            raw = json.load(fh)
    orgs: dict[str, dict[str, Any]] = {}
    for org in raw:
        status = str(org.get("status") or "")
        if status not in {"active", "inactive"}:
            continue
        ror_id = str(org.get("id") or "")
        if not ror_id:
            continue
        entries = []
        for entry in org.get("names") or []:
            value = str(entry.get("value") or "").strip()
            if value:
                entries.append((value, tuple(entry.get("types") or [])))
        country, lat, lon = extract_geo(org)
        rels = org.get("relationships") or []
        orgs[ror_id] = {
            "id": ror_id,
            "display": ror_display_name(org),
            "name_entries": entries,
            "country": country,
            "lat": lat,
            "lon": lon,
            "status": status,
            "types": list(org.get("types") or []),
            "domains": list(org.get("domains") or []),
            "has_wikipedia": any(
                (link.get("type") == "wikipedia") for link in (org.get("links") or [])
            ),
            "n_relationships": len(rels),
            "parents": [str(r.get("id")) for r in rels if r.get("type") == "parent" and r.get("id")],
            "successors": [
                str(r.get("id")) for r in rels if r.get("type") == "successor" and r.get("id")
            ],
        }
    del raw
    eprint(f"Indexed {len(orgs)} active/inactive ROR organizations")
    return orgs


def hit_record(
    org: dict[str, Any], method: str, note: str, variant: str
) -> dict[str, Any]:
    return {
        "institute_name_ror": org["display"],
        "ror_id": org["id"],
        "country": org.get("country") or "",
        "lat": org.get("lat"),
        "lon": org.get("lon"),
        "match_method": method,
        "match_note": note,
        "matched_name_variant": variant,
    }


def token_windows(key: str) -> list[str]:
    tokens = key.split()
    windows: list[str] = []
    n = len(tokens)
    for i in range(n):
        for j in range(n, i, -1):
            if i == 0 and j == n:
                continue
            phrase = " ".join(tokens[i:j])
            ntok = j - i
            if ntok == 1 and len(phrase) < 9:
                continue
            if phrase in GENERIC_NAMES:
                continue
            windows.append(phrase)
    windows.sort(key=lambda p: (-len(p.split()), -len(p)))
    return windows


def prefer_specific(index: RorDumpIndex, hits: list[tuple[str, str]]) -> Optional[tuple[str, str]]:
    """Prefer a child / more nested org when multiple delimiter segments match."""
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    ids = {h[0] for h in hits}
    descendants = []
    for ror_id, variant in hits:
        parents = set(index.orgs[ror_id].get("parents") or [])
        if parents.intersection(ids):
            descendants.append((ror_id, variant))
    if len(descendants) == 1:
        return descendants[0]
    if descendants:
        return descendants[-1]
    nested = [
        (ror_id, variant)
        for ror_id, variant in hits
        if index.orgs[ror_id].get("parents")
    ]
    if nested:
        return nested[-1]
    return hits[0]


def match_dump(submitter: str, index: RorDumpIndex) -> Optional[dict[str, Any]]:
    key = normalize_key(submitter)
    compact = compact_key(submitter)
    if not key:
        return None

    def finish(ror_id: str, method: str, note: str, variant: str) -> dict[str, Any]:
        org = index.live_org(ror_id)
        if org["id"] != ror_id:
            note = f"{note}; inactive record redirected to successor"
        return hit_record(org, method, note, variant)

    ror_id = index.lookup_name(key)
    if ror_id:
        return finish(ror_id, "dump_exact_name", "normalized name equals a ROR name/alias/label", submitter)

    ror_id = index.lookup_acronym(key)
    if ror_id:
        return finish(ror_id, "dump_exact_acronym", "normalized name equals a ROR acronym", submitter)

    alias_key = ALIAS_LOOKUPS.get(key)
    if alias_key:
        ror_id = index.lookup_any(alias_key)
        if ror_id:
            return finish(ror_id, "dump_alias_lookup", f"alias expansion: {alias_key}", alias_key)

    ror_id = index.lookup_compact(compact, key)
    if ror_id:
        return finish(ror_id, "dump_compact", "alphanumeric compact form equals a unique ROR name", submitter)

    raw = strip_outer_quotes(submitter)
    parts = [p.strip() for p in SEGMENT_RE.split(raw) if p.strip()]
    expanded_parts: list[str] = []
    for part in parts or [raw]:
        if re.fullmatch(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+", part):
            expanded_parts.extend(part.split("-"))
        else:
            expanded_parts.append(part)
    parts = expanded_parts
    if len(parts) >= 2:
        segment_hits: list[tuple[str, str]] = []
        seen_ids: set[str] = set()
        for part in parts:
            nkey = normalize_key(part)
            if not nkey or nkey in GENERIC_NAMES:
                continue
            ror_id = index.lookup_name(nkey)
            if not ror_id and len(nkey) >= 4:
                ror_id = index.lookup_acronym(nkey)
            if ror_id and ror_id not in seen_ids:
                segment_hits.append((ror_id, part))
                seen_ids.add(ror_id)
        chosen = prefer_specific(index, segment_hits)
        if chosen:
            ror_id, variant = chosen
            return finish(
                ror_id,
                "dump_segment",
                f"delimiter segment matched (preferred specific unit): {variant}",
                variant,
            )

    if "ncaur" in key.split() or key.endswith("ncaur"):
        ror_id = index.lookup_acronym("ncaur")
        if ror_id:
            return finish(ror_id, "dump_alias_lookup", "USDA-ARS-NCAUR mapped to NCAUR", "NCAUR")
    if key.startswith("usda ars"):
        ror_id = index.lookup_any("agricultural research service")
        if ror_id:
            return finish(ror_id, "dump_alias_lookup", "alias expansion: agricultural research service", "USDA-ARS")

    verified_id = WEB_VERIFIED.get(key)
    if not verified_id:
        if "washington university" in key and any(
            t in key for t in ("genome", "mcdonnell", "washu", "gsc")
        ):
            verified_id = "https://ror.org/01yc7t268"
    if verified_id and verified_id in index.orgs:
        return finish(
            verified_id,
            "web_verified",
            "manual ROR lookup from web/API for leftover high-count names",
            submitter,
        )

    for phrase in token_windows(key):
        first = phrase.split()[0]
        if first in FUNCTION_WORDS:
            continue
        ror_id = index.lookup_name(phrase)
        if not ror_id and " " not in phrase and len(phrase) >= 4:
            ror_id = index.lookup_acronym(phrase)
        if not ror_id:
            continue
        return finish(
            ror_id,
            "dump_contained_name",
            f"ROR name contained in submitter: {phrase}",
            phrase,
        )

    # Fuzzy against token-sharing candidates.
    tokens = [t for t in key.split() if t not in TOKEN_STOP and len(t) >= 4]
    candidate_ids: set[str] = set()
    for token in tokens[:8]:
        candidate_ids.update(index.by_token.get(token, ()))
        if len(candidate_ids) > 400:
            break
    if candidate_ids and len(candidate_ids) <= 400:
        scored: list[tuple[float, str, str]] = []
        for cid in candidate_ids:
            org = index.orgs[cid]
            best_ratio = 0.0
            best_variant = org["display"]
            for value, _types in org["name_entries"]:
                other = normalize_key(value)
                if not other or abs(len(other) - len(key)) > max(8, len(key) * 0.4):
                    continue
                ratio = SequenceMatcher(None, key, other).ratio()
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_variant = value
            if best_ratio >= 0.94:
                other_toks = {
                    t
                    for t in normalize_key(best_variant).split()
                    if t not in TOKEN_STOP and len(t) >= 5
                }
                sub_toks = {t for t in tokens if t not in TOKEN_STOP and len(t) >= 5}
                if sub_toks:
                    overlap = sum(
                        1
                        for t in sub_toks
                        if t in other_toks
                        or any(SequenceMatcher(None, t, o).ratio() >= 0.85 for o in other_toks)
                    )
                    if overlap / len(sub_toks) < 0.7:
                        continue
                scored.append((best_ratio, cid, best_variant))
        scored.sort(reverse=True)
        if scored and scored[0][0] >= 0.94:
            if len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.03:
                return finish(
                    scored[0][1],
                    "dump_fuzzy",
                    f"unique high-similarity name (ratio={scored[0][0]:.3f})",
                    scored[0][2],
                )
    ror_id = WEB_VERIFIED.get(key)
    if not ror_id:
        if "washington university" in key and any(
            t in key for t in ("genome", "mcdonnell", "washu", "gsc")
        ):
            ror_id = "https://ror.org/01yc7t268"
    if ror_id and ror_id in index.orgs:
        return finish(
            ror_id,
            "web_verified",
            "manual ROR lookup from web/API for leftover high-count names",
            submitter,
        )
    return None


class RorClient:
    def __init__(self, sleep_s: float) -> None:
        self.sleep_s = sleep_s
        self._last_request = 0.0

    def _pace(self) -> None:
        elapsed = time.monotonic() - self._last_request
        if elapsed < self.sleep_s:
            time.sleep(self.sleep_s - elapsed)

    def get_json(self, url: str, max_retries: int = 3) -> dict[str, Any]:
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
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
                if exc.code == 429:
                    retry_after = exc.headers.get("Retry-After")
                    wait = int(retry_after) if retry_after and retry_after.isdigit() else 60
                    eprint(f"Rate limited (429); sleeping {wait}s")
                    time.sleep(wait)
                    continue
                if 500 <= exc.code < 600 and attempt < max_retries:
                    time.sleep(2**attempt)
                    continue
                raise RuntimeError(f"ROR HTTP {exc.code} for {url}") from exc
            except urllib.error.URLError as exc:
                last_err = exc
                if attempt < max_retries:
                    time.sleep(2**attempt)
                    continue
                raise
        raise RuntimeError(f"ROR request failed after retries: {last_err}")


def compact_api_org(org: dict[str, Any]) -> dict[str, Any]:
    country, lat, lon = extract_geo(org)
    entries = []
    for entry in org.get("names") or []:
        value = str(entry.get("value") or "").strip()
        if value:
            entries.append((value, tuple(entry.get("types") or [])))
    rels = org.get("relationships") or []
    return {
        "id": str(org.get("id") or ""),
        "display": ror_display_name(org),
        "name_entries": entries,
        "country": country,
        "lat": lat,
        "lon": lon,
        "status": str(org.get("status") or "active"),
        "types": list(org.get("types") or []),
        "domains": list(org.get("domains") or []),
        "has_wikipedia": any(
            (link.get("type") == "wikipedia") for link in (org.get("links") or [])
        ),
        "n_relationships": len(rels),
    }


def match_api_payload(
    submitter: str,
    payload: dict[str, Any],
    method: str,
    index: RorDumpIndex,
) -> Optional[dict[str, Any]]:
    key = normalize_key(submitter)
    items = payload.get("items") or []
    orgs: list[dict[str, Any]] = []
    for item in items:
        org = item.get("organization") if isinstance(item, dict) and "organization" in item else item
        if isinstance(org, dict) and org.get("id"):
            orgs.append(compact_api_org(org))
    for item in items:
        if isinstance(item, dict) and item.get("chosen") is True:
            org = item.get("organization")
            if isinstance(org, dict):
                compact = compact_api_org(org)
                return hit_record(compact, "affiliation_chosen", "ROR affiliation chosen:true", submitter)
    by_name: dict[str, list[str]] = defaultdict(list)
    org_map = {o["id"]: o for o in orgs}
    for org in orgs:
        for value, _types in org["name_entries"]:
            nkey = normalize_key(value)
            if nkey:
                by_name[nkey].append(org["id"])
    ids = by_name.get(key, [])
    ror_id = pick_org(ids, org_map, index.resolved_counts, index.country_counts)
    if ror_id:
        return hit_record(org_map[ror_id], method, "API result exact name/alias/acronym", submitter)
    if len(orgs) == 1 and method.startswith("query"):
        org = orgs[0]
        names = [normalize_key(v) for v, _ in org["name_entries"]]
        best = max((SequenceMatcher(None, key, n).ratio() for n in names if n), default=0.0)
        if best >= 0.88:
            return hit_record(org, "query_unique_result", f"single API hit with similarity {best:.3f}", submitter)
    return None


def match_via_api(client: RorClient, submitter: str, index: RorDumpIndex) -> Optional[dict[str, Any]]:
    variants = []
    raw = strip_outer_quotes(submitter)
    variants.append(raw)
    cleaned = re.sub(r"\s+", " ", DASH_RE.sub(" ", raw)).strip()
    if cleaned != raw:
        variants.append(cleaned)
    seen: set[str] = set()
    for variant in variants:
        if variant in seen or len(variant) < 3:
            continue
        seen.add(variant)
        aff_url = f"{ROR_BASE}?affiliation={urllib.parse.quote(variant)}"
        aff = client.get_json(aff_url)
        hit = match_api_payload(variant, aff, "affiliation_exact", index)
        if hit:
            if variant != raw:
                hit["match_note"] += f" (query={variant})"
            return hit
        query_url = f"{ROR_BASE}?query={urllib.parse.quote(variant)}"
        query = client.get_json(query_url)
        hit = match_api_payload(variant, query, "query_exact_alias", index)
        if hit:
            if variant != raw:
                hit["match_note"] += f" (query={variant})"
            return hit
    return None


def empty_hit() -> dict[str, Any]:
    return {
        "institute_name_ror": "",
        "ror_id": "",
        "country": "",
        "lat": None,
        "lon": None,
        "match_method": "none",
        "match_note": "",
        "matched_name_variant": "",
    }


def row_from_hit(submitter: str, assembly_count: str, hit: dict[str, Any], category: str) -> dict[str, str]:
    lat = hit.get("lat")
    lon = hit.get("lon")
    has_match = hit.get("match_method") not in (None, "none", "")
    return {
        "submitter_name": submitter,
        "institute_name_ror": hit.get("institute_name_ror") or "",
        "ror_id": hit.get("ror_id") or "",
        "country": hit.get("country") or "",
        "lat": format_coord(lat),
        "lon": format_coord(lon),
        "has_ror_match": bool_str(bool(has_match)),
        "has_coordinates": bool_str(lat is not None and lon is not None),
        "match_method": hit.get("match_method") or "none",
        "assembly_count": str(assembly_count),
        "match_note": hit.get("match_note") or "",
        "likely_category": category,
        "matched_name_variant": hit.get("matched_name_variant") or "",
    }


def write_tsv(path: Path, rows: list[dict[str, str]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=columns,
            delimiter="\t",
            lineterminator="\n",
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(rows)
    eprint(f"Wrote {len(rows)} rows to {path}")


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    root = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(description="Audit unmatched submitter institutes against ROR")
    p.add_argument("--input", type=Path, default=root / "data" / "submitter_institutes.tsv")
    p.add_argument(
        "--unresolved-out",
        type=Path,
        default=root / "data" / "submitter_institutes_unresolved.tsv",
    )
    p.add_argument(
        "--audit-out",
        type=Path,
        default=root / "data" / "submitter_institutes_unresolved_audit.tsv",
    )
    p.add_argument(
        "--still-out",
        type=Path,
        default=root / "data" / "submitter_institutes_unresolved_still.tsv",
    )
    p.add_argument(
        "--ror-dump",
        type=Path,
        default=root / "data" / "raw" / "ror" / "v2.12-2026-08-25-ror-data.zip",
    )
    p.add_argument("--skip-api", action="store_true", help="Do not call ROR API for leftovers")
    p.add_argument("--api-min-count", type=int, default=1, help="Min assembly_count for API fallback")
    p.add_argument("--sleep", type=float, default=0.2)
    p.add_argument("--limit", type=int, default=None)
    return p.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    with args.input.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    unresolved = [r for r in rows if (r.get("has_ror_match") or "").lower() != "true"]
    unresolved.sort(key=lambda r: (-int(r.get("assembly_count") or 0), r["submitter_name"].casefold()))
    write_tsv(args.unresolved_out, unresolved, ORIGINAL_COLUMNS)
    eprint(
        f"Unresolved: {len(unresolved)} / {len(rows)} "
        f"({sum(int(r.get('assembly_count') or 0) for r in unresolved)} assemblies)"
    )

    if not args.ror_dump.exists():
        eprint(f"ROR dump not found: {args.ror_dump}")
        return 1
    resolved_rows = [r for r in rows if (r.get("has_ror_match") or "").lower() == "true"]
    resolved_counts: Counter[str] = Counter(r["ror_id"] for r in resolved_rows if r.get("ror_id"))
    country_counts: Counter[str] = Counter(r["country"] for r in resolved_rows if r.get("country"))
    index = RorDumpIndex(load_ror_dump(args.ror_dump), resolved_counts, country_counts)

    names = unresolved
    if args.limit is not None:
        names = unresolved[: args.limit]

    dump_hits = 0
    pending_api: list[dict[str, str]] = []
    audit_by_name: dict[str, dict[str, str]] = {}
    for i, row in enumerate(names, 1):
        submitter = row["submitter_name"]
        category = likely_category(submitter)
        hit = match_dump(submitter, index)
        if hit:
            dump_hits += 1
            audit_by_name[submitter] = row_from_hit(submitter, row["assembly_count"], hit, category)
        else:
            pending_api.append(row)
        if i == 1 or i % 250 == 0 or i == len(names):
            eprint(f"Dump match {i}/{len(names)}: {dump_hits} resolved so far")

    api_hits = 0
    if not args.skip_api:
        client = RorClient(sleep_s=args.sleep)
        api_targets = [
            r for r in pending_api if int(r.get("assembly_count") or 0) >= args.api_min_count
        ]
        eprint(f"API fallback for {len(api_targets)} unmatched names")
        still: list[dict[str, str]] = []
        for i, row in enumerate(api_targets, 1):
            submitter = row["submitter_name"]
            if i == 1 or i % 25 == 0 or i == len(api_targets):
                eprint(f"API {i}/{len(api_targets)}: {submitter[:80]}")
            try:
                hit = match_via_api(client, submitter, index)
            except Exception as exc:  # noqa: BLE001
                eprint(f"API error for {submitter[:60]}: {exc}")
                hit = None
            category = likely_category(submitter)
            if hit:
                api_hits += 1
                audit_by_name[submitter] = row_from_hit(
                    submitter, row["assembly_count"], hit, category
                )
            else:
                still.append(row)
                audit_by_name[submitter] = row_from_hit(
                    submitter, row["assembly_count"], empty_hit(), category
                )
        skipped = [r for r in pending_api if r not in api_targets]
        for row in skipped:
            audit_by_name[row["submitter_name"]] = row_from_hit(
                row["submitter_name"],
                row["assembly_count"],
                empty_hit(),
                likely_category(row["submitter_name"]),
            )
    else:
        for row in pending_api:
            audit_by_name[row["submitter_name"]] = row_from_hit(
                row["submitter_name"],
                row["assembly_count"],
                empty_hit(),
                likely_category(row["submitter_name"]),
            )

    audit_rows = [audit_by_name[r["submitter_name"]] for r in names]
    write_tsv(args.audit_out, audit_rows, AUDIT_COLUMNS)
    still_rows = [r for r in audit_rows if r["has_ror_match"] != "true"]
    write_tsv(args.still_out, still_rows, AUDIT_COLUMNS)

    matched = [r for r in audit_rows if r["has_ror_match"] == "true"]
    unmatched = [r for r in audit_rows if r["has_ror_match"] != "true"]
    methods = Counter(r["match_method"] for r in audit_rows)
    cats = Counter(r["likely_category"] for r in unmatched)
    eprint("")
    eprint("=== Audit summary ===")
    eprint(f"Previously unresolved: {len(names)}")
    eprint(f"Newly matched:         {len(matched)} ({100 * len(matched) / len(names):.1f}%)")
    eprint(f"  dump: {dump_hits}   api: {api_hits}")
    eprint(f"Still unmatched:       {len(unmatched)}")
    eprint("Methods:")
    for method, count in methods.most_common():
        eprint(f"  {method}: {count}")
    eprint("Still-unmatched categories:")
    for cat, count in cats.most_common():
        eprint(f"  {cat}: {count}")
    eprint("Top remaining unmatched:")
    unmatched.sort(key=lambda r: -int(r["assembly_count"] or 0))
    for row in unmatched[:25]:
        eprint(f"  {row['assembly_count']:>5}  [{row['likely_category']}]  {row['submitter_name']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
