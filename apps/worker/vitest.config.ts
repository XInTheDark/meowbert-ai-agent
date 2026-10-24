import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const runExecutorSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../packages/run-executor/src");

export default defineConfig({
  resolve: {
    // Tests run against the executor's source, so mocks of its modules apply inside it too.
    alias: [{ find: /^@meowbert\/run-executor\/(.*)$/, replacement: `${runExecutorSrc}/$1.ts` }]
  },
  test: {
    exclude: [...configDefaults.exclude, "dist/**"]
  }
});
