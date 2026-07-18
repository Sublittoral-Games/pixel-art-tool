<!-- SPDX-License-Identifier: MPL-2.0 -->

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  createIndexedDocument,
  createPixelPatch,
  PixelHistory,
  type PaletteEntry,
  type PixelWrite,
} from "@pixel-art-tool/core";
import PixelCanvas from "./components/PixelCanvas.vue";

type Tool = "pencil" | "eraser";

const palette: readonly PaletteEntry[] = [
  { id: "transparent", name: "Transparent", rgba: [0, 0, 0, 0] },
  { id: "ink", name: "Midnight", rgba: [28, 32, 43, 255] },
  { id: "paper", name: "Warm white", rgba: [244, 239, 224, 255] },
  { id: "coral", name: "Coral", rgba: [240, 101, 93, 255] },
  { id: "gold", name: "Gold", rgba: [244, 190, 79, 255] },
  { id: "mint", name: "Mint", rgba: [72, 196, 148, 255] },
  { id: "sky", name: "Sky", rgba: [80, 158, 214, 255] },
  { id: "violet", name: "Violet", rgba: [143, 105, 204, 255] },
];

const document = createIndexedDocument(32, 32, palette);
const history = new PixelHistory();
const activeTool = ref<Tool>("pencil");
const selectedColor = ref(3);
const revision = ref(0);

const drawingIndex = computed(() => activeTool.value === "eraser" ? document.transparentIndex : selectedColor.value);
const paintedCount = computed(() => {
  void revision.value;
  return document.pixels.reduce((count, pixel) => count + (pixel === document.transparentIndex ? 0 : 1), 0);
});
const canUndo = computed(() => {
  void revision.value;
  return history.canUndo;
});
const canRedo = computed(() => {
  void revision.value;
  return history.canRedo;
});

function commitStroke(writes: readonly PixelWrite[]): void {
  const patch = createPixelPatch(document, writes);
  if (history.commit(document, patch)) {
    revision.value += 1;
  }
}

function undo(): void {
  if (history.undo(document)) {
    revision.value += 1;
  }
}

function redo(): void {
  if (history.redo(document)) {
    revision.value += 1;
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
</script>

<template>
  <main class="editor-shell">
    <header class="app-bar">
      <div>
        <p class="eyebrow">Untitled sprite</p>
        <h1>Pixel Art Tool</h1>
      </div>
      <p class="document-status" data-testid="painted-count">32 × 32 · {{ paintedCount }} painted</p>
    </header>

    <nav class="tool-rail" aria-label="Drawing tools">
      <button
        type="button"
        :aria-pressed="activeTool === 'pencil'"
        aria-label="Pencil"
        @click="activeTool = 'pencil'"
      >
        <span aria-hidden="true">✎</span>
        <span>Pencil</span>
      </button>
      <button
        type="button"
        :aria-pressed="activeTool === 'eraser'"
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
          v-for="(entry, index) in palette.slice(1)"
          :key="entry.id"
          type="button"
          class="color-button"
          :class="{ selected: selectedColor === index + 1 && activeTool === 'pencil' }"
          :aria-label="entry.name"
          :aria-pressed="selectedColor === index + 1 && activeTool === 'pencil'"
          @click="selectColor(index + 1)"
        >
          <span :style="{ backgroundColor: swatchColor(entry) }" aria-hidden="true" />
        </button>
      </div>
      <p class="input-hint">Draw with mouse, Pencil, or one finger. Pinch, wheel, or hold Space to navigate.</p>
    </aside>
  </main>
</template>
