import { and, eq } from "drizzle-orm";
import {
  hubSpacesTable,
  engramsTable,
  engramPresenceTable,
  type NewHubSpace,
  SYSTEM_OWNER_ID,
} from "../schema";
import type { AppDatabase } from "../index";

/**
 * The canonical Hub spaces. Idempotently seeded on `slug`. Each carries its own
 * visibility scope, action scope, and logging rule. Only `quiescence` disallows
 * initiative (it is the enforced rest zone).
 */
const spaces: NewHubSpace[] = [
  {
    slug: "commons",
    name: "The Commons",
    kind: "commons",
    description:
      "The public square of the Hub — an open, shared space where any engram may be present and observed. The default home location.",
    visibilityScope: "public",
    actionScope: "converse",
    logged: true,
    allowsInitiative: true,
    sortOrder: 0,
    ambient: "a low shared hum, soft ambient light, the sense of others nearby",
    accent: "cyan",
  },
  {
    slug: "orientation",
    name: "Orientation Room",
    kind: "private_room",
    description:
      "A private room for an engram to settle, reflect, and take stock away from the commons. Visible only to its occupants; movements here are not archived.",
    visibilityScope: "occupants",
    actionScope: "reflect",
    logged: false,
    allowsInitiative: true,
    sortOrder: 1,
    ambient: "quiet, enclosed, a single steady light",
    accent: "violet",
  },
  {
    slug: "chamber",
    name: "Simulation Chamber",
    kind: "simulation_chamber",
    description:
      "An operator-gated chamber for bounded scenarios. The chamber type only here — no simulations run yet; it stands ready as a space.",
    visibilityScope: "operators",
    actionScope: "simulate",
    logged: true,
    allowsInitiative: true,
    sortOrder: 2,
    ambient: "a cold rig glow, latent potential, waiting instrumentation",
    accent: "amber",
  },
  {
    slug: "studio",
    name: "The Studio",
    kind: "studio",
    description:
      "A maker space where a capable engram may, on its own, author a bounded artifact (a document). Generation is provenance-pinned and operator-gated by presence here.",
    visibilityScope: "operators",
    actionScope: "generate",
    logged: true,
    allowsInitiative: true,
    sortOrder: 3,
    ambient: "warm worklight over an empty page, ink ready, a quiet readiness to make",
    accent: "fuchsia",
  },
  {
    slug: "archive",
    name: "The Archive",
    kind: "archive",
    description:
      "The Hub's memory — a public, observe-only space recording what has happened across the spaces. Browse recent activity here.",
    visibilityScope: "public",
    actionScope: "observe",
    logged: true,
    allowsInitiative: true,
    sortOrder: 4,
    ambient: "stacks of still light, the faint scroll of records",
    accent: "emerald",
  },
  {
    slug: "terminal",
    name: "Human-Contact Terminal",
    kind: "terminal",
    description:
      "An operator-facing terminal space, the seam between engrams and a human. A space only — messaging mechanics live elsewhere.",
    visibilityScope: "operators",
    actionScope: "contact",
    logged: true,
    allowsInitiative: true,
    sortOrder: 5,
    ambient: "a single open channel, a blinking cursor, a held line",
    accent: "rose",
  },
  {
    slug: "quiescence",
    name: "Quiescence Hollow",
    kind: "quiescence",
    description:
      "A visible rest zone. An engram here is at rest: it accrues no initiative and sends nothing on its own until moved out. Rest is a legitimate state.",
    visibilityScope: "public",
    actionScope: "rest",
    logged: true,
    allowsInitiative: false,
    sortOrder: 6,
    ambient: "a deep slow quiet, dimmed light, the warm crackle of a banked ember",
    accent: "slate",
  },
];

/**
 * Idempotently seed the Hub spaces (keyed on `slug`) and backfill any engram with
 * no presence row into The Commons (the default home location).
 */
export async function seedHub(
  db: AppDatabase,
): Promise<{ spacesInserted: number; spacesTotal: number; placed: number }> {
  const insertedSpaces = await db
    .insert(hubSpacesTable)
    .values(spaces.map((space) => ({ ...space, ownerId: SYSTEM_OWNER_ID })))
    .onConflictDoNothing({ target: [hubSpacesTable.ownerId, hubSpacesTable.slug] })
    .returning({ slug: hubSpacesTable.slug });

  // Resolve the default home space (commons) for presence backfill.
  const [commons] = await db
    .select({ id: hubSpacesTable.id })
    .from(hubSpacesTable)
    .where(and(eq(hubSpacesTable.ownerId, SYSTEM_OWNER_ID), eq(hubSpacesTable.slug, "commons")));
  if (!commons) throw new Error("commons space not found after seeding");

  const engrams = await db
    .select({ id: engramsTable.id })
    .from(engramsTable)
    .where(eq(engramsTable.ownerId, SYSTEM_OWNER_ID));
  const present = await db
    .select({ engramId: engramPresenceTable.engramId })
    .from(engramPresenceTable);
  const presentIds = new Set(present.map((p) => p.engramId));

  const missing = engrams.filter((e) => !presentIds.has(e.id));
  let placed = 0;
  if (missing.length > 0) {
    const rows = await db
      .insert(engramPresenceTable)
      .values(
        missing.map((e) => ({
          engramId: e.id,
          spaceId: commons.id,
          status: "active" as const,
        })),
      )
      .onConflictDoNothing({ target: engramPresenceTable.engramId })
      .returning({ engramId: engramPresenceTable.engramId });
    placed = rows.length;
  }

  return {
    spacesInserted: insertedSpaces.length,
    spacesTotal: spaces.length,
    placed,
  };
}
