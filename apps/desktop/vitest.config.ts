import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({ resolve: { alias: [
  { find: /^@meowbert\/run-executor\/(.*)$/, replacement: path.resolve(__dirname, "../../packages/run-executor/src/$1.ts") },
  { find: /^@meowbert\/shared\/(.*)$/, replacement: path.resolve(__dirname, "../../packages/shared/src/$1.ts") }
] }, test: { include: ["src/**/*.test.ts"] } });
