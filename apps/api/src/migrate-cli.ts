import { pool } from "./lib/db.js";
import { runMigrations } from "./lib/migrate.js";

runMigrations(pool)
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
