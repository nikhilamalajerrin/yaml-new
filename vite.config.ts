// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// In Docker we set VITE_IN_DOCKER=1 via docker-compose.yml
const inDocker = process.env.VITE_IN_DOCKER === "1";

export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: {
      "/api": {
        // Docker: talk to FastAPI service name "backend"; local: 127.0.0.1
        target: inDocker ? "http://backend:8000" : "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""), // frontend calls /api/healthz -> backend /healthz
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
}));
