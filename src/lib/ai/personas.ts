// Reader panel: the 3 built-in personas, panel assembly (3 brand + 3 built-in), and the reader prompt.
import type { BrandSpace, Channel, Lang, Persona } from "../types";
import type { Img } from "./provider";

export const BUILTIN_PERSONAS: Persona[] = [
  {
    id: "builtin-literal",
    name: "Literal first-time buyer",
    description: "Has never heard of the brand. Takes every word at face value, skims in seconds, does not read fine print.",
    lang: "en",
    builtin: true,
  },
  {
    id: "builtin-hindi",
    name: "Hindi/Hinglish reader",
    description: "Thinks and reads in Hindi/Hinglish. Notices how phrases land idiomatically, including words that sound stronger than the English original.",
    lang: "hinglish",
    builtin: true,
  },
  {
    id: "builtin-asci",
    name: "ASCI code sceptic",
    description: "Advertising-standards reviewer. Assumes unsubstantiated, absolute or health-related claims are misleading until proven.",
    lang: "en",
    builtin: true,
  },
];

export function panelFor(brand: BrandSpace): Persona[] {
  const custom = brand.personas.filter((p) => !p.builtin).slice(0, 3);
  const builtins = BUILTIN_PERSONAS.map((b) => brand.personas.find((p) => p.builtin && p.name === b.name) ?? b);
  return [...custom, ...builtins];
}

export interface ReadCtx {
  text: string;
  intent: string;
  lang: Lang;
  channel: Channel;
  image: Img | null;
  brandName: string;
  embargo: string[];
}

export function readerPrompt(p: Persona, c: ReadCtx): { system: string; prompt: string } {
  const hindi = p.lang === "hi" || p.lang === "hinglish";
  const system = [
    `You role-play a real person reading a ${c.channel} social post or product listing for about 5 seconds.`,
    `Persona: ${p.name}. ${p.description}`,
    hindi ? "Read the post in Hindi/Hinglish as a native speaker would. Write beliefs in English, but copy trigger_quote exactly as it appears in the post." : "",
    "Report what you BELIEVE after reading, not what is strictly stated.",
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = [
    `Brand: ${c.brandName}. Post language: ${c.lang}.${c.image ? " The post image is attached." : " There is no image."}`,
    `POST TEXT:\n"""\n${c.text}\n"""`,
    `The creator's declared intended takeaway: "${c.intent}"`,
    "",
    "Tasks:",
    "1. List every distinct belief a reasonable reader like you would walk away with, especially implied ones: endorsement (doctors, experts), guarantees, natural/eco/chemical-free claims, speed of results, health effects, price, comparison to others, urgency.",
    "2. Each belief needs trigger_quote: an EXACT substring of the post text that caused it. If the belief comes only from the image, use an empty trigger_quote and describe the element in visual_element; otherwise visual_element is null.",
    "3. category must be one of the allowed values; confidence is 0 to 1.",
    "4. tone: adjectives describing how the post sounds to you (e.g. pushy, warm, salesy, calm).",
    "5. takeaway: one sentence on what you think the post says. intent_match: true only if you took away the declared intent.",
    "Do not invent beliefs that have no trigger. Keep each belief to one short declarative sentence.",
  ].join("\n");
  return { system, prompt };
}
