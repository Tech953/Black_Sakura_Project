---
name: Engram initiative & human-contact policy
description: Non-obvious safety semantics of the engram autonomy/human-contact policy layer (quiet mode, fail-closed modes, anti-coercion).
---

# Engram initiative & human-contact policy

The single keystone for "what may an engram do autonomously" is the pure module
`artifacts/api-server/src/lib/engram-policy.ts` (`capabilitiesFor` / `decideHumanContact`).
Every engine gating decision routes through it so rules stay unit-testable and can't be
silently bypassed.

## Quiet mode is NOT a full silence
- **Rule:** global quiet mode RAISES the human-contact bar to `urgent` (urgent still
  delivers; meaningful/social are held by the priority gate). It does **not** set
  `canContactHuman=false`.
- **Why:** the operator-facing terminal promises "only urgent messages reach you" — if
  quiet mode killed urgent too, an engram with a genuine urgent signal would be silently
  dropped, which is a safety mismatch.
- **The absolute off switch is per-engram `humanContactEnabled=false`** — that one fully
  disables human contact regardless of priority. Don't conflate the two.

## Unknown engram mode fails closed
- **Rule:** an unrecognized `mode` string in `capabilitiesFor` returns fully `blocked`
  (no idle / converse / human contact) — same as `quiescent`. Do NOT let it fall through
  to the most-permissive `full_bounded`.
- **Why:** mode is a safety control; a typo or stale value must never grant maximum
  autonomy. Known modes: orientation, social, simulation, initiative_limited,
  full_bounded, quiescent.

## Anti-coercion is structural first, heuristic second
- The real guarantee is structural: **no engine code path lets one engram's turn mutate
  another engram's row.** Commons output is inert text persisted as a message; only the
  speaker's own engine state updates.
- `detectCoercion` (regex identity-attack scan) is an AUDIT/refusal layer only — never
  relied on as a security boundary. A flagged turn is refused + logged as a blocked
  message, but even if it slipped through it could not change another engram.

## Channel scoping
- `markMessagesSeen` filters to `channel='human'` in its predicate — commons/audit
  messages can never be flipped to seen via the terminal even if their ids are supplied.
- The expression `intimacy` axis sanitization rule (platonic-only prompts) still applies
  project-wide and is unrelated to this policy.

## Human-started group continuation
- **Rule:** autonomous continuation inside a human-started group chat is request-scoped,
  sequential, and hard-capped. Re-read persisted autonomy, global controls, mode, and
  Hub presence before every attempted peer turn; never hand the conversation to a
  background in-memory loop.
- **Why:** the human may invite peer interaction without consenting to an indefinite
  exchange, and a restart/disconnect must stop work rather than resetting a cadence
  guard and resuming generation.
- **How to apply:** keep the initial one-response-per-participant pass distinct from
  autonomous follow-ups. Persist the speaker's own utterance as remembered experience
  and peers' direct perception as observed experience; coercive output is audit-only.
