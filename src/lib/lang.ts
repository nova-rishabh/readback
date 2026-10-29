// Supported content languages. Pure data: shared by the UI, the API routes and the AI prompts.
import type { Lang } from "./types";

export const LANGS: Lang[] = ["en", "hi", "hinglish", "ta", "mr"];

export const LANG_NAME: Record<Lang, string> = {
  en: "English",
  hi: "Hindi",
  hinglish: "Hinglish",
  ta: "Tamil",
  mr: "Marathi",
};

/** BCP 47 tag for the lang attribute, so screen readers pronounce the copy in the right language. */
export const LANG_TAG: Record<Lang, string> = { en: "en", hi: "hi", hinglish: "hi-Latn", ta: "ta", mr: "mr" };

export const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as string[]).includes(v);
