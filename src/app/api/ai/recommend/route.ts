import { NextResponse } from "next/server";
import { openai } from "@/lib/openai/client";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { query, limit = 5 } = await request.json();

  if (!query || typeof query !== "string") {
    return NextResponse.json(
      { error: "query (string) is required" },
      { status: 400 },
    );
  }

  const embeddingResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const [{ embedding }] = embeddingResponse.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("match_products", {
    query_embedding: embedding,
    match_count: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: data });
}
