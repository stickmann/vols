import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? "postgres://vols:vols@localhost:5432/vols",
  },
  extensionsFilters: ["postgis"],
});
