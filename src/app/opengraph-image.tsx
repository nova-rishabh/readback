import { ImageResponse } from "next/og";

// Share card in the proof-desk style: the #142 headline with its proof marks.
export const alt = "Readback marks up a skincare ad: “Dermatologist-loved” and “Visible glow in 7 days” underlined as findings.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const mark = (t: string, color: string) => (
    <span style={{ borderBottom: `5px solid ${color}`, background: "#f7e4e1", padding: "0 6px" }}>{t}</span>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#f7f4ee", color: "#1b1a17", padding: 72, fontFamily: "Georgia, serif" }}>
        <div style={{ fontSize: 40 }}>Readback</div>
        <div style={{ display: "flex", flexWrap: "wrap", fontSize: 58, lineHeight: 1.45, gap: 14 }}>
          {mark("Dermatologist-loved", "#b3261e")}
          <span>Vitamin C serum.</span>
          {mark("Visible glow in 7 days.", "#b3261e")}
        </div>
        <div style={{ fontSize: 30, color: "#6b655b", fontFamily: "sans-serif" }}>
          5 of 6 readers believed results are guaranteed in a week. Know before it ships.
        </div>
      </div>
    ),
    size,
  );
}
