import { NextResponse } from "next/server";
import { openai } from "@/lib/openai/client";

export async function POST(request: Request) {
  const { messages } = await request.json();

  if (!Array.isArray(messages)) {
    return NextResponse.json(
      { error: "messages (array) is required" },
      { status: 400 },
    );
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are the AI shopping assistant for Pulse Commerce AI. Help customers find products and answer questions concisely.",
      },
      ...messages,
    ],
  });

  return NextResponse.json({ message: completion.choices[0]?.message });
}
