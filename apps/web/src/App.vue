<script setup lang="ts">
import { computed, ref } from "vue";
import {
  createIndexedDocument,
  paintPixel,
  renderRgba,
  replacePaletteEntry,
  type PaletteEntry,
} from "@pixel-art-tool/core";

const transparent: PaletteEntry = {
  id: "transparent",
  name: "Transparent",
  rgba: [0, 0, 0, 0],
};

const initialInk: PaletteEntry = {
  id: "ink",
  name: "Ink",
  rgba: [45, 212, 191, 255],
};

const initialDocument = createIndexedDocument(1, 1, [transparent, initialInk]);
paintPixel(initialDocument, 0, 0, 1);

const document = ref(initialDocument);
const alternate = ref(false);
const swatch = computed(() => {
  const rgba = renderRgba(document.value);
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${(rgba[3] ?? 255) / 255})`;
});

function recolor(): void {
  alternate.value = !alternate.value;
  document.value = replacePaletteEntry(document.value, 1, {
    ...initialInk,
    rgba: alternate.value ? [244, 114, 182, 255] : initialInk.rgba,
  });
}
</script>

<template>
  <main>
    <section aria-labelledby="title">
      <p class="eyebrow">Foundation initialized</p>
      <h1 id="title">Pixel Art Tool</h1>
      <p>
        The public app starts with a DOM-free indexed-pixel core and an offline-capable web shell.
        Interface design begins after the first workflow prototype is approved.
      </p>
      <button type="button" @click="recolor">
        <span class="swatch" :style="{ background: swatch }" aria-hidden="true" />
        Test linked palette color
      </button>
    </section>
  </main>
</template>

