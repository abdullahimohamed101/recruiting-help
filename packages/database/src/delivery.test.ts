import { describe, expect, it } from "vitest";
import { deliveryRetryDelaySeconds } from "./delivery.js";

describe("deliveryRetryDelaySeconds", () => {
  it("follows the designed backoff ladder", () => {
    expect(deliveryRetryDelaySeconds(1)).toBe(30);
    expect(deliveryRetryDelaySeconds(2)).toBe(120);
    expect(deliveryRetryDelaySeconds(3)).toBe(600);
    expect(deliveryRetryDelaySeconds(4)).toBe(3_600);
    expect(deliveryRetryDelaySeconds(5)).toBe(21_600);
    expect(deliveryRetryDelaySeconds(9)).toBe(21_600);
  });

  it("honors Retry-After when provided", () => {
    expect(deliveryRetryDelaySeconds(1, 12)).toBe(12);
    expect(deliveryRetryDelaySeconds(1, 100_000)).toBe(86_400);
  });
});
