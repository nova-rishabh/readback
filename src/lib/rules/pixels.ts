// Pixel analysis with sharp: deterministic k-means, text-box fg/bg contrast, and dominant colours.
import sharp from "sharp";
import { contrastRatio, labChroma, rgbToLab, relativeLuminance, type RGB } from "./color";

export interface Cluster { centroid: RGB; size: number }

/** Deterministic k-means in RGB: centroids start at evenly spaced luminance quantiles (no randomness). */
export function kmeans(pts: RGB[], k: number, iters = 25): Cluster[] {
  if (!pts.length) return [];
  const order = pts.map((_, i) => i).sort((a, b) => relativeLuminance(pts[a]) - relativeLuminance(pts[b]) || a - b);
  let cents: RGB[] = Array.from({ length: k }, (_, i) =>
    [...pts[order[k === 1 ? Math.floor(pts.length / 2) : Math.round((i * (pts.length - 1)) / (k - 1))]]] as RGB);
  const assign = new Int32Array(pts.length).fill(-1);
  for (let it = 0; it < iters; it++) {
    let changed = false;
    pts.forEach((p, i) => {
      let best = 0, bd = Infinity;
      cents.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      });
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    });
    if (!changed) break;
    const sums = cents.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    cents = cents.map((c, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : c) as RGB);
  }
  const sizes: number[] = new Array(k).fill(0);
  assign.forEach((a) => sizes[a]++);
  return cents.map((c, j) => ({ centroid: c.map(Math.round) as RGB, size: sizes[j] }));
}

async function loadRgb(img: Buffer, maxDim: number, box?: [number, number, number, number], nearest = false): Promise<RGB[]> {
  let s = sharp(img).flatten({ background: "#ffffff" }).removeAlpha();
  if (box) {
    const { width = 0, height = 0 } = await sharp(img).metadata();
    const left = Math.min(width - 1, Math.max(0, Math.floor(box[0] * width)));
    const top = Math.min(height - 1, Math.max(0, Math.floor(box[1] * height)));
    s = s.extract({
      left, top,
      width: Math.max(1, Math.min(width - left, Math.round(box[2] * width))),
      height: Math.max(1, Math.min(height - top, Math.round(box[3] * height))),
    });
  }
  s = s.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true, kernel: nearest ? "nearest" : "lanczos3" });
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  const out: RGB[] = [];
  for (let i = 0; i < info.width * info.height; i++) out.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);
  return out;
}

/** Contrast inside one normalized box: 2-cluster k-means, smaller cluster = fg, larger = bg. Null if the region is flat. */
export async function boxContrast(img: Buffer, box: [number, number, number, number]) {
  const cl = kmeans(await loadRgb(img, 96, box, true), 2);
  if (cl.length < 2 || cl.some((c) => c.size === 0)) return null;
  const [fg, bg] = cl[0].size <= cl[1].size ? [cl[0], cl[1]] : [cl[1], cl[0]];
  return { fg: fg.centroid, bg: bg.centroid, ratio: contrastRatio(fg.centroid, bg.centroid) };
}

/** Dominant non-neutral colours: 64px resize, k=5, drops clusters with low Lab chroma. */
export async function dominantColors(img: Buffer, minChroma = 12) {
  const pts = await loadRgb(img, 64);
  return kmeans(pts, 5)
    .filter((c) => c.size > 0)
    .map((c) => ({ rgb: c.centroid, share: c.size / pts.length }))
    .filter((c) => labChroma(rgbToLab(c.rgb)) >= minChroma);
}
