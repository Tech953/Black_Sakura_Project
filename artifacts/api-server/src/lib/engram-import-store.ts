import { randomUUID } from "node:crypto";
import type { EngramImportDraft } from "./engram-import";

export type EngramImportDraftState = "active" | "confirming" | "consumed";
export type EngramImportDraftStatus = EngramImportDraftState | "missing";
type Record = { draft: EngramImportDraft; state: EngramImportDraftState; expiresAt: number };

/** In-memory, process-local single-use handoff. No persistence is intentional. */
export class EngramImportDraftStore {
  private readonly records = new Map<string, Record>();
  private readonly now: () => number;
  readonly ttlMs: number;

  constructor(opts: { now?: () => number; ttlMs?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 20 * 60 * 1000;
  }

  reset(): void { this.records.clear(); }

  create(draft: EngramImportDraft): string {
    this.expire();
    let id = randomUUID();
    while (this.records.has(id)) id = randomUUID();
    this.records.set(id, { draft, state: "active", expiresAt: this.now() + this.ttlMs });
    return id;
  }

  get(id: string): EngramImportDraft | null {
    this.expire();
    const record = this.records.get(id);
    return record?.state === "active" ? record.draft : null;
  }

  status(id: string): EngramImportDraftStatus {
    this.expire();
    return this.records.get(id)?.state ?? "missing";
  }

  expiresAt(id: string): number | null {
    this.expire();
    return this.records.get(id)?.expiresAt ?? null;
  }

  beginConfirm(id: string): EngramImportDraft | null {
    this.expire();
    const record = this.records.get(id);
    if (!record || record.state !== "active") return null;
    record.state = "confirming";
    return record.draft;
  }

  release(id: string): boolean {
    this.expire();
    const record = this.records.get(id);
    if (!record || record.state !== "confirming") return false;
    record.state = "active";
    return true;
  }

  consume(id: string): boolean {
    this.expire();
    const record = this.records.get(id);
    if (!record || record.state !== "confirming") return false;
    record.state = "consumed";
    return true;
  }

  private expire(): void {
    const now = this.now();
    for (const [id, record] of this.records) if (record.expiresAt <= now) this.records.delete(id);
  }
}

export const engramImportDraftStore = new EngramImportDraftStore();