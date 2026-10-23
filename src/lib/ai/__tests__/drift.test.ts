import { describe, expect, it } from "vitest";
import { labelPair } from "../drift";

const s = (strength: number) => ({ belief: "b", quote: "q", strength, readers: 4 });

describe("labelPair", () => {
  it("flags beliefs only the translation creates", () => expect(labelPair({ master: null, variant: s(3) })).toBe("new_belief"));
  it("flags a stronger translated claim", () => expect(labelPair({ master: s(2), variant: s(3) })).toBe("strengthened"));
  it("reports weaker and dropped claims", () => {
    expect(labelPair({ master: s(3), variant: s(1) })).toBe("weakened");
    expect(labelPair({ master: s(2), variant: null })).toBe("dropped");
  });
  it("treats equal strength as the same belief", () => expect(labelPair({ master: s(2), variant: s(2) })).toBe("same"));
});
