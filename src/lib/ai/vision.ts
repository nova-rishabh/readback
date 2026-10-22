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

export async function extractTextBoxes(image: Img): Promise<TextBox[]> {
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
    return [];
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
