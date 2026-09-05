---
name: Persona source authority
description: Trust-boundary rules for turning mixed-authority source material into persona memory and prompts.
---

Curated persona evidence must retain an exact source identity and authority class from ingestion through persistence and prompt rendering. Rank the trusted evidence by source authority rather than generic world-model provenance, and label alternate, contextual, and uncertain material in every prompt surface it influences. Canonical authority rows must be loaded outside ordinary recency windows and receive prompt budget before generic history.

**Why:** Category labels in content are not enough. Generic provenance ordering can put weaker lore ahead of primary characterization, and a user-writable source string can impersonate a privileged category unless the accepted keys are exact and their namespace is reserved from public writes.

**How to apply:** For any new source-grounded persona enrichment, put source identity, authority, and key encoding in one dependency-free closed registry consumed by seeding and prompt code. Reject drift instead of silently overwriting seed rows, block API creation or mutation in the seed namespace, and seed equivalent source-backed rows on cloud and mobile. Scope duplicate/drift validation to the canonical registry so repeated ordinary user labels remain valid. Keep crossover-only behavior out of unlabeled profile fields.