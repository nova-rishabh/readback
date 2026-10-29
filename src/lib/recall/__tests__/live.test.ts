import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/types";
import { cannotConfirmAbsence, claimPhrases, findOnPage, htmlToText, isPrivateAddress } from "../live";

const finding = (code: string, text: string): Finding => ({
  id: "x", engine: "ai", category: "claim", severity: "medium", title: "t", explanation: "e",
  citation: { kind: "fact", code, text: "" }, span: { start: 0, end: text.length, text }, model: null, suggestion: null, status: "open",
});

describe("live recall", () => {
  it("reduces HTML to its visible text", () => {
    const html = `<html><head><style>p{}</style><script>var a="#1 rated"</script></head><body><h1>Velura</h1><p>#1 rated Vitamin C serum&nbsp;on Nykaa &amp; more</p></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("#1 rated Vitamin C serum on Nykaa & more");
    expect(t).not.toContain("var a");
  });

  it("looks for the wording of findings that cited the fact", () => {
    const f = [finding("F-10", "#1 rated Vitamin C serum on Nykaa"), finding("F-11", "4.6 stars")];
    expect(claimPhrases(f, "F-10", "", "")).toEqual(["#1 rated Vitamin C serum on Nykaa"]);
  });

  it("falls back to sentences sharing the fact's numbers", () => {
    const body = "Meet Hydra-Dew. Skin hydration rose 24% after 2 weeks. Fragrance-free.";
    expect(claimPhrases([], "F-06", body, "Skin hydration increased by 24% after 2 weeks of daily use")).toEqual(["Skin hydration rose 24% after 2 weeks."]);
  });

  it("finds a claim still on the page despite case and punctuation, and misses a removed one", () => {
    const page = "Velura\n#1 RATED Vitamin-C serum on Nykaa!\nLoved by 2,310 buyers";
    expect(findOnPage(page, ["#1 rated Vitamin C serum on Nykaa"])).toHaveLength(1);
    expect(findOnPage("Velura\nLoved by 2,310 buyers (4.6 stars)", ["#1 rated Vitamin C serum on Nykaa"])).toHaveLength(0);
  });

  it("refuses private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "192.168.1.7", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("76.76.21.21")).toBe(false);
  });
  it("never treats a sign-in wall or a walled site as proof the claim is gone", () => {
    const article = "Velura serum. ".repeat(40);
    expect(cannotConfirmAbsence("https://www.instagram.com/p/abc/", article)).toMatch(/instagram/);
    expect(cannotConfirmAbsence("https://www.amazon.in/dp/B0X", article)).toMatch(/amazon/);
    expect(cannotConfirmAbsence("https://velura.in/serum", "Please log in to continue. " + "x ".repeat(120))).toMatch(/sign-in/);
    expect(cannotConfirmAbsence("https://velura.in/serum", "tiny")).toMatch(/almost no readable text/);
    expect(cannotConfirmAbsence("https://readback-virid.vercel.app/store/x", article)).toBeNull();
  });
});
