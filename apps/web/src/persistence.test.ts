// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectPersistence,
  type PersistenceRequest,
  type PersistenceResponse,
} from "./persistence";

class FakeWorker extends EventTarget {
  readonly messages: PersistenceRequest[] = [];
  terminated = false;

  postMessage(message: PersistenceRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: PersistenceResponse): void {
    this.dispatchEvent(new MessageEvent("message", { data: response }));
  }
}

function asWorker(worker: FakeWorker): Worker {
  return worker as unknown as Worker;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ProjectPersistence", () => {
  it("rejects a request when its worker never responds", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const persistence = new ProjectPersistence({ worker: asWorker(worker), requestTimeoutMs: 50 });
    const rejection = expect(persistence.load()).rejects.toThrow("did not respond within 50 ms");

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(worker.messages).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    persistence.destroy();
    expect(worker.terminated).toBe(true);
  });

  it("clears the timeout when the worker responds", async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const persistence = new ProjectPersistence({ worker: asWorker(worker), requestTimeoutMs: 50 });
    const load = persistence.load();
    const request = worker.messages[0];
    if (!request) {
      throw new Error("The persistence request was not posted.");
    }
    worker.respond({
      requestId: request.requestId,
      ok: true,
      value: {
        originDocument: undefined,
        checkpointDocument: undefined,
        journalEvents: [],
        recoveryEvents: [],
      },
    });

    await expect(load).resolves.toEqual({
      originDocument: undefined,
      checkpointDocument: undefined,
      journalEvents: [],
      recoveryEvents: [],
    });
    expect(vi.getTimerCount()).toBe(0);
    persistence.destroy();
    expect(worker.terminated).toBe(true);
  });
});
