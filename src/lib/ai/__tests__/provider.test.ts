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

describe("lexicalTopFacts", () => {
  it("ranks facts by shared words when embeddings are unavailable", async () => {
    const { lexicalTopFacts } = await import("../verify");
    const fact = (code: string, statement: string) => ({ id: code, code, statement, source: "", owner: "", expires_on: null, version: 1, status: "active" as const });
    const brand = { facts: [fact("F-05", "Visible brightness improvement was measured from week 4"), fact("F-14", "Free shipping above Rs 499")] } as never;
    expect(lexicalTopFacts(brand, "Visible brightness within one week", 1).map((f) => f.code)).toEqual(["F-05"]);
  });
});
