import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const controlCenterBackend = env.CONTROL_CENTER_PROXY_TARGET ?? "http://127.0.0.1:8780";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5180,
      proxy: {
        "/api": {
          target: controlCenterBackend,
          changeOrigin: true,
        },
        "/ws": {
          target: controlCenterBackend.replace(/^http/, "ws"),
          ws: true,
        },
      },
    },
    preview: {
      port: 4180,
    },
  };
});
