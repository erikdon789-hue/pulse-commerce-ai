import { createServiceClient } from "@/lib/supabase/service";

const CREATIVE_ASSETS_BUCKET = "creative-assets";

// Uploads a generated image (logo, ad banner, etc.) and returns its public
// URL. Requires the `creative-assets` public storage bucket — see
// supabase/migrations/0002_store_builder.sql's trailing comment for the
// one-line SQL to create it if it doesn't exist yet.
export async function uploadGeneratedImage(
  path: string,
  buffer: Buffer,
): Promise<string> {
  const supabase = createServiceClient();

  const { error } = await supabase.storage
    .from(CREATIVE_ASSETS_BUCKET)
    .upload(path, buffer, { contentType: "image/png", upsert: true });

  if (error) {
    throw new Error(`Failed to upload generated image: ${error.message}`);
  }

  const { data } = supabase.storage.from(CREATIVE_ASSETS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
