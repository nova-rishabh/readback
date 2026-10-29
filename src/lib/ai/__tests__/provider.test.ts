import { describe, expect, it } from "vitest";
import { retrySeconds } from "../provider";

describe("retrySeconds", () => {
  it("reads per-minute and per-day retry hints", () => {
    expect(retrySeconds(new Error("Please retry in 41.5s."))).toBe(42);
    expect(retrySeconds(new Error("Embed content requests per day limit exceeded. Please retry in 22h12m17.94s."))).toBe(22 * 3600 + 12 * 60 + 18);
    expect(retrySeconds({ message: "x", responseBody: '{"retryDelay": "30s"}' })).toBe(30);
    expect(retrySeconds(new Error("no hint"))).toBe(60);
  });
});
