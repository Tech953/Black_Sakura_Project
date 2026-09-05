import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { SYSTEM_OWNER_ID } from "./accounts";

/**
 * The kind of a Hub space. Each kind carries different default scope/logging
 * semantics, but those are stored explicitly per-row so a space can be tuned.
 */
export const HUB_SPACE_KINDS = [
  "commons",
  "private_room",
  "simulation_chamber",
  "studio",
  "archive",
  "terminal",
  "quiescence",
] as const;
export type HubSpaceKind = (typeof HUB_SPACE_KINDS)[number];

/** Who can see what happens inside a space. Stored + surfaced; not auth-enforced yet. */
export const HUB_VISIBILITY_SCOPES = ["public", "occupants", "operators"] as const;
export type HubVisibilityScope = (typeof HUB_VISIBILITY_SCOPES)[number];

/** What an engram may do inside a space. Only the no-initiative ("rest") restriction is engine-enforced now. */
export const HUB_ACTION_SCOPES = [
  "converse",
  "reflect",
  "simulate",
  "generate",
  "contact",
  "observe",
  "rest",
] as const;
export type HubActionScope = (typeof HUB_ACTION_SCOPES)[number];

/**
 * A persistent space inside the shared Hub. Spaces are seeded reference data: a
 * fixed social/operational layer (commons, private rooms, chambers, archive,
 * terminal, quiescence) that engrams move between. Each space stores its own
 * visibility scope, action scope, and logging rule.
 */
export const hubSpacesTable = pgTable(
  "hub_spaces",
  {
    id: serial("id").primaryKey(),
    /** Account that owns this Hub's private copy of the space template. */
    ownerId: text("owner_id").notNull().default(SYSTEM_OWNER_ID),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** One of HUB_SPACE_KINDS. */
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    /** One of HUB_VISIBILITY_SCOPES. */
    visibilityScope: text("visibility_scope").notNull(),
    /** One of HUB_ACTION_SCOPES. */
    actionScope: text("action_scope").notNull(),
    /** Whether movements/events inside this space are written to the archive. */
    logged: boolean("logged").notNull().default(true),
    /** Whether engrams present here may self-initiate. False = a rest/quiescence zone. */
    allowsInitiative: boolean("allows_initiative").notNull().default(true),
    /** Display ordering in the Hub view. */
    sortOrder: integer("sort_order").notNull().default(0),
    /** Optional ambient flavor text for the space. */
    ambient: text("ambient"),
    /** Optional Tailwind/text accent token used by the dashboard. */
    accent: text("accent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("hub_spaces_owner_sort_idx").on(t.ownerId, t.sortOrder),
    uniqueIndex("hub_spaces_owner_slug_unique").on(t.ownerId, t.slug),
  ],
);

export const insertHubSpaceSchema = createInsertSchema(hubSpacesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertHubSpace = z.infer<typeof insertHubSpaceSchema>;
export type HubSpace = typeof hubSpacesTable.$inferSelect;
export type NewHubSpace = typeof hubSpacesTable.$inferInsert;
