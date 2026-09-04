import * as SQLite from "expo-sqlite";

import { engramSeedData, type NewEngram } from "@workspace/db/seed/engram-data";
import type { WorldModelEntryView } from "@workspace/engram-core";

/**
 * On-device SQLite store backing offline mode. Covers exactly the data surface
 * the mobile app uses: engrams, conversations/messages, inquiries, transmissions,
 * plus a small OBSERVED-only world-model log so engrams remember what you told
 * them across sessions (mirroring the server's observed-entry write in chat).
 */
let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbPromise) dbPromise = initializeDb();
  try {
    db = await dbPromise;
    return db;
  } catch (error) {
    dbPromise = null;
    throw error;
  }
}

async function initializeDb(): Promise<SQLite.SQLiteDatabase> {
  const opened = await SQLite.openDatabaseAsync("engram-offline.db");
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
      engramId INTEGER,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      engramId INTEGER NOT NULL,
      kind TEXT NOT NULL,
      question TEXT NOT NULL,
      response TEXT NOT NULL,
      configDelta TEXT,
      createdAt TEXT NOT NULL
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
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS world_model (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      engramId INTEGER NOT NULL,
      provenance TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL,
      scope TEXT NOT NULL,
      source TEXT,
      createdAt TEXT NOT NULL
    );
  `);
  // Seed personas once (keyed on slug, like the server's idempotent seed).
  const t = nowIso();
  for (const seed of engramSeedData) {
    await opened.runAsync(
      `INSERT OR IGNORE INTO engrams (slug, data, currentMood, isChatActive, createdAt, updatedAt)
       VALUES (?, ?, ?, 0, ?, ?)`,
      seed.slug,
      JSON.stringify(seed),
      (seed.currentMood as string | null) ?? null,
      t,
      t,
    );
  }
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
  return {
    ...seed,
    id: row.id,
    slug: row.slug,
    driveState: seed.driveState ?? {},
    currentMood: row.currentMood ?? seed.currentMood ?? null,
    isChatActive: row.isChatActive === 1,
    isArchival: seed.isArchival ?? false,
    lastTickAt: null,
    lastTransmissionAt: null,
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

export async function activateEngram(id: number): Promise<Record<string, unknown> | null> {
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
  engramId?: number | null;
}): Promise<Record<string, unknown>> {
  const d = await getDb();
  const t = nowIso();
  const res = await d.runAsync(
    "INSERT INTO conversations (title, mode, engramId, createdAt) VALUES (?, ?, ?, ?)",
    opts.title ?? null,
    opts.mode ?? "companion",
    opts.engramId ?? null,
    t,
  );
  return {
    id: res.lastInsertRowId,
    title: opts.title ?? null,
    mode: opts.mode ?? "companion",
    personaName: null,
    customEngram: null,
    engramId: opts.engramId ?? null,
    createdAt: t,
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
  return { ...conv, personaName: null, customEngram: null, messages: msgs };
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
  return rows.map((r) => ({ ...r, wasDelivered: r.wasDelivered === 1, seen: r.seen === 1 }));
}

export async function insertTransmission(opts: {
  engramId: number;
  kind: string;
  drive: string | null;
  content: string;
  mood: string | null;
}): Promise<Record<string, unknown>> {
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
    drive: opts.drive,
    content: opts.content,
    mood: opts.mood,
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
  const d = await getDb();
  let res: SQLite.SQLiteRunResult;
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    res = await d.runAsync(
      `UPDATE transmissions SET seen = 1 WHERE engramId = ? AND id IN (${placeholders})`,
      engramId,
      ...ids,
    );
  } else {
    res = await d.runAsync(
      "UPDATE transmissions SET seen = 1 WHERE engramId = ? AND seen = 0",
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
  return d.getAllAsync<WorldModelEntryView>(
    "SELECT provenance, content, confidence, scope, source FROM world_model WHERE engramId = ? ORDER BY id DESC LIMIT ?",
    engramId,
    limit,
  );
}
