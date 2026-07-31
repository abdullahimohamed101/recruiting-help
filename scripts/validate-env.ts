import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const modeFlagIndex = process.argv.indexOf("--mode");
const requestedMode =
  modeFlagIndex >= 0 ? process.argv[modeFlagIndex + 1] : "development";
const mode = requestedMode === "production" ? "production" : "development";
const envFile = resolve(mode === "production" ? ".env.production" : ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const sharedSchema = z.object({
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(12),
  N8N_ENCRYPTION_KEY: z.string().min(32),
});

const developmentSchema = sharedSchema.extend({
  INTAKE_URL: z.url(),
  AGGREGATOR_CALLER_ID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/),
  AGGREGATOR_CALLER_SECRET: z.string().min(32),
  AGGREGATOR_ALLOWED_SOURCES_JSON: z.string().refine((value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return (
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      );
    } catch {
      return false;
    }
  }, "Must be a JSON object"),
});

const productionSchema = sharedSchema.extend({
  AGGREGATOR_DATABASE_URL: z.url(),
  AGGREGATOR_CALLERS_JSON: z.string().refine((value) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return (
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      );
    } catch {
      return false;
    }
  }, "Must be a JSON object"),
  DISCORD_BOT_TOKEN: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  INTAKE_HMAC_SECRET: z.string().min(32),
  BACKUP_BUCKET: z.string().min(1),
  BACKUP_ENDPOINT: z.url(),
  BACKUP_ACCESS_KEY_ID: z.string().min(1),
  BACKUP_SECRET_ACCESS_KEY: z.string().min(1),
  BACKUP_ENCRYPTION_PASSPHRASE: z.string().min(24),
});

const result = (
  mode === "production" ? productionSchema : developmentSchema
).safeParse(process.env);

if (!result.success) {
  console.error(`Invalid ${mode} environment configuration:`);
  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`${mode} environment configuration is valid.`);
}
