import { defineConfig } from "vitest/config";
// Tests use only fictional data, fake or fixture hub sources and disposable data directories.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 30000, hookTimeout: 30000, maxWorkers: 2 } });
