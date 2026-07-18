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
}

export class ProjectPersistence {
  readonly #worker: Worker;
  readonly #pending = new Map<number, PendingRequest>();
  #nextRequestId = 1;

  constructor() {
    this.#worker = new Worker(new URL("./workers/persistence.worker.ts", import.meta.url), { type: "module" });
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
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.removeEventListener("error", this.#handleWorkerError);
    this.#worker.terminate();
    this.#rejectAll(new Error("The persistence worker was stopped."));
  }

  #send(request: PersistenceOperation): Promise<PersistedProject | undefined> {
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;

    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#worker.postMessage({ ...request, requestId } as PersistenceRequest);
    });
  }

  readonly #handleMessage = (message: MessageEvent<PersistenceResponse>): void => {
    const pending = this.#pending.get(message.data.requestId);
    if (!pending) {
      return;
    }
    this.#pending.delete(message.data.requestId);

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
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
