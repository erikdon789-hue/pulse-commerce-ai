import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { openai } from "@/lib/openai/client";

// Current flagship chat model per the installed openai SDK's ChatModel type
// (resources/shared.d.ts) — override via env if you want a cheaper/newer tier.
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL ?? "gpt-5.4";

export async function generateStructured<Schema extends z.ZodType>(params: {
  schema: Schema;
  schemaName: string;
  instructions: string;
  input: string;
}): Promise<z.infer<Schema>> {
  const response = await openai.responses.parse({
    model: TEXT_MODEL,
    instructions: params.instructions,
    input: params.input,
    text: { format: zodTextFormat(params.schema, params.schemaName) },
  });

  if (!response.output_parsed) {
    throw new Error(
      `OpenAI returned no parsed output for schema "${params.schemaName}"`,
    );
  }

  return response.output_parsed as z.infer<Schema>;
}
