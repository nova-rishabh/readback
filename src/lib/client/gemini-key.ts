"use client";

// A viewer's own Gemini API key, kept only in this browser (localStorage) and sent with their own AI requests.
import { useEffect, useState } from "react";

const STORE = "readback-gemini-key";
const EVENT = "readback:gemini-key";
export const KEY_HEADER = "x-gemini-key";

export function getGeminiKey(): string | null {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

export function setGeminiKey(key: string | null) {
  try {
    if (key) localStorage.setItem(STORE, key);
    else localStorage.removeItem(STORE);
  } catch {
    /* storage blocked: the key just won't persist */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Headers to add to an AI request: the viewer's key if they saved one, nothing otherwise. */
export function keyHeaders(): Record<string, string> {
  const k = getGeminiKey();
  return k ? { [KEY_HEADER]: k } : {};
}

export function useGeminiKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setKey(getGeminiKey());
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return key;
}
