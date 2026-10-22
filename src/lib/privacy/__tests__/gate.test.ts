// Tests: Privacy Gate masking of PII and embargoed terms, and mask/unmask round-trips.
import { describe, expect, it } from "vitest";
import { mask, unmask } from "../gate";

describe("mask", () => {
  it("masks emails, phones, PAN, Aadhaar and embargo terms", () => {
    const text = "Mail priya@velura.in or call +91 98765 43210 / 9123456789. PAN ABCDE1234F, Aadhaar 1234 5678 9012. Launching Velura Nightshift soon.";
    const { masked, tokens, count } = mask(text, ["velura nightshift"]);
    expect(masked).not.toMatch(/priya@|98765|9123456789|ABCDE1234F|1234 5678|Nightshift/);
    expect(masked).toContain("⟦EMAIL_1⟧");
    expect(masked).toContain("⟦PHONE_1⟧");
    expect(masked).toContain("⟦PHONE_2⟧");
    expect(masked).toContain("⟦PAN_1⟧");
    expect(masked).toContain("⟦AADHAAR_1⟧");
    expect(masked).toContain("⟦EMBARGO_1⟧");
    expect(count).toBe(6);
    expect(tokens.get("⟦EMBARGO_1⟧")).toBe("Velura Nightshift"); // original casing kept
    expect(unmask(masked, tokens)).toBe(text);
  });

  it("reuses a token for repeated values", () => {
    const { masked, count, tokens } = mask("a@b.co then a@b.co", []);
    expect(masked).toBe("⟦EMAIL_1⟧ then ⟦EMAIL_1⟧");
    expect(count).toBe(2);
    expect(tokens.size).toBe(1);
  });

  it("leaves ordinary copy untouched", () => {
    const text = "Visible glow in 7 days. 71% saw more radiant skin at week 4. Order 123456.";
    const r = mask(text, []);
    expect(r.masked).toBe(text);
    expect(r.count).toBe(0);
  });

  it("does not match digits inside longer numbers or words", () => {
    const text = "Ref 19876543210123 and XABCDE1234FX";
    expect(mask(text, []).count).toBe(0);
  });

  it("round-trips text with no tokens and with model-edited text", () => {
    const text = "Contact ABCDE1234F about Velura Nightshift";
    const { masked, tokens } = mask(text, ["Velura Nightshift"]);
    const modelReply = `Sure: ${masked.toUpperCase().replace(/⟦[A-Z_0-9]+⟧/g, (t) => t)}`;
    expect(unmask(modelReply, tokens)).toContain("ABCDE1234F");
    expect(unmask(masked, tokens)).toBe(text);
    expect(unmask("plain", new Map())).toBe("plain");
  });
});
