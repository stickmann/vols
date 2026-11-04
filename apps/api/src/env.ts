import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://vols_app:vols_app@localhost:5432/vols"),
  MIGRATION_DATABASE_URL: z.string().default("postgres://vols:vols@localhost:5432/vols"),
  API_PORT: z.coerce.number().int().default(3000),
  API_HOST: z.string().default("0.0.0.0"),
});

export const env = schema.parse(process.env);
