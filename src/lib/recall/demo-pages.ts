// Demo storefront pages: stand-ins for Velura's live product pages, so Live Fact Recall has real pages to fetch.
// Seeded into the live_pages table (migration 0003); this copy is also the fallback when that table is missing.
export const DEMO_PAGES: Record<string, { title: string; body: string }> = {
  "velura-vitamin-c-nykaa": {
    title: "Velura Vitamin C Serum, 30 ml (Nykaa listing)",
    body: [
      "#1 rated Vitamin C serum on Nykaa",
      "Loved by 2,310 verified buyers (4.6 stars). 15% L-ascorbic acid with ferulic acid and vitamin E for a radiant-looking glow.",
      "Fragrance-free. Dermatologist-tested. 92% naturally derived ingredients (ISO 16128).",
      "MRP Rs 899. Free shipping on orders above Rs 499.",
    ].join("\n\n"),
  },
  "velura-hydra-dew-reel": {
    title: "Hydra-Dew launch reel (Instagram caption)",
    body: [
      "Meet Hydra-Dew: in our clinical study, skin hydration rose 24% after 2 weeks of daily use.*",
      "Fragrance-free and gentle on skin.",
      "*Results may vary.",
    ].join("\n\n"),
  },
};

export const DEMO_STORE_PATH = "/store/";
