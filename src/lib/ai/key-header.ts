// A viewer's own Gemini key travels in this header on AI requests. It is used for that request only:
// never stored, never logged, never put in a URL.
export const KEY_HEADER = "x-gemini-key";
const KEY_RE = /^AIza[0-9A-Za-z_-]{30,60}$/;

export function keyFrom(req: Request): string | undefined {
  const k = req.headers.get(KEY_HEADER)?.trim();
  return k && KEY_RE.test(k) ? k : undefined;
}
