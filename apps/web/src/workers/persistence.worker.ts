/// <reference lib="webworker" />
// SPDX-License-Identifier: MPL-2.0

import type { PersistedProject, PersistenceRequest, PersistenceResponse } from "../persistence";

interface CheckpointFile {
  readonly schemaVersion: 1;
  readonly eventCount: number;
  readonly document: string;
}

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const storageRootName = "pixel-art-tool";
const projectDirectoryName = "untitled-s2";
const originFileName = "origin.json";
const checkpointFileName = "checkpoint.json";
const journalFileName = "journal.ndjson";

let operationQueue = Promise.resolve();

workerScope.addEventListener("message", (message: MessageEvent<PersistenceRequest>) => {
  operationQueue = operationQueue
    .then(() => handleRequest(message.data))
    .catch(() => undefined);
});

async function handleRequest(request: PersistenceRequest): Promise<void> {
  try {
    let value: PersistedProject | undefined;
    switch (request.operation) {
      case "load":
        value = await loadProject();
        break;
      case "initialize":
        await initializeProject(request.document);
        break;
      case "append":
        await appendJournalEvent(request.event);
        break;
      case "checkpoint":
        await writeCheckpoint(request.document, request.eventCount);
        break;
      case "replace":
        await replaceProject(request.document);
        break;
    }
    respond({ requestId: request.requestId, ok: true, ...(value ? { value } : {}) });
  } catch (error) {
    respond({
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "OPFS persistence failed.",
    });
  }
}

function respond(response: PersistenceResponse): void {
  workerScope.postMessage(response);
}

async function projectDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const appDirectory = await root.getDirectoryHandle(storageRootName, { create: true });
  return appDirectory.getDirectoryHandle(projectDirectoryName, { create: true });
}

async function loadProject(): Promise<PersistedProject> {
  const directory = await projectDirectory();
  const [originDocument, checkpointSerialized, journalSerialized] = await Promise.all([
    readOptionalFile(directory, originFileName),
    readOptionalFile(directory, checkpointFileName),
    readOptionalFile(directory, journalFileName),
  ]);
  const journalEvents = parseJournal(journalSerialized);
  const checkpoint = parseCheckpoint(checkpointSerialized, journalEvents.length);

  return {
    originDocument,
    checkpointDocument: checkpoint?.document,
    journalEvents,
    recoveryEvents: journalEvents.slice(checkpoint?.eventCount ?? 0),
  };
}

async function initializeProject(document: string): Promise<void> {
  const directory = await projectDirectory();
  const existingOrigin = await readOptionalFile(directory, originFileName);
  if (existingOrigin !== undefined) {
    return;
  }
  await replaceProject(document);
}

async function replaceProject(document: string): Promise<void> {
  const directory = await projectDirectory();
  await Promise.all([
    writeFile(directory, originFileName, document),
    writeFile(directory, checkpointFileName, serializeCheckpoint(document, 0)),
    writeFile(directory, journalFileName, ""),
  ]);
}

async function appendJournalEvent(event: string): Promise<void> {
  const directory = await projectDirectory();
  const fileHandle = await directory.getFileHandle(journalFileName, { create: true });
  const file = await fileHandle.getFile();
  const writable = await fileHandle.createWritable({ keepExistingData: true });
  await writable.seek(file.size);
  await writable.write(`${event}\n`);
  await writable.close();
}

async function writeCheckpoint(document: string, eventCount: number): Promise<void> {
  const directory = await projectDirectory();
  const journal = parseJournal(await readOptionalFile(directory, journalFileName));
  if (!Number.isInteger(eventCount) || eventCount < 0 || eventCount > journal.length) {
    throw new Error("A checkpoint cannot advance beyond its persisted journal.");
  }
  await writeFile(directory, checkpointFileName, serializeCheckpoint(document, eventCount));
}

async function readOptionalFile(directory: FileSystemDirectoryHandle, name: string): Promise<string | undefined> {
  try {
    const handle = await directory.getFileHandle(name);
    return (await handle.getFile()).text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return undefined;
    }
    throw error;
  }
}

async function writeFile(directory: FileSystemDirectoryHandle, name: string, contents: string): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

function parseJournal(serialized: string | undefined): readonly string[] {
  if (!serialized) {
    return [];
  }
  return serialized.split("\n").filter((line) => line.trim().length > 0);
}

function serializeCheckpoint(document: string, eventCount: number): string {
  return JSON.stringify({ schemaVersion: 1, eventCount, document } satisfies CheckpointFile);
}

function parseCheckpoint(serialized: string | undefined, journalLength: number): CheckpointFile | undefined {
  if (!serialized) {
    return undefined;
  }
  const value = JSON.parse(serialized) as Partial<CheckpointFile>;
  if (
    value.schemaVersion !== 1
    || typeof value.document !== "string"
    || !Number.isInteger(value.eventCount)
    || (value.eventCount ?? -1) < 0
    || (value.eventCount ?? journalLength + 1) > journalLength
  ) {
    throw new Error("The stored checkpoint is invalid or ahead of its journal.");
  }
  return value as CheckpointFile;
}
