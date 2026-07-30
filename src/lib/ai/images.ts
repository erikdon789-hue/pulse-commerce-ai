import { openai } from "@/lib/openai/client";

// GPT image models always return base64-encoded images (no url option),
// per the installed openai SDK's images.d.ts.
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5";

export async function generateImageBuffer(prompt: string): Promise<Buffer> {
  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: "1024x1024",
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("Image generation returned no data");
  }

  return Buffer.from(b64, "base64");
}
