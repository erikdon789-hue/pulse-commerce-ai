import OpenAI from "openai";

export class AINotConfiguredError extends Error {
  constructor() {
    super("AI features are not configured yet");
    this.name = "AINotConfiguredError";
  }
}

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}
