---
name: Expression layer safety boundary
description: How PYRI's QUERTY micro-expression vocabulary is kept safe when fed to the chat model.
---

# Expression layer safety boundary

PYRI's emotive "QUERTY micro-expression" library (ASCII affect glyphs) carries an
affect/intimacy axis (`intimacy` 0–3) derived from the source framework. The user asked
for the axis to be represented **faithfully** in the catalog data and UI, but PYRI must
**never** produce sexual or romantic content.

**Rule — separate storage from prompt exposure:**
- Store the full data faithfully in the DB and show it in the Hiero-Code page UI.
- When injecting the vocabulary into the chat **system prompt**, sanitize it: filter to
  low-intimacy glyphs only (`intimacy <= 1`) and describe each glyph with **neutral
  structural metadata** (name + valence/arousal + `cognitiveRole`), never the free-text
  `notes` (which contain romantic-tinged prose like "kissy", "love-struck", "longing").
- Keep mode policies platonic (Companion conveys "warmth/rapport", not "affection").

**Why:** the raw `notes` and high-intimacy entries prime romantic/sexual semantics even
with a trailing "stay platonic" instruction. The architect flagged direct `notes`
injection as a safety failure; neutralizing the prompt-facing wording fixes it without
sacrificing catalog fidelity.

**How to apply:** any future change to how expressions feed the LLM must go through the
sanitizing path in the chat prompt builder — do not pass `notes` or `intimacy > 1` glyphs
to the model.

**Role validation boundary:** keep the canonical neutral-role values in a DB-free shared
module consumed by both database validation and `engram-core` prompt filtering. Ordinary
insert/update schemas accept only neutral roles or null; the curated seed schema also
accepts the single stored-only `attachment` role so the catalog remains faithful without
making that role writable through future management paths.

**Why:** `engram-core` also runs in the mobile offline client, so importing a database
schema module into prompt code would pull persistence concerns into a shared runtime.
Separately, the seed's `attachment` row is intentionally retained for catalog fidelity
but must remain unavailable to ordinary writes and prompt metadata.

**How to apply:** add new role values once in the DB-free registry, then decide explicitly
whether each is promptable or seed-only. Reuse the registry in Zod schemas and prompt
filtering; do not copy its role lists into API routes or scripts.
