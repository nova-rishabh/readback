// Vision helpers: text-box extraction (normalized boxes for the contrast rule) and yes/no visual confirmation.
import { z } from "zod";
import { mockBoxes, mockConfirmVisual } from "./mock";
import { callObject, isMock, type Img } from "./provider";

export interface TextBox {
  text: string;
  box: [number, number, number, number]; // normalized 0..1 [x, y, w, h]
}

const boxesSchema = z.object({
  boxes: z.array(z.object({ text: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() })),
});
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Text boxes in the image, or null when the vision call failed (contrast then cannot be assessed). */
export async function extractTextBoxes(image: Img): Promise<TextBox[] | null> {
  if (isMock()) return mockBoxes();
  try {
    const o = await callObject({
      schema: boxesSchema,
      system: "You locate text overlaid on images. Return tight bounding boxes as fractions of image width and height (0 to 1, origin top-left).",
      prompt: "List every piece of text rendered inside the image, with x, y (top-left corner), w and h as fractions of the image size. Return an empty list if there is no text.",
      image,
      temperature: 0,
    });
    return o.boxes
      .map((b) => ({ text: b.text, box: [clamp01(b.x), clamp01(b.y), clamp01(b.w), clamp01(b.h)] as TextBox["box"] }))
      .filter((b) => b.text.trim() && b.box[2] > 0 && b.box[3] > 0);
  } catch {
    return null;
  }
}

export async function confirmVisual(image: Img, element: string): Promise<boolean> {
  if (isMock()) return mockConfirmVisual(element);
  try {
    const o = await callObject({
      schema: z.object({ present: z.boolean() }),
      system: "You verify image contents. Answer strictly yes or no through the schema.",
      prompt: `Is this visible in the image: "${element}"?`,
      image,
      temperature: 0,
    });
    return o.present;
  } catch {
    return false;
  }
}

/** Batched yes/no for every distinct visual element in one call; returns the ones actually visible. */
export async function confirmVisuals(image: Img, elements: string[]): Promise<Set<string>> {
  if (!elements.length) return new Set();
  if (isMock()) return new Set(elements.filter(mockConfirmVisual));
  try {
    const o = await callObject({
      schema: z.object({ answers: z.array(z.object({ index: z.number(), present: z.boolean() })) }),
      system: "You verify image contents. Answer strictly through the schema, one entry per listed element.",
      prompt: `Is each of these visible in the image?\n${elements.map((e, i) => `${i}. ${e}`).join("\n")}`,
      image,
      temperature: 0,
    });
    return new Set(o.answers.filter((a) => a.present && elements[a.index]).map((a) => elements[a.index]));
  } catch {
    return new Set();
  }
}
