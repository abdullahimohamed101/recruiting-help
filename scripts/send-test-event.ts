import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RawEventSchema } from "../packages/contracts/src/index.js";
import { signRawBody } from "../packages/ingestion/src/index.js";

const envFile = resolve(".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const intakeUrl = process.env.INTAKE_URL;
const callerId = process.env.AGGREGATOR_CALLER_ID;
const secret = process.env.AGGREGATOR_CALLER_SECRET;
if (intakeUrl === undefined || callerId === undefined || secret === undefined) {
  throw new Error(
    "INTAKE_URL, AGGREGATOR_CALLER_ID, and AGGREGATOR_CALLER_SECRET are required.",
  );
}

const filePath = argumentValue("--file");
let rawBody: Buffer;
if (filePath !== undefined) {
  rawBody = await readFile(resolve(filePath));
  RawEventSchema.parse(JSON.parse(rawBody.toString("utf8")));
} else {
  const now = new Date();
  const eventId =
    argumentValue("--event-id") ?? `cli-test-${now.getTime().toString(10)}`;
  rawBody = Buffer.from(
    JSON.stringify({
      schema_version: 1,
      source: "github",
      source_account: "vanshb03/Summer2027-Internships",
      source_event_id: eventId,
      source_url:
        "https://github.com/vanshb03/Summer2027-Internships/blob/dev/README.md",
      occurred_at: now.toISOString(),
      captured_at: now.toISOString(),
      author_display: null,
      text: "Phase 3 signed-ingestion test event",
      attachments: [],
      metadata: {
        repository: "vanshb03/Summer2027-Internships",
        branch: "dev",
        path: "README.md",
        commit_sha: null,
        row_index: null,
      },
    }),
    "utf8",
  );
}

const signedHeaders = signRawBody({
  callerId,
  secret,
  rawBody,
});
const rawBodyText = rawBody.toString("utf8");
const response = await fetch(intakeUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...signedHeaders,
  },
  body: rawBodyText,
});
const responseText = await response.text();
let responseBody: unknown;
try {
  responseBody = JSON.parse(responseText);
} catch {
  responseBody = { error: "non_json_response" };
}

console.log(
  JSON.stringify({
    status: response.status,
    ok: response.ok,
    body: responseBody,
  }),
);
if (!response.ok) {
  process.exitCode = 1;
}
