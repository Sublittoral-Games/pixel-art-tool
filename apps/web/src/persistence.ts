// SPDX-License-Identifier: MPL-2.0

export interface PersistedProject {
  readonly originDocument: string | undefined;
  readonly checkpointDocument: string | undefined;
  readonly journalEvents: readonly string[];
  readonly recoveryEvents: readonly string[];
}

type PersistenceOperation =
  | { readonly operation: "load" }
  | { readonly operation: "initialize"; readonly document: string }
  | { readonly operation: "append"; readonly event: string }
  | { readonly operation: "checkpoint"; readonly document: string; readonly eventCount: number }
  | { readonly operation: "replace"; readonly document: string };

export type PersistenceRequest = PersistenceOperation & { readonly requestId: number };

export type PersistenceResponse =
  | { readonly requestId: number; readonly ok: true; readonly value?: PersistedProject }
  | { readonly requestId: number; readonly ok: false; readonly error: string };

interface PendingRequest {
  readonly resolve: (value: PersistedProject | undefined) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof globalThis.setTimeout>;
}

export interface ProjectPersistenceOptions {
  readonly worker?: Worker;
  readonly requestTimeoutMs?: number;
}

export class ProjectPersistence {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #requestTimeoutMs: number;
  #nextRequestId = 1;
  #destroyed = false;

  constructor(options: ProjectPersistenceOptions = {}) {
    const requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new RangeError("The persistence request timeout must be positive.");
    }
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#worker = options.worker
      ?? new Worker(new URL("./workers/persistence.worker.ts", import.meta.url), { type: "module" });
    this.#worker.addEventListener("message", this.#handleMessage);
    this.#worker.addEventListener("error", this.#handleWorkerError);
  }

  load(): Promise<PersistedProject> {
    return this.#send({ operation: "load" }).then((value) => {
      if (!value) {
        throw new Error("The persistence worker returned no project state.");
      }
      return value;
    });
  }

  initialize(document: string): Promise<void> {
    return this.#send({ operation: "initialize", document }).then(() => undefined);
  }

  append(event: string): Promise<void> {
    return this.#send({ operation: "append", event }).then(() => undefined);
  }

  checkpoint(document: string, eventCount: number): Promise<void> {
    return this.#send({ operation: "checkpoint", document, eventCount }).then(() => undefined);
  }

  replace(document: string): Promise<void> {
    return this.#send({ operation: "replace", document }).then(() => undefined);
  }

  destroy(): void {
    this.#stop(true);
  }

  abandon(): void {
    this.#stop(false);
  }

  #stop(terminate: boolean): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.removeEventListener("error", this.#handleWorkerError);
    try {
      if (terminate) {
        this.#worker.terminate();
      }
    } finally {
      this.#rejectAll(new Error("The persistence worker was stopped."));
    }
  }

  #send(request: PersistenceOperation): Promise<PersistedProject | undefined> {
    if (this.#destroyed) {
      return Promise.reject(new Error("The persistence worker was stopped."));
    }
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        if (!this.#pending.delete(requestId)) {
          return;
        }
        reject(new Error(`Local persistence did not respond within ${this.#requestTimeoutMs} ms.`));
      }, this.#requestTimeoutMs);
      this.#pending.set(requestId, { resolve, reject, timeout });
      this.#worker.postMessage({ ...request, requestId } as PersistenceRequest);
    });
  }

  readonly #handleMessage = (message: MessageEvent<PersistenceResponse>): void => {
    const pending = this.#pending.get(message.data.requestId);
    if (!pending) {
      return;
    }
    this.#pending.delete(message.data.requestId);
    globalThis.clearTimeout(pending.timeout);

    if (message.data.ok) {
      pending.resolve(message.data.value);
    } else {
      pending.reject(new Error(message.data.error));
    }
  };

  readonly #handleWorkerError = (event: ErrorEvent): void => {
    this.#rejectAll(new Error(event.message || "The persistence worker failed."));
  };

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      globalThis.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
