import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler-test.toml" },
    }),
  ],
  test: {
    include: ["worker/src/__tests__/*.test.ts"],
    globals: true,
  },
  ssr: {
    noExternal: ["effect"],
  },
});
