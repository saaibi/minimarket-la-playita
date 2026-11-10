import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// Development only: same-origin browser cookies via loopback, TLS verified upstream.
const target = "https://playita-api.onrender.com";
const allowed = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
const guard: Plugin = {
  name: "loopback-api-origin",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (
        (req.url?.startsWith("/api") || req.url?.startsWith("/socket.io")) &&
        req.headers.origin &&
        !allowed.has(req.headers.origin)
      ) {
        res.statusCode = 403;
        res.end("Origin rejected");
        return;
      }
      next();
    });
  },
};
export default defineConfig({
  plugins: [react(), guard],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        configure(proxy) {
          proxy.on("proxyReq", (request) =>
            request.setHeader("Origin", "https://localhost"),
          );
          proxy.on("proxyRes", (response) => {
            const cookies = response.headers["set-cookie"];
            if (cookies)
              response.headers["set-cookie"] = cookies.map((v) =>
                v.replace(/;\s*Secure/gi, ""),
              );
          });
        },
      },
      "/socket.io": {
        target,
        changeOrigin: true,
        secure: true,
        ws: true,
        configure(proxy) {
          proxy.on("proxyReqWs", (request, req, socket) => {
            if (req.headers.origin && !allowed.has(req.headers.origin)) {
              socket.destroy();
              return;
            }
            request.setHeader("Origin", "https://localhost");
          });
        },
      },
    },
  },
});
