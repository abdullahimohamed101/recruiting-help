import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_PUBLISH_CONFIDENCE,
  DEFAULT_FEED_DESTINATION_KEY,
} from "./index.js";

describe("processing defaults", () => {
  it("keeps conservative auto-publish defaults", () => {
    expect(DEFAULT_AUTO_PUBLISH_CONFIDENCE).toBe(0.85);
    expect(DEFAULT_FEED_DESTINATION_KEY).toBe("internship-feed");
  });
});
