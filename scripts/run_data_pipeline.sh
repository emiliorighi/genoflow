#!/usr/bin/env bash
# Run the genoflow weekly data pipeline end-to-end.
#
# Steps:
#   1. Collect NCBI GenBank eukaryote assemblies + BioSample geo
#   2. Build taxonomic tree via ENA lineages
#   3. Resolve submitter institutes via ROR (requires ROR_CLIENT_ID)
#   4. Build species_flows.parquet for the map
#   5. Build landing-stats.json for the landing page
#
# Usage (from repo root):
#   ROR_CLIENT_ID=... ./scripts/run_data_pipeline.sh
#
# Optional: NCBI_API_KEY is forwarded to collect_eukaryote_assemblies.py if set.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${ROR_CLIENT_ID:-}" ]]; then
  echo "ERROR: ROR_CLIENT_ID must be set (ROR Client-Id header)." >&2
  exit 1
fi

if ! command -v datasets >/dev/null 2>&1; then
  echo "ERROR: NCBI datasets CLI not found on PATH." >&2
  exit 1
fi

echo "=== [1/5] Collect eukaryote assemblies ==="
python3 scripts/collect_eukaryote_assemblies.py

echo "=== [2/5] Build taxonomic tree ==="
python3 scripts/build_taxonomic_tree.py

echo "=== [3/5] Resolve submitter institutes (ROR) ==="
python3 scripts/resolve_submitter_institutes.py --client-id "$ROR_CLIENT_ID"

echo "=== [4/5] Build map parquet ==="
python3 scripts/build_map_dataset.py

echo "=== [5/5] Build landing stats ==="
python3 scripts/build_landing_stats.py

echo "=== Pipeline complete ==="
