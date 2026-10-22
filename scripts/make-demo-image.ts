// Generates public/demo/velura-142.png: abstract lab-coat-white panel + leaf-green shapes +
// deliberately low-contrast pale text, so the Rule Engine's WCAG 1.4.3 and palette checks fire.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const OUT = resolve(process.cwd(), "public/demo/velura-142.png");
const S = 1080;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect width="${S}" height="${S}" fill="#EAF0E8"/>
  <!-- leaf-green shapes (brighter than the brand palette on purpose) -->
  <ellipse cx="170" cy="190" rx="210" ry="95" fill="#5DBB3F" transform="rotate(-38 170 190)"/>
  <ellipse cx="930" cy="150" rx="190" ry="80" fill="#4FAE36" transform="rotate(35 930 150)"/>
  <ellipse cx="960" cy="930" rx="230" ry="100" fill="#6CC24A" transform="rotate(-30 960 930)"/>
  <ellipse cx="110" cy="900" rx="160" ry="70" fill="#4FAE36" transform="rotate(28 110 900)"/>
  <path d="M120 190 Q 300 120 470 60" stroke="#2E7D32" stroke-width="6" fill="none"/>
  <!-- abstract model: lab coat -->
  <path d="M300 1080 L330 700 Q 540 600 750 700 L780 1080 Z" fill="#FBFCFA"/>
  <path d="M540 690 L470 1080 M540 690 L610 1080" stroke="#D5DCD3" stroke-width="5" fill="none"/>
  <path d="M430 720 L540 880 L650 720 L600 700 L540 760 L480 700 Z" fill="#F1F4EE" stroke="#D5DCD3" stroke-width="3"/>
  <rect x="690" y="860" width="46" height="62" rx="6" fill="#DCE5D9"/>
  <!-- head -->
  <rect x="505" y="610" width="70" height="95" rx="30" fill="#C99577"/>
  <ellipse cx="540" cy="520" rx="108" ry="132" fill="#D9A889"/>
  <path d="M430 500 Q 440 372 540 372 Q 645 372 652 500 Q 610 430 540 430 Q 470 430 430 500 Z" fill="#2B2220"/>
  <!-- serum bottle -->
  <rect x="780" y="470" width="86" height="190" rx="14" fill="#E8A33D"/>
  <rect x="805" y="430" width="36" height="46" rx="6" fill="#F4F7F2"/>
  <!-- low-contrast pale overlay text (about 1.2:1 against the panel) -->
  <rect x="150" y="948" width="780" height="92" rx="6" fill="#E6EDE3"/>
  <text x="540" y="1010" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="600" fill="#D3DFD0">Visible glow in 7 days</text>
</svg>`;

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT);
  console.log(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
