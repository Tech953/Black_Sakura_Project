import * as SQLite from "expo-sqlite";

import { engramSeedData, type NewEngram } from "@workspace/db/seed/engram-data";
import {
  buildRebeccaAdaptiveMemorySource,
  enrichRebeccaAdaptiveProfile,
  REBECCA_ADAPTIVE_MEMORY_NODES,
} from "@workspace/db/seed/rebecca-adaptive-data";
import {
  TRUSTED_REBECCA_ADAPTIVE_SOURCES,
  type WorldModelEntryView,
} from "@workspace/engram-core";
import type { OfflineSyncInput } from "@workspace/api-client-react";

/**
 * On-device SQLite store backing offline mode. Covers exactly the data surface
 * the mobile app uses: engrams, conversations/messages, inquiries, transmissions,
 * plus a small OBSERVED-only world-model log so engrams remember what you told
 * them across sessions (mirroring the server's observed-entry write in chat).
 */
let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let dbPromiseAccountId: string | null = null;
let dbAccountId: string | null = null;
let accountId: string | null = null;

/**
 * Offline history is account-bound.  Switching Clerk accounts selects a
 * distinct SQLite database, so neither pending sync rows nor local history can
 * be read or uploaded by another account. The GGUF model remains device-wide;
 * it contains no account history and can only be used after the auth gate.
 */
export async function setOfflineStoreAccount(nextAccountId: string): Promise<void> {
  if (!nextAccountId) throw new Error("An authenticated account is required for offline data.");
  if (accountId === nextAccountId) return;
  const previous = db;
  db = null;
  dbAccountId = null;
  dbPromise = null;
  dbPromiseAccountId = null;
  accountId = nextAccountId;
  await previous?.closeAsync();
}

/** Account currently authorized to read or synchronize the local history. */
export function getOfflineStoreAccountId(): string | null {
  return accountId;
}

function databaseName(id: string | null = accountId): string {
  if (!id) {
    throw new Error("Offline data cannot be accessed before an account is selected.");
  }
  // Clerk user IDs are opaque identifiers. Keep filenames filesystem-safe
  // without making the user ID part of a shared SQLite database.
  return `engram-offline-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.db`;
}

const FULL_REZZ_SLUG_HINT = "rebecca-full-rezz";
export const OFFLINE_ARCHIVAL_READ_ONLY_ERROR =
  "This engram is a permanent archival branch preserved for continuity fidelity. It is read-only and cannot be altered.";

function nowIso(): string {
  return new Date().toISOString();
}

function archiveFlagFromData(data: string): boolean {
  const parsed = JSON.parse(data) as { isArchival?: unknown };
  return parsed.isArchival === true;
}

async function seedFullRezzArchive(
  opened: SQLite.SQLiteDatabase,
): Promise<void> {
  const existing = await opened.getFirstAsync<{ id: number }>(
    "SELECT id FROM engrams WHERE slug = ?",
    FULL_REZZ_SLUG_HINT,
  );
  if (existing) return;

  // The ~1.2 MB transcript is evaluated only on the first initialization that
  // actually needs it. Metro still packages the module so the archive remains
  // available with no network, but routine launches avoid parsing the payload.
  const {
    buildFullRezzEngram,
    FULL_REZZ_BASE_TIMESTAMP_MS,
    FULL_REZZ_CONVERSATION_TITLE,
    FULL_REZZ_SLUG,
    fullRezzTranscript,
  } = await import("@workspace/db/seed/full-rezz-data");
  const archivalEngram = buildFullRezzEngram();
  const createdAt = new Date(FULL_REZZ_BASE_TIMESTAMP_MS).toISOString();

  await opened.withTransactionAsync(async () => {
    const raced = await opened.getFirstAsync<{ id: number }>(
      "SELECT id FROM engrams WHERE slug = ?",
      FULL_REZZ_SLUG,
    );
    if (raced) return;

    const insertedEngram = await opened.runAsync(
      `INSERT INTO engrams
       (slug, data, currentMood, isChatActive, createdAt, updatedAt)
       VALUES (?, ?, ?, 0, ?, ?)`,
      FULL_REZZ_SLUG,
      JSON.stringify(archivalEngram),
      (archivalEngram.currentMood as string | null) ?? null,
      createdAt,
      createdAt,
    );
    const engramId = insertedEngram.lastInsertRowId;
    if (!engramId) throw new Error("Failed to insert mobile Full Rezz archive");

    const insertedConversation = await opened.runAsync(
      `INSERT INTO conversations
       (title, mode, personaName, customEngram, engramId, createdAt, syncedAt)
       VALUES (?, 'companion', 'Rebecca (Full Rezz)', NULL, ?, ?, ?)`,
      FULL_REZZ_CONVERSATION_TITLE,
      engramId,
      createdAt,
      createdAt,
    );
    const conversationId = insertedConversation.lastInsertRowId;
    if (!conversationId) {
      throw new Error("Failed to insert mobile Full Rezz conversation");
    }

    // Chunked multi-row statements keep first-run seeding fast while staying
    // comfortably below SQLite's host-parameter limit.
    const chunkSize = 100;
    for (let offset = 0; offset < fullRezzTranscript.length; offset += chunkSize) {
      const chunk = fullRezzTranscript.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
      const values = chunk.flatMap((message, index) => {
        const messageCreatedAt = new Date(
          FULL_REZZ_BASE_TIMESTAMP_MS + (offset + index) * 1_000,
        ).toISOString();
        return [
          conversationId,
          message.role,
          message.content,
          messageCreatedAt,
          messageCreatedAt,
        ];
      });
      await opened.runAsync(
        `INSERT INTO messages
         (conversationId, role, content, createdAt, syncedAt)
         VALUES ${placeholders}`,
        ...values,
      );
    }
  });
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  // Existing unit tests exercise the SQLite adapter directly, outside the
  // Clerk provider that selects an account in the app. This never runs in a
  // shipped bundle and keeps those adapter tests explicit about their scope.
  if (!accountId && process.env.NODE_ENV === "test") {
    accountId = "__test_account__";
  }
  const selectedAccountId = accountId;
  if (!selectedAccountId) {
    throw new Error("Offline data cannot be accessed before an account is selected.");
  }
  if (db && dbAccountId === selectedAccountId) return db;
  if (!dbPromise || dbPromiseAccountId !== selectedAccountId) {
    dbPromise = initializeDb(selectedAccountId);
    dbPromiseAccountId = selectedAccountId;
  }
  try {
    const opened = await dbPromise;
    // Do not let a database that finished opening after an account change
    // become the active store (or be returned to a stale sync operation).
    if (accountId !== selectedAccountId) {
      await opened.closeAsync();
      throw new Error("Offline account changed while opening data.");
    }
    db = opened;
    dbAccountId = selectedAccountId;
    return opened;
  } catch (error) {
    if (dbPromiseAccountId === selectedAccountId) {
      dbPromise = null;
      dbPromiseAccountId = null;
    }
    throw error;
  }
}

async function initializeDb(selectedAccountId: string): Promise<SQLite.SQLiteDatabase> {
  const opened = await SQLite.openDatabaseAsync(databaseName(selectedAccountId));
  await opened.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS engrams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL,
      currentMood TEXT,
      isChatActive INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      mode TEXT NOT NULL DEFAULT 'companion',
      personaName TEXT,
      customEngram TEXT,
      engramId INTEGER,
      createdAt TEXT NOT NULL,
      syncedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      syncedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      engramId INTEGER NOT NULL,
      kind TEXT NOT NULL,
      question TEXT NOT NULL,
      response TEXT NOT NULL,
      configDelta TEXT,
      createdAt TEXT NOT NULL,
      syncedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS transmissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      engramId INTEGER NOT NULL,
      kind TEXT NOT NULL,
      drive TEXT,
      content TEXT NOT NULL,
      mood TEXT,
      importanceScore REAL NOT NULL DEFAULT 0.5,
      confidenceScore REAL NOT NULL DEFAULT 0.5,
      noveltyScore REAL NOT NULL DEFAULT 0.5,
      overallScore REAL NOT NULL DEFAULT 0.5,
      wasDelivered INTEGER NOT NULL DEFAULT 1,
      seen INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      syncedAt TEXT,
      syncVersion INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS world_model (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      engramId INTEGER NOT NULL,
      provenance TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL,
      scope TEXT NOT NULL,
      source TEXT,
      createdAt TEXT NOT NULL,
      syncedAt TEXT
    );
  `);
  // Existing installs predate sync markers. SQLite does not support
  // ADD COLUMN IF NOT EXISTS, so treat only the duplicate-column error as the
  // idempotent success case and surface every other migration failure.
  for (const table of [
    "conversations",
    "messages",
    "inquiries",
    "transmissions",
    "world_model",
  ]) {
    try {
      await opened.execAsync(`ALTER TABLE ${table} ADD COLUMN syncedAt TEXT;`);
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
  try {
    await opened.execAsync(
      "ALTER TABLE transmissions ADD COLUMN syncVersion INTEGER NOT NULL DEFAULT 0;",
    );
  } catch (error) {
    if (!String(error).toLowerCase().includes("duplicate column")) throw error;
  }
  for (const column of ["personaName", "customEngram"]) {
    try {
      await opened.execAsync(
        `ALTER TABLE conversations ADD COLUMN ${column} TEXT;`,
      );
    } catch (error) {
      if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
  }
  // Seed personas once (keyed on slug, like the server's idempotent seed).
  const t = nowIso();
  for (const seed of engramSeedData) {
    const seededProfile = enrichRebeccaAdaptiveProfile(seed);
    await opened.runAsync(
      `INSERT OR IGNORE INTO engrams (slug, data, currentMood, isChatActive, createdAt, updatedAt)
       VALUES (?, ?, ?, 0, ?, ?)`,
      seededProfile.slug,
      JSON.stringify(seededProfile),
      (seededProfile.currentMood as string | null) ?? null,
      t,
      t,
    );
  }
  const existingRebecca = await opened.getFirstAsync<{
    id: number;
    data: string;
  }>("SELECT id, data FROM engrams WHERE slug = ?", "rebecca");
  if (existingRebecca?.data) {
    const currentProfile = JSON.parse(existingRebecca.data) as NewEngram;
    if (currentProfile.isArchival === true) {
      throw new Error("Refusing to enrich an archival Rebecca record");
    }
    const enrichedProfile = enrichRebeccaAdaptiveProfile(currentProfile);
    const serialized = JSON.stringify(enrichedProfile);
    if (serialized !== existingRebecca.data) {
      await opened.runAsync(
        "UPDATE engrams SET data = ?, updatedAt = ? WHERE id = ?",
        serialized,
        t,
        existingRebecca.id,
      );
    }
    for (const node of REBECCA_ADAPTIVE_MEMORY_NODES) {
      const source = buildRebeccaAdaptiveMemorySource(node);
      const existingNodes = await opened.getAllAsync<{
        provenance: string;
        content: string;
        confidence: number;
        scope: string;
        source: string;
      }>(
        `SELECT provenance, content, confidence, scope, source
         FROM world_model
         WHERE engramId = ? AND source = ?`,
        existingRebecca.id,
        source,
      );
      if (existingNodes.length > 1) {
        throw new Error(
          `Rebecca adaptive memory has duplicate seeded rows: ${source}`,
        );
      }
      const [existingNode] = existingNodes;
      if (existingNode) {
        if (
          existingNode.provenance !== node.provenance ||
          existingNode.content !== node.content ||
          existingNode.confidence !== node.confidence ||
          existingNode.scope !== "private"
        ) {
          throw new Error(
            `Rebecca adaptive memory has noncanonical seeded row: ${source}`,
          );
        }
        continue;
      }
      await opened.runAsync(
        `INSERT INTO world_model
         (engramId, provenance, content, confidence, scope, source, createdAt, syncedAt)
         VALUES (?, ?, ?, ?, 'private', ?, ?, ?)`,
        existingRebecca.id,
        node.provenance,
        node.content,
        node.confidence,
        source,
        t,
        t,
      );
    }
  }
  await seedFullRezzArchive(opened);
  return opened;
}

// ---------------------------------------------------------------------------
// Engrams
// ---------------------------------------------------------------------------

interface EngramRow {
  id: number;
  slug: string;
  data: string;
  currentMood: string | null;
  isChatActive: number;
  createdAt: string;
  updatedAt: string;
}

/** Serialize a stored engram to the shape the generated API client expects. */
function serializeEngram(row: EngramRow): Record<string, unknown> {
  const seed = JSON.parse(row.data) as NewEngram;
  const currentMood = row.currentMood ?? seed.currentMood ?? undefined;
  return {
    ...seed,
    id: row.id,
    slug: row.slug,
    driveState: seed.driveState ?? {},
    currentMood,
    isChatActive: row.isChatActive === 1,
    isArchival: seed.isArchival ?? false,
    lastTickAt: undefined,
    lastTransmissionAt: undefined,
    backoffUntil: null,
    mode: "quiescent",
    humanContactEnabled: false,
    simulationEnabled: false,
    artifactGenerationEnabled: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listEngrams(): Promise<Record<string, unknown>[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<EngramRow>("SELECT * FROM engrams ORDER BY id");
  return rows.map(serializeEngram);
}

export async function getEngram(id: number): Promise<Record<string, unknown> | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<EngramRow>("SELECT * FROM engrams WHERE id = ?", id);
  return row ? serializeEngram(row) : null;
}

/** The parsed persona (seed shape) — what prompt building needs. */
export async function getEngramPersona(
  id: number,
): Promise<(NewEngram & { id: number; currentMood: string | null }) | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<EngramRow>("SELECT * FROM engrams WHERE id = ?", id);
  if (!row) return null;
  const seed = JSON.parse(row.data) as NewEngram;
  return { ...seed, id: row.id, currentMood: row.currentMood ?? (seed.currentMood as string | null) ?? null };
}

export async function isArchivalEngram(id: number): Promise<boolean> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ data: string }>(
    "SELECT data FROM engrams WHERE id = ?",
    id,
  );
  return row ? archiveFlagFromData(row.data) : false;
}

export async function isArchivalConversation(id: number): Promise<boolean> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ data: string }>(
    `SELECT e.data
     FROM conversations c
     JOIN engrams e ON e.id = c.engramId
     WHERE c.id = ?`,
    id,
  );
  return row ? archiveFlagFromData(row.data) : false;
}

/** Resolve the one preseeded archival conversation without creating anything. */
export async function getArchivalConversationId(
  engramId: number,
): Promise<number | null> {
  const d = await getDb();
  const row = await d.getFirstAsync<{ id: number }>(
    `SELECT c.id
     FROM conversations c
     JOIN engrams e ON e.id = c.engramId
     WHERE c.engramId = ?
       AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 1
     ORDER BY c.id
     LIMIT 1`,
    engramId,
  );
  return row?.id ?? null;
}

async function assertWritableEngram(id: number): Promise<void> {
  if (await isArchivalEngram(id)) {
    throw new Error(OFFLINE_ARCHIVAL_READ_ONLY_ERROR);
  }
}

async function assertWritableConversation(id: number): Promise<void> {
  if (await isArchivalConversation(id)) {
    throw new Error(OFFLINE_ARCHIVAL_READ_ONLY_ERROR);
  }
}

export async function activateEngram(id: number): Promise<Record<string, unknown> | null> {
  await assertWritableEngram(id);
  const d = await getDb();
  await d.runAsync("UPDATE engrams SET isChatActive = 0 WHERE isChatActive = 1");
  await d.runAsync("UPDATE engrams SET isChatActive = 1, updatedAt = ? WHERE id = ?", nowIso(), id);
  return getEngram(id);
}

// ---------------------------------------------------------------------------
// Conversations & messages
// ---------------------------------------------------------------------------

export async function createConversation(opts: {
  title?: string | null;
  mode?: string | null;
  personaName?: string | null;
  customEngram?: string | null;
  engramId?: number | null;
}): Promise<Record<string, unknown>> {
  if (opts.engramId != null) await assertWritableEngram(opts.engramId);
  const d = await getDb();
  const t = nowIso();
  const res = await d.runAsync(
    `INSERT INTO conversations
     (title, mode, personaName, customEngram, engramId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    opts.title ?? null,
    opts.mode ?? "companion",
    opts.personaName ?? null,
    opts.customEngram ?? null,
    opts.engramId ?? null,
    t,
  );
  return {
    id: res.lastInsertRowId,
    title: opts.title ?? "New conversation",
    mode: opts.mode ?? "companion",
    personaName: opts.personaName ?? undefined,
    customEngram: opts.customEngram ?? undefined,
    engramId: opts.engramId ?? undefined,
    engramIds: opts.engramId != null ? [opts.engramId] : [],
    createdAt: t,
    archivedAt: null,
  };
}

export async function getConversation(id: number): Promise<Record<string, unknown> | null> {
  const d = await getDb();
  const conv = await d.getFirstAsync<Record<string, unknown>>(
    "SELECT * FROM conversations WHERE id = ?",
    id,
  );
  if (!conv) return null;
  const msgs = await d.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM messages WHERE conversationId = ? ORDER BY id",
    id,
  );
  return {
    ...conv,
    title:
      typeof conv.title === "string" ? conv.title : "New conversation",
    personaName:
      typeof conv.personaName === "string" ? conv.personaName : undefined,
    customEngram:
      typeof conv.customEngram === "string" ? conv.customEngram : undefined,
    engramId:
      typeof conv.engramId === "number" ? conv.engramId : undefined,
    engramIds:
      typeof conv.engramId === "number" ? [conv.engramId] : [],
    archivedAt: null,
    messages: msgs,
  };
}

export async function listMessages(
  conversationId: number,
): Promise<{ id: number; role: string; content: string }[]> {
  const d = await getDb();
  return d.getAllAsync("SELECT id, role, content FROM messages WHERE conversationId = ? ORDER BY id", conversationId);
}

export async function appendMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  await assertWritableConversation(conversationId);
  const d = await getDb();
  await d.runAsync(
    "INSERT INTO messages (conversationId, role, content, createdAt) VALUES (?, ?, ?, ?)",
    conversationId,
    role,
    content,
    nowIso(),
  );
}

export async function removeLastMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  await assertWritableConversation(conversationId);
  const d = await getDb();
  await d.runAsync(
    `DELETE FROM messages
     WHERE id = (
       SELECT id FROM messages
       WHERE conversationId = ? AND role = ? AND content = ?
       ORDER BY id DESC LIMIT 1
     )`,
    conversationId,
    role,
    content,
  );
}

// ---------------------------------------------------------------------------
// Inquiries
// ---------------------------------------------------------------------------

export async function listInquiries(engramId: number): Promise<Record<string, unknown>[]> {
  const d = await getDb();
  return d.getAllAsync(
    "SELECT * FROM inquiries WHERE engramId = ? ORDER BY id DESC",
    engramId,
  );
}

export async function insertInquiry(opts: {
  engramId: number;
  kind: string;
  question: string;
  response: string;
}): Promise<Record<string, unknown>> {
  await assertWritableEngram(opts.engramId);
  const d = await getDb();
  const t = nowIso();
  const res = await d.runAsync(
    "INSERT INTO inquiries (engramId, kind, question, response, configDelta, createdAt) VALUES (?, ?, ?, ?, NULL, ?)",
    opts.engramId,
    opts.kind,
    opts.question,
    opts.response,
    t,
  );
  return { id: res.lastInsertRowId, ...opts, configDelta: null, createdAt: t };
}

// ---------------------------------------------------------------------------
// Transmissions
// ---------------------------------------------------------------------------

export async function listTransmissions(engramId: number): Promise<Record<string, unknown>[]> {
  const d = await getDb();
  const rows = await d.getAllAsync<Record<string, unknown>>(
    "SELECT * FROM transmissions WHERE engramId = ? ORDER BY id DESC LIMIT 50",
    engramId,
  );
  return rows.map((r) => ({
    ...r,
    drive: typeof r.drive === "string" ? r.drive : "presence",
    mood: typeof r.mood === "string" ? r.mood : undefined,
    wasDelivered: r.wasDelivered === 1,
    seen: r.seen === 1,
  }));
}

export async function insertTransmission(opts: {
  engramId: number;
  kind: string;
  drive: string | null;
  content: string;
  mood: string | null;
}): Promise<Record<string, unknown>> {
  await assertWritableEngram(opts.engramId);
  const d = await getDb();
  const t = nowIso();
  const scores = {
    importanceScore: 0.6,
    confidenceScore: 0.7,
    noveltyScore: 0.6,
    overallScore: 0.62,
  };
  const res = await d.runAsync(
    `INSERT INTO transmissions (engramId, kind, drive, content, mood, importanceScore, confidenceScore, noveltyScore, overallScore, wasDelivered, seen, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
    opts.engramId,
    opts.kind,
    opts.drive,
    opts.content,
    opts.mood,
    scores.importanceScore,
    scores.confidenceScore,
    scores.noveltyScore,
    scores.overallScore,
    t,
  );
  return {
    id: res.lastInsertRowId,
    engramId: opts.engramId,
    kind: opts.kind,
    drive: opts.drive ?? "presence",
    content: opts.content,
    mood: opts.mood ?? undefined,
    ...scores,
    wasDelivered: true,
    seen: false,
    createdAt: t,
  };
}

export async function markTransmissionsSeen(
  engramId: number,
  ids?: number[],
): Promise<number> {
  await assertWritableEngram(engramId);
  const d = await getDb();
  let res: SQLite.SQLiteRunResult;
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    res = await d.runAsync(
      `UPDATE transmissions
       SET seen = 1, syncedAt = NULL, syncVersion = syncVersion + 1
       WHERE engramId = ? AND id IN (${placeholders}) AND seen = 0`,
      engramId,
      ...ids,
    );
  } else {
    res = await d.runAsync(
      `UPDATE transmissions
       SET seen = 1, syncedAt = NULL, syncVersion = syncVersion + 1
       WHERE engramId = ? AND seen = 0`,
      engramId,
    );
  }
  return res.changes;
}

// ---------------------------------------------------------------------------
// World model (OBSERVED-only log, mirroring the server's chat-side write)
// ---------------------------------------------------------------------------

export async function appendObservedEntry(opts: {
  engramId: number;
  content: string;
  confidence: number;
  source: string;
}): Promise<void> {
  await assertWritableEngram(opts.engramId);
  const d = await getDb();
  await d.runAsync(
    `INSERT INTO world_model (engramId, provenance, content, confidence, scope, source, createdAt)
     VALUES (?, 'observed', ?, ?, 'private', ?, ?)`,
    opts.engramId,
    opts.content,
    opts.confidence,
    opts.source,
    nowIso(),
  );
}

export async function loadRecentWorldModel(
  engramId: number,
  limit = 40,
): Promise<WorldModelEntryView[]> {
  const d = await getDb();
  type WorldModelPromptRow = WorldModelEntryView & { id: number };
  const recent = await d.getAllAsync<WorldModelPromptRow>(
    "SELECT id, provenance, content, confidence, scope, source FROM world_model WHERE engramId = ? ORDER BY id DESC LIMIT ?",
    engramId,
    limit,
  );
  const placeholders = TRUSTED_REBECCA_ADAPTIVE_SOURCES.map(() => "?").join(
    ", ",
  );
  const adaptive = await d.getAllAsync<WorldModelPromptRow>(
    `SELECT id, provenance, content, confidence, scope, source
     FROM world_model
     WHERE engramId = ? AND source IN (${placeholders})
     ORDER BY id DESC`,
    engramId,
    ...TRUSTED_REBECCA_ADAPTIVE_SOURCES,
  );
  const recentIds = new Set(recent.map((entry) => entry.id));
  return [...recent, ...adaptive.filter((entry) => !recentIds.has(entry.id))].map(
    ({ id: _id, ...entry }) => entry,
  );
}

// ---------------------------------------------------------------------------
// Offline -> server synchronization
// ---------------------------------------------------------------------------

type LocalSyncRows = {
  conversationIds: number[];
  messageIds: number[];
  inquiryIds: number[];
  transmissions: Array<{ id: number; syncVersion: number }>;
  observedEntryIds: number[];
};

export type PendingOfflineSyncBatch = {
  payload: OfflineSyncInput;
  localRows: LocalSyncRows;
};

/** Leave ample headroom under the API server's 2 MB JSON parser ceiling. */
export const MAX_OFFLINE_SYNC_PAYLOAD_BYTES = 1_500_000;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0)!;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

function trimSyncBatchToByteBudget(
  batch: PendingOfflineSyncBatch,
): PendingOfflineSyncBatch {
  let payloadBytes = utf8ByteLength(JSON.stringify(batch.payload));
  const removeTail = <T>(rows: T[]): T | undefined => {
    const row = rows.at(-1);
    if (row === undefined) return undefined;
    payloadBytes -=
      utf8ByteLength(JSON.stringify(row)) + (rows.length > 1 ? 1 : 0);
    rows.pop();
    return row;
  };

  while (payloadBytes > MAX_OFFLINE_SYNC_PAYLOAD_BYTES) {
    if (batch.payload.observedEntries.length > 0) {
      removeTail(batch.payload.observedEntries);
      batch.localRows.observedEntryIds.pop();
      continue;
    }
    if (batch.payload.transmissions.length > 0) {
      removeTail(batch.payload.transmissions);
      batch.localRows.transmissions.pop();
      continue;
    }
    if (batch.payload.inquiries.length > 0) {
      removeTail(batch.payload.inquiries);
      batch.localRows.inquiryIds.pop();
      continue;
    }
    const conversation = batch.payload.conversations.at(-1);
    if (!conversation) {
      throw new Error("Offline sync payload metadata exceeds its byte budget");
    }
    const localConversationId = Number(
      /^conversation:(\d+)$/.exec(conversation.syncId)?.[1],
    );
    if (conversation.messages.length > 0) {
      removeTail(conversation.messages);
      batch.localRows.messageIds.pop();
      batch.localRows.conversationIds =
        batch.localRows.conversationIds.filter(
          (id) => id !== localConversationId,
        );
      continue;
    }
    removeTail(batch.payload.conversations);
    batch.localRows.conversationIds = batch.localRows.conversationIds.filter(
      (id) => id !== localConversationId,
    );
  }
  return batch;
}

interface PendingConversationRow {
  id: number;
  title: string | null;
  mode: string;
  engramSlug: string | null;
  createdAt: string;
}

interface PendingMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface PendingInquiryRow {
  id: number;
  engramSlug: string;
  kind: string;
  question: string;
  response: string;
  createdAt: string;
}

interface PendingTransmissionRow {
  id: number;
  engramSlug: string;
  kind: string;
  drive: string | null;
  content: string;
  mood: string | null;
  importanceScore: number;
  confidenceScore: number;
  noveltyScore: number;
  overallScore: number;
  wasDelivered: number;
  seen: number;
  syncVersion: number;
  createdAt: string;
}

interface PendingObservedRow {
  id: number;
  engramSlug: string;
  content: string;
  confidence: number;
  source: string | null;
  createdAt: string;
}

export async function buildPendingSyncBatch(
  deviceId: string,
): Promise<PendingOfflineSyncBatch> {
  const d = await getDb();
  const conversationRows = await d.getAllAsync<PendingConversationRow>(
    `SELECT c.id, c.title, c.mode, e.slug AS engramSlug, c.createdAt
     FROM conversations c
     LEFT JOIN engrams e ON e.id = c.engramId
     WHERE (
       c.syncedAt IS NULL
       OR EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversationId = c.id AND m.syncedAt IS NULL
       )
     )
       AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 0
     ORDER BY c.id
     LIMIT 100`,
  );

  const conversations: OfflineSyncInput["conversations"] = [];
  const localRows: LocalSyncRows = {
    conversationIds: [],
    messageIds: [],
    inquiryIds: [],
    transmissions: [],
    observedEntryIds: [],
  };
  const exportedConversationIds = new Set<number>();
  let remainingMessages = 100;
  for (const row of conversationRows) {
    if (remainingMessages === 0) break;
    const messageCandidates = await d.getAllAsync<PendingMessageRow>(
      `SELECT id, role, content, createdAt
       FROM messages
       WHERE conversationId = ? AND syncedAt IS NULL
       ORDER BY id
       LIMIT ?`,
      row.id,
      remainingMessages + 1,
    );
    const hasMoreMessages = messageCandidates.length > remainingMessages;
    const messageRows = messageCandidates.slice(0, remainingMessages);
    remainingMessages -= messageRows.length;
    conversations.push({
      syncId: `conversation:${row.id}`,
      title: row.title,
      mode: row.mode,
      engramSlug: row.engramSlug,
      createdAt: row.createdAt,
      messages: messageRows.map((message) => ({
        syncId: `message:${message.id}`,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    });
    exportedConversationIds.add(row.id);
    if (!hasMoreMessages) localRows.conversationIds.push(row.id);
    localRows.messageIds.push(...messageRows.map((message) => message.id));
  }

  const inquiryRows = await d.getAllAsync<PendingInquiryRow>(
    `SELECT i.id, e.slug AS engramSlug, i.kind, i.question, i.response, i.createdAt
     FROM inquiries i
     JOIN engrams e ON e.id = i.engramId
     WHERE i.syncedAt IS NULL
       AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 0
     ORDER BY i.id
     LIMIT 100`,
  );
  const transmissionRows = await d.getAllAsync<PendingTransmissionRow>(
    `SELECT t.id, e.slug AS engramSlug, t.kind, t.drive, t.content, t.mood,
            t.importanceScore, t.confidenceScore, t.noveltyScore, t.overallScore,
             t.wasDelivered, t.seen, t.syncVersion, t.createdAt
     FROM transmissions t
     JOIN engrams e ON e.id = t.engramId
     WHERE t.syncedAt IS NULL
       AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 0
     ORDER BY t.id
     LIMIT 100`,
  );
  const observedCandidates = await d.getAllAsync<PendingObservedRow>(
    `SELECT w.id, e.slug AS engramSlug, w.content, w.confidence, w.source, w.createdAt
     FROM world_model w
     JOIN engrams e ON e.id = w.engramId
     WHERE w.syncedAt IS NULL
       AND w.provenance = 'observed'
       AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 0
     ORDER BY w.id
     LIMIT 100`,
  );
  const observedRows: PendingObservedRow[] = [];
  for (const row of observedCandidates) {
    const localConversationId = Number(
      /^chat:(\d+)$/.exec(row.source ?? "")?.[1],
    );
    if (!Number.isFinite(localConversationId)) {
      observedRows.push(row);
      continue;
    }
    if (exportedConversationIds.has(localConversationId)) {
      observedRows.push(row);
      continue;
    }
    const conversation = await d.getFirstAsync<{ syncedAt: string | null }>(
      "SELECT syncedAt FROM conversations WHERE id = ?",
      localConversationId,
    );
    // A prior successful conversation upload guarantees that its receipt can
    // resolve this observation's remote chat source. Otherwise defer the
    // observation until the conversation reaches a later bounded batch.
    if (conversation?.syncedAt) observedRows.push(row);
  }

  localRows.inquiryIds.push(...inquiryRows.map((row) => row.id));
  localRows.transmissions.push(
    ...transmissionRows.map((row) => ({
      id: row.id,
      syncVersion: row.syncVersion,
    })),
  );
  localRows.observedEntryIds.push(...observedRows.map((row) => row.id));

  return trimSyncBatchToByteBudget({
    payload: {
      deviceId,
      conversations,
      inquiries: inquiryRows.map((row) => ({
        syncId: `inquiry:${row.id}`,
        engramSlug: row.engramSlug,
        kind: row.kind,
        question: row.question,
        response: row.response,
        createdAt: row.createdAt,
      })),
      transmissions: transmissionRows.map((row) => ({
        syncId: `transmission:${row.id}`,
        engramSlug: row.engramSlug,
        kind: row.kind,
        drive: row.drive,
        content: row.content,
        mood: row.mood,
        importanceScore: row.importanceScore,
        confidenceScore: row.confidenceScore,
        noveltyScore: row.noveltyScore,
        overallScore: row.overallScore,
        wasDelivered: row.wasDelivered === 1,
        seen: row.seen === 1,
        createdAt: row.createdAt,
      })),
      observedEntries: observedRows.map((row) => {
        const localConversationId = /^chat:(\d+)$/.exec(row.source ?? "")?.[1];
        return {
          syncId: `observed:${row.id}`,
          engramSlug: row.engramSlug,
          conversationSyncId: localConversationId
            ? `conversation:${localConversationId}`
            : null,
          content: row.content,
          confidence: row.confidence,
          createdAt: row.createdAt,
        };
      }),
    },
    localRows,
  });
}

export function syncBatchIds(batch: PendingOfflineSyncBatch): string[] {
  return [
    ...batch.payload.conversations.flatMap((conversation) => [
      conversation.syncId,
      ...conversation.messages.map((message) => message.syncId),
    ]),
    ...batch.payload.inquiries.map((row) => row.syncId),
    ...batch.payload.transmissions.map((row) => row.syncId),
    ...batch.payload.observedEntries.map((row) => row.syncId),
  ];
}

export async function markSyncBatchComplete(
  batch: PendingOfflineSyncBatch,
): Promise<void> {
  const d = await getDb();
  const completedAt = nowIso();
  const archivalExclusions = {
    conversations: `NOT EXISTS (
      SELECT 1 FROM engrams e
      WHERE e.id = conversations.engramId
        AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 1
    )`,
    messages: `NOT EXISTS (
      SELECT 1
      FROM conversations c
      JOIN engrams e ON e.id = c.engramId
      WHERE c.id = messages.conversationId
        AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 1
    )`,
    inquiries: `NOT EXISTS (
      SELECT 1 FROM engrams e
      WHERE e.id = inquiries.engramId
        AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 1
    )`,
    world_model: `NOT EXISTS (
      SELECT 1 FROM engrams e
      WHERE e.id = world_model.engramId
        AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 1
    )`,
  } as const;
  const mark = async (
    table: keyof typeof archivalExclusions,
    ids: number[],
  ) => {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    await d.runAsync(
      `UPDATE ${table}
       SET syncedAt = ?
       WHERE id IN (${placeholders})
         AND ${archivalExclusions[table]}`,
      completedAt,
      ...ids,
    );
  };
  await d.withTransactionAsync(async () => {
    await mark("conversations", batch.localRows.conversationIds);
    await mark("messages", batch.localRows.messageIds);
    await mark("inquiries", batch.localRows.inquiryIds);
    for (const transmission of batch.localRows.transmissions) {
      await d.runAsync(
        `UPDATE transmissions
         SET syncedAt = ?
         WHERE id = ? AND syncVersion = ?
           AND NOT EXISTS (
             SELECT 1 FROM engrams e
             WHERE e.id = transmissions.engramId
               AND COALESCE(json_extract(e.data, '$.isArchival'), 0) = 1
           )`,
        completedAt,
        transmission.id,
        transmission.syncVersion,
      );
    }
    await mark("world_model", batch.localRows.observedEntryIds);
  });
}
