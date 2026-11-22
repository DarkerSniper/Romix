/**
 * Placeholder sleeves for mock data and local files without embedded art.
 * Flat, two-colour graphic designs in the spirit of printed record sleeves:
 * no gradients, one bold shape. Deterministic per seed.
 */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Muted print-like inks. [background, foreground] pairs chosen to sit well together. */
const INKS: Array<[string, string]> = [
  ["#E9E2D6", "#C2402F"], // paper / vermilion
  ["#1F2A33", "#E8B04A"], // ink / ochre
  ["#2E5E4E", "#EDE6D8"], // forest / paper
  ["#D9CBB4", "#22303C"], // sand / navy
  ["#B8432F", "#F2E6D3"], // brick / cream
  ["#F1EEE8", "#1C1C1E"], // off-white / black
  ["#3B4A6B", "#D7C6A5"], // denim / linen
  ["#8C9A86", "#20261F"], // sage / charcoal
  ["#1C1C1E", "#EDEDED"], // black / white
  ["#C9A227", "#1E1E1E"], // mustard / black
];

export interface GeneratedCover {
  cover: string;
  color: string;
}

export function makeCover(seed: string): GeneratedCover {
  const h = hash(seed);
  const [bg, fg] = INKS[h % INKS.length];
  const v = (h >> 8) % 5;
  const o = (h >> 12) % 30;

  const shapes = [
    `<circle cx="${50 + o - 15}" cy="58" r="30" fill="${fg}"/>`,
    `<rect x="0" y="${38 + (o % 20)}" width="100" height="18" fill="${fg}"/><rect x="0" y="${62 + (o % 20)}" width="100" height="4" fill="${fg}"/>`,
    `<path d="M0 100 A100 100 0 0 1 100 0 V100Z" fill="${fg}"/>`,
    `<rect x="${18 + (o % 12)}" y="18" width="12" height="64" fill="${fg}"/><circle cx="68" cy="50" r="18" fill="none" stroke="${fg}" stroke-width="8"/>`,
    `<path d="M50 14 L86 86 H14Z" fill="${fg}"/>`,
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/>${shapes[v]}</svg>`;
  return { cover: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, color: bg };
}
