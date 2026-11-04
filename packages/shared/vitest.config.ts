import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: "50%",
    exclude: [...configDefaults.exclude, "dist/**"]
  }
});
