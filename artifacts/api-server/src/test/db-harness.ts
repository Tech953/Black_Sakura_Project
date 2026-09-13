import { vi } from "vitest";

export type TestRow = Record<string, unknown>;

const TABLE_NAMES = [
  "conversations",
  "conversationEngramParticipants",
  "messages",
  "personalityTable",
  "personasTable",
  "beliefsTable",
  "expressionsTable",
  "engramsTable",
  "engramTransmissionsTable",
  "engramInquiriesTable",
  "engramWorldModelTable",
  "hubSpacesTable",
  "engramPresenceTable",
  "hubActivityLogTable",
  "hubControlsTable",
  "engramMessagesTable",
  "engramSimulationsTable",
  "engramSimulationParticipantsTable",
  "engramSimulationStepsTable",
  "mediaAssetsTable",
  "mediaBlobsTable",
  "mediaObservationsTable",
  "mobileOfflineSyncReceiptsTable",
  "mobilePushTokensTable",
] as const;

const REQUIRED_SCHEMA_SENTINELS = [
  "conversations",
  "conversationEngramParticipants",
  "messages",
  "personalityTable",
  "personasTable",
  "beliefsTable",
  "expressionsTable",
  "engramsTable",
  "engramTransmissionsTable",
  "engramInquiriesTable",
  "engramWorldModelTable",
  "hubSpacesTable",
  "engramPresenceTable",
  "hubActivityLogTable",
  "hubControlsTable",
  "engramMessagesTable",
  "engramSimulationsTable",
  "engramSimulationParticipantsTable",
  "engramSimulationStepsTable",
  "mediaAssetsTable",
  "mediaBlobsTable",
  "mediaObservationsTable",
  "mobileOfflineSyncReceiptsTable",
  "mobilePushTokensTable",
  "HUB_CONTROLS_ID",
  "SYSTEM_OWNER_ID",
] as const;

type TableName = (typeof TABLE_NAMES)[number];
type Column = { __table: string; __col: string };
type Table = { __table: string } & Record<string, Column>;
type OrderSpec = { __order: "desc" | "asc"; col: Column };
type ScalarSubquery = { __scalarValues: () => unknown[] };
type HarnessSchema = Record<TableName, Table> & {
  HUB_CONTROLS_ID: number;
  SYSTEM_OWNER_ID: string;
};

export function createDbHarness() {
  const store: Record<string, TestRow[]> = {};
  const seq: Record<string, number> = {};
  const failureState = {
    nextInsertTable: null as string | null,
    nextUpdateTable: null as string | null,
  };
  // Canonical DB operation logs used by route-level assertions.
  const insertCalls: TestRow[] = [];
  const updateCalls: Array<{ table: string; patch: TestRow }> = [];
  // Compatibility logs used by older engine/store assertions. Keep these
  // separate so resetting or inspecting one surface cannot alter the other.
  const compatibilityInsertCalls: TestRow[] = [];
  const updatePatches: TestRow[] = [];
  const compatibilityUpdatePatches: TestRow[] = [];

  for (const table of TABLE_NAMES) {
    store[table] = [];
    seq[table] = 0;
  }

  function makeTable(name: string): Table {
    return new Proxy(
      { __table: name } as Table,
      {
        get(target, prop) {
          if (prop === "__table") return name;
          if (typeof prop === "symbol" || prop === "then") return undefined;
          return { __table: name, __col: String(prop) };
        },
      },
    );
  }

  const schema = {} as HarnessSchema;
  for (const table of TABLE_NAMES) schema[table] = makeTable(table);
  schema.HUB_CONTROLS_ID = 1;
  schema.SYSTEM_OWNER_ID = "__engram_system_template__";

  function tableName(table: unknown): string {
    return (table as Table).__table;
  }

  function isColumn(value: unknown): value is Column {
    return Boolean(
      value &&
        typeof value === "object" &&
        "__table" in value &&
        "__col" in value,
    );
  }

  function isTable(value: unknown): value is Table {
    return Boolean(
      value &&
        typeof value === "object" &&
        "__table" in value &&
        !("__col" in value),
    );
  }

  function readColumn(row: TestRow, column: Column) {
    const tables = row.__tables as Record<string, TestRow> | undefined;
    return tables?.[column.__table]?.[column.__col] ?? row[column.__col];
  }

  const norm = (value: unknown) =>
    value instanceof Date ? value.getTime() : value;

  const drizzle = {
    eq:
      (column: Column, value: unknown) =>
      (row: TestRow) =>
        norm(readColumn(row, column)) ===
        norm(isColumn(value) ? readColumn(row, value) : value),
    gte:
      (column: Column, value: unknown) =>
      (row: TestRow) =>
        (norm(readColumn(row, column)) as number) >= (norm(value) as number),
    inArray:
      (column: Column, values: unknown) =>
      (row: TestRow) => {
        const candidates = Array.isArray(values)
          ? values
          : isScalarSubquery(values)
            ? values.__scalarValues()
            : [];
        return candidates.some(
          (value) => norm(value) === norm(readColumn(row, column)),
        );
      },
    isNull:
      (column: Column) =>
      (row: TestRow) =>
        readColumn(row, column) == null,
    isNotNull:
      (column: Column) =>
      (row: TestRow) =>
        readColumn(row, column) != null,
    ne:
      (column: Column, value: unknown) =>
      (row: TestRow) =>
        norm(readColumn(row, column)) !== norm(value),
    lt:
      (column: Column, value: unknown) =>
      (row: TestRow) =>
        (norm(readColumn(row, column)) as number) < (norm(value) as number),
    and:
      (...predicates: Array<(row: TestRow) => boolean>) =>
      (row: TestRow) =>
        predicates.every((predicate) =>
          typeof predicate === "function" ? predicate(row) : true,
        ),
    or:
      (...predicates: Array<(row: TestRow) => boolean>) =>
      (row: TestRow) =>
        predicates.some((predicate) =>
          typeof predicate === "function" ? predicate(row) : false,
        ),
    desc: (column: Column): OrderSpec => ({ __order: "desc", col: column }),
    asc: (column: Column): OrderSpec => ({ __order: "asc", col: column }),
  };

  function project(row: TestRow, selection: Record<string, unknown>) {
    const tables = row.__tables as Record<string, TestRow> | undefined;
    return Object.fromEntries(
      Object.entries(selection).map(([key, value]) => {
        if (isColumn(value)) return [key, readColumn(row, value)];
        if (isTable(value)) {
          return [key, tables?.[value.__table] ?? row];
        }
        return [key, value];
      }),
    );
  }

  function selectChain(
    selection?: Record<string, unknown>,
    distinct = false,
  ) {
    let rows: TestRow[] = [];
    let baseTable: string | null = null;
    let predicate: ((row: TestRow) => boolean) | null = null;
    let order: { column: Column; direction: "asc" | "desc" } | null = null;
    let limit: number | null = null;

    const run = () => {
      let output = rows.slice();
      if (predicate) output = output.filter(predicate);
      if (order) {
        const { column, direction } = order;
        output.sort((a, b) => {
          const av = norm(readColumn(a, column)) as number;
          const bv = norm(readColumn(b, column)) as number;
          const comparison = av < bv ? -1 : av > bv ? 1 : 0;
          return direction === "desc" ? -comparison : comparison;
        });
      }
      if (limit != null) output = output.slice(0, limit);
      if (selection) output = output.map((row) => project(row, selection));
      if (distinct) {
        const seen = new Set<string>();
        output = output.filter((row) => {
          const key = JSON.stringify(row);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return output;
    };

    const chain = {
      __scalarValues(): unknown[] {
        const output = run();
        if (!selection) {
          return output.flatMap((row) => Object.values(row));
        }
        const keys = Object.keys(selection);
        if (keys.length === 1) {
          return output.map((row) => row[keys[0]]);
        }
        return output.flatMap((row) => Object.values(row));
      },
      from(table: unknown) {
        baseTable = tableName(table);
        rows = store[baseTable];
        return chain;
      },
      innerJoin(
        table: unknown,
        joinPredicate: (row: TestRow) => boolean = () => true,
      ) {
        const joinedTable = tableName(table);
        const leftRows = rows;
        rows = leftRows.flatMap((left): TestRow[] =>
          store[joinedTable].flatMap((right): TestRow[] => {
            const combined: TestRow = {
              ...left,
              ...right,
              __tables: {
                ...(left.__tables as Record<string, TestRow> | undefined),
                ...(baseTable ? { [baseTable]: left } : {}),
                [joinedTable]: right,
              },
            };
            return joinPredicate(combined) ? [combined] : [];
          }),
        );
        return chain;
      },
      where(nextPredicate: (row: TestRow) => boolean) {
        predicate = nextPredicate;
        return chain;
      },
      orderBy(spec: OrderSpec | Column) {
        order =
          "__order" in spec
            ? { column: spec.col, direction: spec.__order }
            : { column: spec, direction: "asc" };
        return chain;
      },
      limit(value: number) {
        limit = value;
        return chain;
      },
      for() {
        return chain;
      },
      then(
        resolve: (value: TestRow[]) => unknown,
        reject?: (error: unknown) => unknown,
      ) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return chain;
  }

  function insertBuilder(table: unknown) {
    const name = tableName(table);
    return {
      values(values: TestRow | TestRow[]) {
        if (failureState.nextInsertTable === name) {
          failureState.nextInsertTable = null;
          throw new Error(`forced ${name} insert failure`);
        }
        const pending = Array.isArray(values) ? values : [values];
        const inserted = pending
          .filter(
            (value) =>
              !(
                name === "mobileOfflineSyncReceiptsTable" &&
                store[name].some(
                  (row) =>
                    row.ownerId === value.ownerId &&
                    row.deviceId === value.deviceId &&
                    row.syncId === value.syncId,
                )
              ),
          )
          .map((value) => {
            const row: TestRow = {
              id: ++seq[name],
              createdAt: new Date(),
              updatedAt: new Date(),
              ...value,
            };
            if (name === "engramMessagesTable") {
              row.author ??= "engram";
              row.isDigest ??= false;
              row.digestedAt ??= null;
            }
            if (name === "hubControlsTable") {
              row.paused ??= false;
              row.quietMode ??= false;
            }
            store[name].push(row);
            const loggedRow = { ...row, __table: table };
            insertCalls.push(loggedRow);
            compatibilityInsertCalls.push({ ...loggedRow });
            return row;
          });
        return {
          returning() {
            return Promise.resolve(inserted);
          },
          onConflictDoUpdate() {
            return { returning: () => Promise.resolve(inserted) };
          },
          onConflictDoNothing() {
            return {
              returning: () => Promise.resolve(inserted),
              then(
                resolve: (value: TestRow[]) => unknown,
                reject?: (error: unknown) => unknown,
              ) {
                return Promise.resolve(inserted).then(resolve, reject);
              },
            };
          },
          then(
            resolve: (value: undefined) => unknown,
            reject?: (error: unknown) => unknown,
          ) {
            return Promise.resolve(undefined).then(resolve, reject);
          },
        };
      },
    };
  }

  function updateBuilder(table: unknown) {
    const name = tableName(table);
    return {
      set(patch: TestRow) {
        if (failureState.nextUpdateTable === name) {
          failureState.nextUpdateTable = null;
          throw new Error(`forced ${name} update failure`);
        }
        updateCalls.push({ table: name, patch });
        if (
          name !== "mobilePushTokensTable" &&
          !Object.prototype.hasOwnProperty.call(patch, "pushNotifiedAt")
        ) {
          updatePatches.push(patch);
          compatibilityUpdatePatches.push({ ...patch });
        }
        return {
          where(predicate: (row: TestRow) => boolean) {
            const matched = store[name].filter(predicate);
            for (const row of matched) Object.assign(row, patch);
            return {
              returning() {
                return Promise.resolve(matched);
              },
              then(
                resolve: (value: undefined) => unknown,
                reject?: (error: unknown) => unknown,
              ) {
                return Promise.resolve(undefined).then(resolve, reject);
              },
            };
          },
        };
      },
    };
  }

  function deleteBuilder(table: unknown) {
    const name = tableName(table);
    return {
      where(predicate: (row: TestRow) => boolean) {
        store[name] = store[name].filter((row) => !predicate(row));
        return Promise.resolve(undefined);
      },
    };
  }

  const db = {
    select: (selection?: Record<string, unknown>) =>
      selectChain(selection),
    selectDistinct: (selection?: Record<string, unknown>) =>
      selectChain(selection, true),
    insert: (table: unknown) => insertBuilder(table),
    update: (table: unknown) => updateBuilder(table),
    delete: (table: unknown) => deleteBuilder(table),
    transaction: async (fn: (tx: unknown) => unknown) => {
      const storeSnapshot = Object.fromEntries(
        Object.entries(store).map(([name, rows]) => [
          name,
          rows.map((row) => ({ ...row })),
        ]),
      );
      const seqSnapshot = { ...seq };
      try {
        return await fn(db);
      } catch (error) {
        for (const table of TABLE_NAMES) {
          store[table] = storeSnapshot[table];
          seq[table] = seqSnapshot[table];
        }
        throw error;
      }
    },
  };

  const llmState = {
    streamChunks: ["Hello", " there"] as string[],
    completion: "a response",
    throwOnCreate: false,
    blockNextCreate: null as Promise<void> | null,
    onCreateStarted: null as (() => void) | null,
  };
  const create = vi.fn(async (options: { stream?: boolean }) => {
    if (llmState.throwOnCreate) throw new Error("model unavailable");
    const blockedCreate = llmState.blockNextCreate;
    if (blockedCreate) {
      llmState.blockNextCreate = null;
      llmState.onCreateStarted?.();
      llmState.onCreateStarted = null;
      await blockedCreate;
    }
    if (options.stream) {
      const chunks = llmState.streamChunks;
      return (async function* () {
        for (const chunk of chunks) {
          yield { choices: [{ delta: { content: chunk } }] };
        }
      })();
    }
    return { choices: [{ message: { content: llmState.completion } }] };
  });
  const llm = { chat: { completions: { create } } };
  const generateTransmission = vi.fn(async () => "an autonomous transmission");

  const state = {
    get engrams() {
      return store.engramsTable;
    },
    set engrams(rows: TestRow[]) {
      store.engramsTable = rows;
    },
    get recent() {
      return store.engramTransmissionsTable;
    },
    set recent(rows: TestRow[]) {
      store.engramTransmissionsTable = rows;
    },
    get worldModel() {
      return store.engramWorldModelTable;
    },
    set worldModel(rows: TestRow[]) {
      store.engramWorldModelTable = rows;
    },
    get spaces() {
      return store.hubSpacesTable;
    },
    set spaces(rows: TestRow[]) {
      store.hubSpacesTable = rows.map((row) =>
        row.ownerId === undefined ? { ...row, ownerId: "test-owner" } : row,
      );
    },
    get presence() {
      return store.engramPresenceTable;
    },
    set presence(rows: TestRow[]) {
      store.engramPresenceTable = rows;
    },
    get messages() {
      return store.engramMessagesTable;
    },
    set messages(rows: TestRow[]) {
      store.engramMessagesTable = rows.map((row) => ({
        author: "engram",
        isDigest: false,
        digestedAt: null,
        ...row,
      }));
    },
    get controls() {
      return store.hubControlsTable;
    },
    set controls(rows: TestRow[]) {
      store.hubControlsTable = rows.map((row) =>
        row.ownerId === undefined ? { ...row, ownerId: "test-owner" } : row,
      );
    },
    get conversations() {
      return store.conversations;
    },
    set conversations(rows: TestRow[]) {
      store.conversations = rows;
    },
    get inserts() {
      return compatibilityInsertCalls;
    },
    set inserts(rows: TestRow[]) {
      compatibilityInsertCalls.splice(0, compatibilityInsertCalls.length, ...rows);
    },
    get updates() {
      return compatibilityUpdatePatches;
    },
    set updates(rows: TestRow[]) {
      compatibilityUpdatePatches.splice(0, compatibilityUpdatePatches.length, ...rows);
    },
  };

  function reset() {
    for (const table of TABLE_NAMES) {
      store[table] = [];
      seq[table] = 0;
    }
    failureState.nextInsertTable = null;
    failureState.nextUpdateTable = null;
    insertCalls.length = 0;
    updateCalls.length = 0;
    compatibilityInsertCalls.length = 0;
    updatePatches.length = 0;
    compatibilityUpdatePatches.length = 0;
    llmState.streamChunks = ["Hello", " there"];
    llmState.completion = "a response";
    llmState.throwOnCreate = false;
    llmState.blockNextCreate = null;
    llmState.onCreateStarted = null;
    create.mockClear();
    generateTransmission.mockClear();
    generateTransmission.mockResolvedValue("an autonomous transmission");
  }

  return {
    TABLE_NAMES,
    store,
    seq,
    state,
    schema,
    drizzle,
    db,
    llm,
    llmState,
    create,
    generateTransmission,
    failureState,
    insertCalls,
    updateCalls,
    compatibilityInsertCalls,
    updatePatches,
    compatibilityUpdatePatches,
    reset,
    engramsTable: schema.engramsTable,
    engramTransmissionsTable: schema.engramTransmissionsTable,
    engramWorldModelTable: schema.engramWorldModelTable,
    hubSpacesTable: schema.hubSpacesTable,
    engramPresenceTable: schema.engramPresenceTable,
    hubActivityLogTable: schema.hubActivityLogTable,
    engramMessagesTable: schema.engramMessagesTable,
    engramSimulationParticipantsTable: schema.engramSimulationParticipantsTable,
    hubControlsTable: schema.hubControlsTable,
    conversations: schema.conversations,
    messages: schema.messages,
  };
}

/**
 * Create one isolated harness per test module.
 *
 * Call this at module scope, before Vitest's hoisted vi.mock factories refer to
 * the instance. Do not create the instance inside vi.hoisted or inside a mock
 * factory.
 */
export function createIsolatedDbHarness() {
  return createDbHarness();
}

function isScalarSubquery(value: unknown): value is ScalarSubquery {
  return Boolean(
    value &&
      typeof value === "object" &&
      "__scalarValues" in value &&
      typeof (value as { __scalarValues?: unknown }).__scalarValues === "function",
  );
}

function requireHarnessMethod(
  value: unknown,
  methodName: string,
  path: string,
): (...args: unknown[]) => unknown {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>)[methodName] !== "function"
  ) {
    throw new Error(
      `db harness contract: missing ${path}.${methodName}(); update artifacts/api-server/src/test/db-harness.ts`,
    );
  }
  return (value as Record<string, (...args: unknown[]) => unknown>)[methodName];
}

export function assertDbHarnessContract(
  harness: ReturnType<typeof createDbHarness>,
) {
  const missingSentinels = REQUIRED_SCHEMA_SENTINELS.filter(
    (name) => !(name in harness.schema) || harness.schema[name] == null,
  );
  if (missingSentinels.length > 0) {
    throw new Error(
      `db harness contract: missing schema sentinels: ${missingSentinels.join(", ")}; update the harness mock before debugging route failures`,
    );
  }
  if (harness.schema.HUB_CONTROLS_ID !== 1) {
    throw new Error(
      "db harness contract: HUB_CONTROLS_ID must equal 1; update the harness mock before debugging route failures",
    );
  }
  if (harness.schema.SYSTEM_OWNER_ID !== "__engram_system_template__") {
    throw new Error(
      "db harness contract: SYSTEM_OWNER_ID is missing or incorrect; update the harness mock before debugging route failures",
    );
  }

  const select = requireHarnessMethod(harness.db, "select", "db");
  const selectDistinct = requireHarnessMethod(harness.db, "selectDistinct", "db");
  requireHarnessMethod(harness.db, "insert", "db");
  requireHarnessMethod(harness.db, "update", "db");
  requireHarnessMethod(harness.db, "delete", "db");
  requireHarnessMethod(harness.db, "transaction", "db");

  const query = select();
  requireHarnessMethod(query, "from", "db.select()");
  const fromQuery = requireHarnessMethod(query, "from", "db.select()")(
    harness.schema.engramsTable,
  );
  for (const methodName of [
    "innerJoin",
    "where",
    "orderBy",
    "limit",
    "for",
    "then",
    "__scalarValues",
  ]) {
    requireHarnessMethod(fromQuery, methodName, "db.select().from()");
  }
  const distinctQuery = selectDistinct();
  requireHarnessMethod(distinctQuery, "from", "db.selectDistinct()");

  const insert = requireHarnessMethod(harness.db, "insert", "db")(
    harness.schema.mobilePushTokensTable,
  );
  const values = requireHarnessMethod(insert, "values", "db.insert()");
  const inserted = values({});
  for (const methodName of [
    "returning",
    "onConflictDoNothing",
    "onConflictDoUpdate",
    "then",
  ]) {
    requireHarnessMethod(inserted, methodName, "db.insert().values()");
  }

  const update = requireHarnessMethod(harness.db, "update", "db")(
    harness.schema.mobilePushTokensTable,
  );
  const updated = requireHarnessMethod(update, "set", "db.update()")({});
  const updatedWhere = requireHarnessMethod(updated, "where", "db.update().set()")(
    () => false,
  );
  for (const methodName of ["returning", "then"]) {
    requireHarnessMethod(updatedWhere, methodName, "db.update().set().where()");
  }

  const deletion = requireHarnessMethod(harness.db, "delete", "db")(
    harness.schema.mobilePushTokensTable,
  );
  requireHarnessMethod(deletion, "where", "db.delete()");
}

export const routeHarness = createIsolatedDbHarness();
export const engineHarness = createIsolatedDbHarness();
/** @deprecated Prefer createIsolatedDbHarness, routeHarness, or engineHarness. */
export const dbHarness = routeHarness;