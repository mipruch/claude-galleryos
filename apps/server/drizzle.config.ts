/**
 * drizzle-kit configuration (used by `bunx drizzle-kit generate`).
 *
 * Paths are made absolute from this file's location so the command works
 * regardless of the current working directory.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  dialect: "postgresql",
  // The schema is the single source of truth shared with the UI (@gallery/types).
  schema: join(here, "../../packages/types/src/schema.ts"),
  out: join(here, "src/db/migrations"),
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://gallery:gallery_dev_password@localhost:5432/gallery",
  },
});
