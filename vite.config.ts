import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      server: { entry: "server" },
    }),
    ...(command === "build"
      ? [
          nitro({
            preset: "cloudflare-module",
            output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
            cloudflare: { nodeCompat: true, deployConfig: true },
          }),
        ]
      : []),
    react(),
  ],
  resolve: { tsconfigPaths: true },
  server: { host: "::", port: 8080 },
}));
