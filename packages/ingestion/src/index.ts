import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  RawEventSchema,
  type RawEvent,
  type SourceType,
} from "@recruiting-help/contracts";

export const SIGNATURE_VERSION = "v1";
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_MAX_ATTACHMENT_METADATA_BYTES = 64 * 1024;
export const DEFAULT_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
export const NONCE_TTL_SECONDS = 10 * 60;

export const SIGNED_HEADER_NAMES = {
  caller: "x-aggregator-caller",
  timestamp: "x-aggregator-timestamp",
  nonce: "x-aggregator-nonce",
  signature: "x-aggregator-signature",
} as const;

export type SignedHeaders = Record<string, string | string[] | undefined>;

export type CallerConfig = {
  secret: string;
  allowedSources: Partial<Record<SourceType, readonly string[]>>;
};

export type CallerRegistry = Readonly<Record<string, CallerConfig>>;

export type SignedRequest = {
  rawBody: Buffer;
  headers: SignedHeaders;
};

export type PersistenceInput = {
  callerId: string;
  nonce: string;
  nonceExpiresAt: Date;
  event: RawEvent;
  payloadSha256: string;
};

export type PersistenceResult =
  | {
      kind: "accepted";
      rawEventId: string;
      inserted: boolean;
    }
  | {
      kind: "replayed_nonce";
    };

export type IntakePersistence = (
  input: PersistenceInput,
) => Promise<PersistenceResult>;

export type IntakeSuccess = {
  accepted: true;
  duplicate: boolean;
  raw_event_id: string;
};

export type IntakeFailure = {
  accepted: false;
  error: string;
};

export class IntakeRequestError extends Error {
  readonly statusCode: number;
  readonly publicCode: string;

  constructor(statusCode: number, publicCode: string) {
    super(publicCode);
    this.name = "IntakeRequestError";
    this.statusCode = statusCode;
    this.publicCode = publicCode;
  }
}

function singleHeader(
  headers: SignedHeaders,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function createSigningPayload(input: {
  callerId: string;
  timestamp: string;
  nonce: string;
  rawBody: Buffer;
}): Buffer {
  const prefix = Buffer.from(
    `${SIGNATURE_VERSION}.${input.callerId}.${input.timestamp}.${input.nonce}.`,
    "utf8",
  );
  return Buffer.concat([prefix, input.rawBody]);
}

export function signRawBody(input: {
  callerId: string;
  secret: string;
  rawBody: Buffer;
  timestamp?: string;
  nonce?: string;
}): Record<
  (typeof SIGNED_HEADER_NAMES)[keyof typeof SIGNED_HEADER_NAMES],
  string
> {
  const timestamp =
    input.timestamp ?? Math.floor(Date.now() / 1_000).toString(10);
  const nonce = input.nonce ?? randomUUID();
  const payload = createSigningPayload({
    callerId: input.callerId,
    timestamp,
    nonce,
    rawBody: input.rawBody,
  });
  const digest = createHmac("sha256", input.secret)
    .update(payload)
    .digest("hex");

  return {
    [SIGNED_HEADER_NAMES.caller]: input.callerId,
    [SIGNED_HEADER_NAMES.timestamp]: timestamp,
    [SIGNED_HEADER_NAMES.nonce]: nonce,
    [SIGNED_HEADER_NAMES.signature]: `${SIGNATURE_VERSION}=${digest}`,
  };
}

function verifyDigest(
  actualSignature: string,
  expectedDigest: string,
): boolean {
  if (!/^v1=[a-f0-9]{64}$/.test(actualSignature)) {
    return false;
  }
  const actual = Buffer.from(actualSignature, "utf8");
  const expected = Buffer.from(
    `${SIGNATURE_VERSION}=${expectedDigest}`,
    "utf8",
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifySignedRequest(input: {
  request: SignedRequest;
  callers: CallerRegistry;
  now?: Date;
  timestampToleranceSeconds?: number;
}): { callerId: string; nonce: string; caller: CallerConfig } {
  const callerId = singleHeader(
    input.request.headers,
    SIGNED_HEADER_NAMES.caller,
  );
  const timestamp = singleHeader(
    input.request.headers,
    SIGNED_HEADER_NAMES.timestamp,
  );
  const nonce = singleHeader(input.request.headers, SIGNED_HEADER_NAMES.nonce);
  const signature = singleHeader(
    input.request.headers,
    SIGNED_HEADER_NAMES.signature,
  );

  if (
    callerId === undefined ||
    timestamp === undefined ||
    nonce === undefined ||
    signature === undefined
  ) {
    throw new IntakeRequestError(401, "unauthorized");
  }

  const caller = input.callers[callerId];
  if (caller === undefined || caller.secret.length < 32) {
    throw new IntakeRequestError(401, "unauthorized");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(callerId)) {
    throw new IntakeRequestError(401, "unauthorized");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    throw new IntakeRequestError(401, "unauthorized");
  }
  if (!/^\d{10}$/.test(timestamp)) {
    throw new IntakeRequestError(401, "unauthorized");
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const tolerance =
    input.timestampToleranceSeconds ?? DEFAULT_TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    throw new IntakeRequestError(401, "stale_timestamp");
  }

  const signingPayload = createSigningPayload({
    callerId,
    timestamp,
    nonce,
    rawBody: input.request.rawBody,
  });
  const expectedDigest = createHmac("sha256", caller.secret)
    .update(signingPayload)
    .digest("hex");
  if (!verifyDigest(signature, expectedDigest)) {
    throw new IntakeRequestError(401, "unauthorized");
  }

  return { callerId, nonce, caller };
}

export function createIntakeProcessor(options: {
  callers: CallerRegistry;
  persist: IntakePersistence;
  now?: () => Date;
  maxBodyBytes?: number;
  maxAttachmentMetadataBytes?: number;
}): (request: SignedRequest) => Promise<IntakeSuccess> {
  return async (request) => {
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    if (request.rawBody.byteLength === 0) {
      throw new IntakeRequestError(400, "empty_body");
    }
    if (request.rawBody.byteLength > maxBodyBytes) {
      throw new IntakeRequestError(413, "payload_too_large");
    }

    const now = options.now?.() ?? new Date();
    const { callerId, nonce, caller } = verifySignedRequest({
      request,
      callers: options.callers,
      now,
    });

    const bodyText = request.rawBody.toString("utf8");
    if (!Buffer.from(bodyText, "utf8").equals(request.rawBody)) {
      throw new IntakeRequestError(400, "invalid_utf8");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      throw new IntakeRequestError(400, "invalid_json");
    }

    const parsedEvent = RawEventSchema.safeParse(parsedBody);
    if (!parsedEvent.success) {
      throw new IntakeRequestError(400, "validation_error");
    }
    const event = parsedEvent.data;
    const allowedAccounts = caller.allowedSources[event.source] ?? [];
    if (!allowedAccounts.includes(event.source_account)) {
      throw new IntakeRequestError(403, "source_not_allowed");
    }

    const attachmentMetadataBytes = Buffer.byteLength(
      JSON.stringify(event.attachments),
      "utf8",
    );
    if (
      attachmentMetadataBytes >
      (options.maxAttachmentMetadataBytes ??
        DEFAULT_MAX_ATTACHMENT_METADATA_BYTES)
    ) {
      throw new IntakeRequestError(413, "attachment_metadata_too_large");
    }

    const persistenceResult = await options.persist({
      callerId,
      nonce,
      nonceExpiresAt: new Date(now.getTime() + NONCE_TTL_SECONDS * 1_000),
      event,
      payloadSha256: createHash("sha256").update(request.rawBody).digest("hex"),
    });
    if (persistenceResult.kind === "replayed_nonce") {
      throw new IntakeRequestError(409, "replayed_nonce");
    }

    return {
      accepted: true,
      duplicate: !persistenceResult.inserted,
      raw_event_id: persistenceResult.rawEventId,
    };
  };
}

export function publicFailure(error: unknown): {
  statusCode: number;
  body: IntakeFailure;
} {
  if (error instanceof IntakeRequestError) {
    return {
      statusCode: error.statusCode,
      body: { accepted: false, error: error.publicCode },
    };
  }
  return {
    statusCode: 503,
    body: { accepted: false, error: "persistence_unavailable" },
  };
}
