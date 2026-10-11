import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client", "motion/react"],
  },
  server: {
    host: "0.0.0.0",
    // Cloudflare quick tunnels get a random subdomain each run; the leading
    // dot allows any of them.
    allowedHosts: ["terminal.local", ".trycloudflare.com"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
