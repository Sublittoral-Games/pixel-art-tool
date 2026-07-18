<!-- SPDX-License-Identifier: MPL-2.0 -->

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import {
  applyPixelPatch,
  cloneIndexedDocument,
  createIndexedDocument,
  createPixelPatch,
  createPixelPatchJournalEvent,
  decodeJournalEvent,
  decodePortableDocument,
  encodeJournalEvent,
  encodePortableDocument,
  PixelHistory,
  replayJournalEvents,
  type PaletteEntry,
  type PixelPatch,
  type PixelPatchJournalEvent,
  type PixelWrite,
} from "@pixel-art-tool/core";
import PixelCanvas from "./components/PixelCanvas.vue";
import { ProjectPersistence } from "./persistence";
import { exportTimelapse, probeTimelapseCapability } from "./timelapse";

type Tool = "pencil" | "eraser";

const starterPalette: readonly PaletteEntry[] = [
  { id: "transparent", name: "Transparent", rgba: [0, 0, 0, 0] },
  { id: "ink", name: "Midnight", rgba: [28, 32, 43, 255] },
  { id: "paper", name: "Warm white", rgba: [244, 239, 224, 255] },
  { id: "coral", name: "Coral", rgba: [240, 101, 93, 255] },
  { id: "gold", name: "Gold", rgba: [244, 190, 79, 255] },
  { id: "mint", name: "Mint", rgba: [72, 196, 148, 255] },
  { id: "sky", name: "Sky", rgba: [80, 158, 214, 255] },
  { id: "violet", name: "Violet", rgba: [143, 105, 204, 255] },
];

const document = shallowRef(createIndexedDocument(32, 32, starterPalette));
const originDocument = shallowRef(cloneIndexedDocument(document.value));
const journalEvents = ref<readonly PixelPatchJournalEvent[]>([]);
const activeTool = ref<Tool>("pencil");
const selectedColor = ref(3);
const revision = ref(0);
const initialized = ref(false);
const busy = ref(false);
const persistenceStatus = ref("Opening local project…");
const mediaStatus = ref("Checking video export…");
const importInput = ref<HTMLInputElement>();

let history = new PixelHistory();
let persistence: ProjectPersistence | undefined;

const interactionLocked = computed(() => !initialized.value || busy.value);
const drawingIndex = computed(() => activeTool.value === "eraser"
  ? document.value.transparentIndex
  : selectedColor.value);
const paintedCount = computed(() => {
  void revision.value;
  return document.value.pixels.reduce(
    (count, pixel) => count + (pixel === document.value.transparentIndex ? 0 : 1),
    0,
  );
});
const canUndo = computed(() => {
  void revision.value;
  return !interactionLocked.value && history.canUndo;
});
const canRedo = computed(() => {
  void revision.value;
  return !interactionLocked.value && history.canRedo;
});

function commitStroke(writes: readonly PixelWrite[]): void {
  if (interactionLocked.value) {
    return;
  }
  const patch = createPixelPatch(document.value, writes);
  if (history.commit(document.value, patch)) {
    finishCommittedPatch(patch);
  }
}

function undo(): void {
  if (interactionLocked.value) {
    return;
  }
  const patch = history.undoAsPatch(document.value);
  if (patch) {
    finishCommittedPatch(patch);
  }
}

function redo(): void {
  if (interactionLocked.value) {
    return;
  }
  const patch = history.redoAsPatch(document.value);
  if (patch) {
    finishCommittedPatch(patch);
  }
}

function finishCommittedPatch(patch: PixelPatch): void {
  revision.value += 1;
  const event = createPixelPatchJournalEvent(patch, createEventId(), new Date().toISOString());
  const nextEvents = [...journalEvents.value, event];
  journalEvents.value = nextEvents;

  if (!persistence) {
    persistenceStatus.value = "Editing in memory; OPFS unavailable";
    return;
  }

  persistenceStatus.value = "Saving locally…";
  const checkpointDocument = nextEvents.length % 5 === 0
    ? encodePortableDocument(document.value)
    : undefined;
  void persistence.append(encodeJournalEvent(event))
    .then(async () => {
      if (checkpointDocument) {
        await persistence?.checkpoint(checkpointDocument, nextEvents.length);
      }
      persistenceStatus.value = checkpointDocument
        ? `Saved checkpoint · ${nextEvents.length} journal events`
        : `Saved locally · ${nextEvents.length} journal events`;
    })
    .catch(handlePersistenceError);
}

async function createCheckpoint(): Promise<void> {
  if (!persistence || interactionLocked.value) {
    return;
  }
  busy.value = true;
  persistenceStatus.value = "Writing checkpoint…";
  try {
    await persistence.checkpoint(encodePortableDocument(document.value), journalEvents.value.length);
    persistenceStatus.value = `Checkpoint ready · ${journalEvents.value.length} journal events`;
  } catch (error) {
    handlePersistenceError(error);
  } finally {
    busy.value = false;
  }
}

function exportProject(): void {
  downloadBlob(
    new Blob([encodePortableDocument(document.value)], { type: "application/json" }),
    "untitled-sprite.pixelart.json",
  );
  persistenceStatus.value = "Portable project exported";
}

function chooseProjectFile(): void {
  importInput.value?.click();
}

async function importProject(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || interactionLocked.value) {
    return;
  }

  busy.value = true;
  try {
    const imported = decodePortableDocument(await file.text());
    const serialized = encodePortableDocument(imported);
    if (persistence) {
      await persistence.replace(serialized);
    }
    document.value = imported;
    originDocument.value = cloneIndexedDocument(imported);
    journalEvents.value = [];
    history = new PixelHistory();
    selectedColor.value = firstOpaquePaletteIndex(imported.palette, imported.transparentIndex);
    activeTool.value = "pencil";
    revision.value += 1;
    persistenceStatus.value = `Imported ${imported.width} × ${imported.height} project · checkpoint ready`;
  } catch (error) {
    persistenceStatus.value = error instanceof Error ? `Import rejected: ${error.message}` : "Import rejected";
  } finally {
    busy.value = false;
  }
}

async function replayHistory(): Promise<void> {
  if (interactionLocked.value || journalEvents.value.length === 0) {
    persistenceStatus.value = "No journal events to replay yet";
    return;
  }

  busy.value = true;
  const current = cloneIndexedDocument(document.value);
  const replay = cloneIndexedDocument(originDocument.value);
  document.value = replay;
  revision.value += 1;
  persistenceStatus.value = `Replaying ${journalEvents.value.length} journal events…`;

  try {
    for (const event of journalEvents.value) {
      await delay(90);
      applyPixelPatch(replay, event.patch);
      revision.value += 1;
    }
    if (!samePixels(replay.pixels, current.pixels)) {
      throw new Error("Replay did not reproduce the current document.");
    }
    persistenceStatus.value = `Replay matched · ${journalEvents.value.length} journal events`;
  } catch (error) {
    document.value = current;
    revision.value += 1;
    persistenceStatus.value = error instanceof Error ? `Replay failed: ${error.message}` : "Replay failed";
  } finally {
    busy.value = false;
  }
}

async function downloadTimelapse(): Promise<void> {
  if (interactionLocked.value) {
    return;
  }
  busy.value = true;
  mediaStatus.value = "Rendering timelapse…";
  try {
    const exported = await exportTimelapse(originDocument.value, journalEvents.value);
    downloadBlob(exported.blob, `untitled-timelapse.${exported.extension}`);
    mediaStatus.value = exported.extension === "mp4"
      ? "Exported AVC/MP4 through WebCodecs"
      : "Exported animated GIF fallback";
  } catch (error) {
    mediaStatus.value = error instanceof Error ? `Timelapse failed: ${error.message}` : "Timelapse export failed";
  } finally {
    busy.value = false;
  }
}

function selectColor(index: number): void {
  selectedColor.value = index;
  activeTool.value = "pencil";
}

function swatchColor(entry: PaletteEntry): string {
  const [red, green, blue, alpha] = entry.rgba;
  return `rgb(${red} ${green} ${blue} / ${alpha / 255})`;
}

function createEventId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function firstOpaquePaletteIndex(palette: readonly PaletteEntry[], transparentIndex: number): number {
  const index = palette.findIndex((entry, entryIndex) => entryIndex !== transparentIndex && entry.rgba[3] > 0);
  return index >= 0 ? index : transparentIndex;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function samePixels(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((pixel, index) => pixel === right[index]);
}

function handlePersistenceError(error: unknown): void {
  persistenceStatus.value = error instanceof Error
    ? `Local save unavailable: ${error.message}`
    : "Local save unavailable";
}

onMounted(async () => {
  try {
    persistence = new ProjectPersistence();
    const stored = await persistence.load();
    if (!stored.originDocument) {
      const serialized = encodePortableDocument(document.value);
      await persistence.initialize(serialized);
      originDocument.value = cloneIndexedDocument(document.value);
      persistenceStatus.value = "Local project ready · checkpoint created";
    } else {
      const origin = decodePortableDocument(stored.originDocument);
      const events = stored.journalEvents.map(decodeJournalEvent);
      const checkpoint = stored.checkpointDocument
        ? decodePortableDocument(stored.checkpointDocument)
        : cloneIndexedDocument(origin);
      const recoveryEvents = stored.recoveryEvents.map(decodeJournalEvent);
      const recovered = replayJournalEvents(checkpoint, recoveryEvents);
      const fullyReplayed = replayJournalEvents(origin, events);
      if (encodePortableDocument(fullyReplayed) !== encodePortableDocument(recovered)) {
        throw new Error("The checkpoint and journal disagree.");
      }
      document.value = recovered;
      originDocument.value = origin;
      journalEvents.value = events;
      history = new PixelHistory();
      selectedColor.value = firstOpaquePaletteIndex(recovered.palette, recovered.transparentIndex);
      revision.value += 1;
      persistenceStatus.value = `Recovered locally · ${events.length} journal events`;
    }
  } catch (error) {
    persistence?.destroy();
    persistence = undefined;
    handlePersistenceError(error);
  } finally {
    initialized.value = true;
  }

  const capability = await probeTimelapseCapability(512, 512);
  mediaStatus.value = capability.detail;
});

onBeforeUnmount(() => {
  persistence?.destroy();
});
</script>

<template>
  <main class="editor-shell">
    <header class="app-bar">
      <div class="title-block">
        <p class="eyebrow">Untitled sprite</p>
        <h1>Pixel Art Tool</h1>
      </div>
      <p class="document-status" data-testid="painted-count">
        {{ document.width }} × {{ document.height }} · {{ paintedCount }} painted
      </p>
      <details class="project-menu">
        <summary>Project</summary>
        <div class="project-popover">
          <div class="project-actions">
            <button type="button" :disabled="interactionLocked" @click="createCheckpoint">Save checkpoint</button>
            <button type="button" :disabled="interactionLocked" @click="exportProject">Export project</button>
            <button type="button" :disabled="interactionLocked" @click="chooseProjectFile">Import project</button>
            <button type="button" :disabled="interactionLocked || journalEvents.length === 0" @click="replayHistory">
              Replay history
            </button>
            <button type="button" :disabled="interactionLocked" @click="downloadTimelapse">Export timelapse</button>
          </div>
          <p data-testid="persistence-status">{{ persistenceStatus }}</p>
          <p data-testid="media-status">{{ mediaStatus }}</p>
        </div>
      </details>
      <input
        ref="importInput"
        class="visually-hidden"
        type="file"
        accept=".json,.pixelart.json,application/json"
        aria-label="Choose portable project"
        @change="importProject"
      >
    </header>

    <nav class="tool-rail" aria-label="Drawing tools">
      <button
        type="button"
        :aria-pressed="activeTool === 'pencil'"
        :disabled="interactionLocked"
        aria-label="Pencil"
        @click="activeTool = 'pencil'"
      >
        <span aria-hidden="true">✎</span>
        <span>Pencil</span>
      </button>
      <button
        type="button"
        :aria-pressed="activeTool === 'eraser'"
        :disabled="interactionLocked"
        aria-label="Eraser"
        @click="activeTool = 'eraser'"
      >
        <span aria-hidden="true">◇</span>
        <span>Eraser</span>
      </button>
      <span class="tool-divider" aria-hidden="true" />
      <button type="button" :disabled="!canUndo" aria-label="Undo" @click="undo">
        <span aria-hidden="true">↶</span>
        <span>Undo</span>
      </button>
      <button type="button" :disabled="!canRedo" aria-label="Redo" @click="redo">
        <span aria-hidden="true">↷</span>
        <span>Redo</span>
      </button>
    </nav>

    <PixelCanvas
      :document="document"
      :disabled="interactionLocked"
      :palette-index="drawingIndex"
      :revision="revision"
      @commit="commitStroke"
    />

    <aside class="palette-panel" aria-label="Palette">
      <div class="panel-heading">
        <h2>Palette</h2>
        <span>Fixed for spike</span>
      </div>
      <div class="palette-grid">
        <button
          v-for="(entry, index) in document.palette.filter((_, entryIndex) => entryIndex !== document.transparentIndex)"
          :key="entry.id"
          type="button"
          class="color-button"
          :class="{ selected: selectedColor === document.palette.indexOf(entry) && activeTool === 'pencil' }"
          :disabled="interactionLocked"
          :aria-label="entry.name"
          :aria-pressed="selectedColor === document.palette.indexOf(entry) && activeTool === 'pencil'"
          @click="selectColor(document.palette.indexOf(entry))"
        >
          <span :style="{ backgroundColor: swatchColor(entry) }" aria-hidden="true" />
        </button>
      </div>
      <p class="input-hint">Draw with mouse, Pencil, or one finger. Pinch, wheel, or hold Space to navigate.</p>
    </aside>
  </main>
</template>
