# Submitter → institute curation: phased plan

Status: proposal. Nothing in Phases 1–5 is implemented yet; Phase 0 describes what exists today.

## Why this matters

The map and the pull index depend on knowing where each assembly was sequenced. That location comes from resolving the free-text NCBI `assembly_submitter` to an institute (ROR id, country, coordinates). When a submitter is unresolved, its species fall into the "unknown" flow mode and are excluded from the pull index. A wrong match is worse than an unresolved one, because it puts a species in the wrong country and silently changes the numbers.

Baseline measured while curating (24,472 species):

| Stage | Species with unknown submitter location |
|---|---|
| Original pipeline output | 5,695 |
| After the manual overrides (569 rows) | 2,997 |

About 1,271 of the remaining species belong to consortia (VGP, B10K, Canada's national platform, GAGA, Fish10K, Bat1K, Earth BioGenome and similar), which have no single location.

## Principles

1. **No silent thresholds.** Automation may propose; any cutoff that hides or accepts data must be explicit and visible.
2. **A wrong match is worse than a missing one.** Prefer leaving a submitter unresolved over guessing.
3. **Every decision has a recorded reason** (the `note` column), so it can be audited and reversed.
4. **Evidence is probabilistic.** The goal is to catch likely errors early and measure error rates, not to claim certainty.
5. **Domain prior:** every submitting body is expected to be related to biodiversity or genomics. This resolves many acronym ambiguities (CSIC is the Spanish research council, CRG is the Centre for Genomic Regulation in Barcelona, INRA is the French institute now INRAE).

## Phase 0 — Current state (done)

- `data/submitter_institute_overrides.tsv`: 569 manual decisions that win over ROR lookups. A row with an empty `ror_id` forces a submitter to stay unresolved.
- `scripts/resolve_submitter_institutes.py` reads the overrides before any ROR lookup (`--overrides`).
- `.gitignore` tracks the override file.
- Review already done: top matches by assembly count, all safe audit matches, all risky audit matches individually, acronyms checked against ROR homonyms and collection geography, and every ROR id checked against the live ROR API.
- Known wrong automatic matches corrected (for example LA County Public Health Lab matched to a lab in Macao, INRA matched to Morocco, RIKEN matched to a US company, BILS matched to Bronx Independent Living Services).

Open items in this phase: commit and push, then run the data pipeline so the overrides reach the published data.

## Phase 1 — Protect what is curated (small, do first)

Goal: make the existing decisions durable and checked on every change.

1. **Add a `status` column** to the override file (`accepted`, `rejected`, `needs_review`) and a `kind` column (`institute`, `consortium`, `company`). The resolver treats `rejected` as "force unresolved".
2. **Remember rejections.** The audit and any future proposer read the rejected rows and never propose them again (for example IGS → Indiana Geological Survey).
3. **CI validation script** (`scripts/validate_overrides.py`, run in a workflow on changes to the override file) that fails when:
   - a ROR id does not exist or is not active;
   - the name, country or coordinates differ from the live ROR record;
   - there are duplicate submitter names;
   - a country named in the submitter string contradicts the institute country;
   - an acronym row has more than one ROR homonym and no note explaining the choice.

Acceptance: the script reproduces the checks done by hand in this curation and passes on the current file; it would have flagged the 15 stale rows and the Germany/Austria mismatch.

## Phase 2 — Better evidence

Goal: stop relying on the submitter string alone.

1. **BioProject / BioSample ownership.** Pull the submitting organisation, country and contact for each assembly from NCBI. Use it as an independent check on the resolved country.
2. **Second resolver.** Query OpenAlex institution matching (and optionally Wikidata) for each submitter. Record whether it agrees with the ROR result.
3. **Store the evidence** next to each override (agreement flags, evidence country) so review can sort by disagreement.

Acceptance: for the reviewed rows, report how often each evidence source agrees with the accepted decision.

## Phase 3 — Measure precision before automating

Goal: choose any auto-accept rule from data, not from judgement.

1. **Build a gold set** from the ~570 reviewed rows plus the rejected ones.
2. **Define a candidate score** combining: normalized name equality, alias match, acronym uniqueness in ROR, country-hint agreement, ROR organisation type and status, second-resolver agreement, and a genomics/biodiversity keyword prior.
3. **Report precision and recall** of each rule against the gold set, and publish the numbers in the plan or a report file.
4. **Decide the auto-accept rule explicitly** from those numbers. The threshold is a visible config value, not hard-coded.

Acceptance: a written table of rule → precision/recall on the gold set; no auto-accept rule is enabled without one.

## Phase 4 — Wire the audit into the pipeline

Goal: only new, unresolved names need human attention.

1. **Run the audit as a pipeline step** after the resolver. Output: a ranked queue of unresolved submitters (species count first) with candidates and scores.
2. **Auto-accept only rules that passed Phase 3.** Everything else goes to the queue.
3. **Weekly summary** posted as a GitHub issue or PR comment: top unresolved submitters, new auto-accepts, and rows needing review.
4. **Optional LLM triage.** For queued rows, give a model the submitter name, ROR candidates and assembly context (species, collection countries, BioProject). It proposes accept or reject with a reason, and a person confirms. Proposals never write to the override file without confirmation.

Acceptance: a pipeline run on the current data reproduces the current override decisions (or documents each difference) and produces a queue of the remaining unresolved submitters.

## Phase 5 — Consortia and reporting

Goal: represent what cannot be located, and watch for drift.

1. **Consortium category in the app.** Use `kind = consortium` so these species show as "consortium" instead of "unknown" (about 1,271 species at the last count). Optionally record a coordinating institute where one exists.
2. **Weekly change report.** Diff the resolved institutes between pipeline runs: which submitters changed institute, and how many species moved between continents. A large shift in the pull index should be traceable to a curation change.
3. **Sampling audit.** Review a random 5% of newly accepted rows each release and log the outcome. A rising error rate triggers a rule review.

## Order and effort

| Phase | Effort | Depends on |
|---|---|---|
| 0 Commit and run pipeline | minutes | — |
| 1 Status column, rejection memory, CI validation | small | 0 |
| 2 Better evidence | medium | 1 |
| 3 Precision measurement | medium | 2 |
| 4 Audit in the pipeline, LLM triage | medium–large | 3 |
| 5 Consortia in the app, change report, sampling | medium | 1 (consortia kind), 4 (reports) |

Recommended start: Phase 1. It is small, protects the data already curated, and the later phases build on it.

## Risks and open questions

- Collection location is weak evidence, because the data is about cross-border flows; it only helps when exactly one candidate is in the collection country.
- ROR has no record for some real units (for example the Institute for Genome Sciences); those map to the parent institution, which can be coarser than the true submitter.
- Acronyms remain the largest source of uncertainty. Each ambiguous acronym needs either a note or a second source.
- Some data comes from outside our control (NCBI free-text submitters, ROR changes). The CI check in Phase 1 should also run on a schedule, not only on pull requests, so ROR changes are noticed.
- Open question: should consortium species be excluded from the pull index (as unknown is today) or shown as their own category in the rankings?

## Appendix — BioProject-inferred institutes (parked, not wired)

`data/bioproject_inferred_institutes.tsv` holds institutes inferred from NCBI BioProject owner and participating-centre records for consortium assemblies (1,447 assemblies; 631 species would change at the last test, taking unknown from 2,997 to 2,366). Columns: assembly, BioProject, submitter, institute, ROR id, country, coordinates, evidence text, confidence (high or medium).

It is deliberately **not read by any pipeline script**. Next step, when picked up: add provenance columns (`institute_source`, `institute_confidence`, `institute_evidence`) to the dataset, a user-controlled "include inferred" toggle in the app, and measure precision by running the same rules on assemblies whose institute is already resolved directly. Open call: whether to keep the 93 B10K species inferred to Zhejiang University (project owner, but sequenced on a BGI platform).
