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
  "engramSimulationStepsTable",
  "mediaAssetsTable",
  "mediaBlobsTable",
  "mediaObservationsTable",
  "mobileOfflineSyncReceiptsTable",
  "mobilePushTokensTable",
] as const;

type TableName = (typeof TABLE_NAMES)[number];
type Column = { __table: string; __col: string };
type Table = { __table: string };
type OrderSpec = { __order: "desc" | "asc"; col: Column };

export function createDbHarness() {
  const store: Record<string, TestRow[]> = {};
  const seq: Record<string, number> = {};
  const failureState = { nextInsertTable: null as string | null };
  const insertCalls: TestRow[] = [];
  const updateCalls: Array<{ table: string; patch: TestRow }> = [];
  const updatePatches: TestRow[] = [];

  for (const table of TABLE_NAMES) {
    store[table] = [];
    seq[table] = 0;
  }

  function makeTable(name: string): Table {
    return new Proxy(
      { __table: name },
      {
        get(target, prop) {
          if (prop === "__table") return name;
          if (typeof prop === "symbol" || prop === "then") return undefined;
          return { __table: name, __col: String(prop) };
        },
      },
    );
  }

  const schema: Record<string, unknown> = {};
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
      (row: TestRow) =>
        Array.isArray(values)
          ? values.some((value) => norm(value) === norm(readColumn(row, column)))
          : true,
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
            insertCalls.push({ ...row, __table: table });
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
        updateCalls.push({ table: name, patch });
        if (
          name !== "mobilePushTokensTable" &&
          !Object.prototype.hasOwnProperty.call(patch, "pushNotifiedAt")
        ) {
          updatePatches.push(patch);
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
      return insertCalls;
    },
    set inserts(rows: TestRow[]) {
      insertCalls.splice(0, insertCalls.length, ...rows);
    },
    get updates() {
      return updatePatches;
    },
    set updates(rows: TestRow[]) {
      updatePatches.splice(0, updatePatches.length, ...rows);
    },
  };

  function reset() {
    for (const table of TABLE_NAMES) {
      store[table] = [];
      seq[table] = 0;
    }
    failureState.nextInsertTable = null;
    insertCalls.length = 0;
    updateCalls.length = 0;
    updatePatches.length = 0;
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
    updatePatches,
    reset,
    engramsTable: schema.engramsTable,
    engramTransmissionsTable: schema.engramTransmissionsTable,
    engramWorldModelTable: schema.engramWorldModelTable,
    hubSpacesTable: schema.hubSpacesTable,
    engramPresenceTable: schema.engramPresenceTable,
    hubActivityLogTable: schema.hubActivityLogTable,
    engramMessagesTable: schema.engramMessagesTable,
    hubControlsTable: schema.hubControlsTable,
    conversations: schema.conversations,
    messages: schema.messages,
  };
}

export const routeHarness = createDbHarness();
export const engineHarness = createDbHarness();
export const dbHarness = routeHarness;