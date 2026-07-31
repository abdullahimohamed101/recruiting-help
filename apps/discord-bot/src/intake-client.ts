import { signRawBody } from "@recruiting-help/ingestion";
import type { RawEvent } from "@recruiting-help/contracts";

export type IntakeSubmitResult =
  | {
      kind: "accepted";
      duplicate: boolean;
      rawEventId: string;
    }
  | {
      kind: "rejected";
      error: string;
      statusCode: number;
    };

export async function submitSignedRawEvent(input: {
  intakeUrl: string;
  callerId: string;
  callerSecret: string;
  event: RawEvent;
  fetchImpl?: typeof fetch;
}): Promise<IntakeSubmitResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const rawBody = Buffer.from(JSON.stringify(input.event), "utf8");
  const headers = signRawBody({
    callerId: input.callerId,
    secret: input.callerSecret,
    rawBody,
  });
  const response = await fetchImpl(input.intakeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: rawBody,
  });
  const body: unknown = await response.json().catch(() => null);
  if (
    response.ok &&
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "accepted" in body &&
    body.accepted === true &&
    "raw_event_id" in body &&
    typeof body.raw_event_id === "string"
  ) {
    return {
      kind: "accepted",
      duplicate: "duplicate" in body && body.duplicate === true,
      rawEventId: body.raw_event_id,
    };
  }
  const error =
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "error" in body &&
    typeof body.error === "string"
      ? body.error
      : "intake_failed";
  return {
    kind: "rejected",
    error,
    statusCode: response.status,
  };
}
