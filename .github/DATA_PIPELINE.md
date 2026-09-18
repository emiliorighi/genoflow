# Data pipeline (GitHub Actions)

Weekly refresh of NCBI/ENA/ROR inputs used by Assemblage.

## Workflows

| Workflow | File | Trigger |
|---|---|---|
| Update data pipeline | [`workflows/update-data.yml`](workflows/update-data.yml) | Mondays 04:17 UTC + manual |
| Deploy Assemblage to GitHub Pages | [`workflows/deploy-pages.yml`](workflows/deploy-pages.yml) | Push to `main` + manual (also dispatched after data changes) |

## Required secret

Add this under **Settings → Secrets and variables → Actions**:

| Name | Purpose |
|---|---|
| `ROR_CLIENT_ID` | ROR API `Client-Id` header for `scripts/resolve_submitter_institutes.py` |

Without it, the update workflow fails at the "Require ROR_CLIENT_ID secret" step.

## Local run

```bash
export ROR_CLIENT_ID=...   # same value as the GitHub secret
# optional: export NCBI_API_KEY=...
./scripts/run_data_pipeline.sh
```

Requires the NCBI `datasets` CLI on `PATH` and `pip install -r scripts/requirements.txt`.

## What gets committed

When the pipeline detects changes, it commits:

- `data/eukaryote_assemblies.tsv`
- `data/taxonomic_tree.tsv`
- `data/submitter_institutes.tsv`
- `data/raw/ena_taxonomy_nodes.jsonl`
- `data/raw/ror_submitter_cache.jsonl`
- `assemblage/public/data/species_flows.parquet`
- `assemblage/public/data/landing-stats.json`

Then it dispatches `deploy-pages.yml` so Pages rebuilds only when data changed.

`scripts/audit_unresolved_institutes.py` remains manual (not run in CI).
