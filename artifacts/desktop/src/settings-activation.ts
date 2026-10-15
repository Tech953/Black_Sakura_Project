export interface SettingsActivationDependencies<T> {
  /** Stops all currently running children. It must be safe to call repeatedly. */
  stop: () => Promise<void>;
  /** Starts settings and resolves only once the children are healthy. */
  start: (settings: T) => Promise<void>;
  /** Atomically persists settings. */
  persist: (settings: T) => Promise<void>;
}

export class SettingsActivationError extends Error {
  readonly primaryError: unknown;
  readonly rollbackErrors: readonly unknown[];

  constructor(primaryError: unknown, rollbackErrors: readonly unknown[]) {
    const primary =
      primaryError instanceof Error ? primaryError.message : String(primaryError);
    const rollback = rollbackErrors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    super(
      rollbackErrors.length === 0
        ? `Settings activation failed: ${primary}`
        : `Settings activation failed: ${primary}; rollback failed: ${rollback}`,
      { cause: primaryError },
    );
    this.name = "SettingsActivationError";
    this.primaryError = primaryError;
    this.rollbackErrors = rollbackErrors;
  }
}

/**
 * Activates settings transactionally. Persistence happens only after start()
 * has completed its health check. If persist was attempted, the previous value
 * is persisted again during rollback, covering stores which can fail after a
 * partial write.
 */
export async function activateSettings<T>(
  previous: T,
  candidate: T,
  deps: SettingsActivationDependencies<T>,
): Promise<void> {
  await deps.stop();

  let persistenceAttempted = false;
  try {
    await deps.start(candidate);
    persistenceAttempted = true;
    await deps.persist(candidate);
  } catch (primaryError) {
    const rollbackErrors: unknown[] = [];
    try {
      await deps.stop();
    } catch (error) {
      rollbackErrors.push(error);
    }
    try {
      await deps.start(previous);
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (persistenceAttempted) {
      try {
        await deps.persist(previous);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    throw new SettingsActivationError(primaryError, rollbackErrors);
  }
}