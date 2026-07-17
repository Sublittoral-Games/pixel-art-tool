import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Pixel Art Tool",
        short_name: "Pixel Art",
        description: "A local-first pixel-art editor for desktop, tablet, and phone browsers.",
        display: "standalone",
        start_url: ".",
        background_color: "#17191f",
        theme_color: "#17191f",
      },
      workbox: {
        navigateFallback: "index.html",
      },
    }),
  ],
});

