// Client-side defensive fetch wrapper. Every internal API route now returns
// { ok: true, data } or { ok: false, error: {...} } (see lib/api/response.ts)
// — but this guards the one thing that format alone can't: a response that
// isn't JSON at all (a proxy/tunnel timeout page, a platform 502, etc), which
// previously crashed at `res.json()` with an opaque "Unexpected token '<'".
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly endpoint: string,
    public readonly status: number,
    public readonly contentType: string | null,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    throw new ApiClientError(
      err instanceof Error ? err.message : "Network request failed",
      input,
      0,
      null,
    );
  }

  const contentType = res.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    const bodyText = await res.text().catch(() => "");
    throw new ApiClientError(
      `Expected JSON from ${input} but got "${contentType ?? "unknown content-type"}" ` +
        `(HTTP ${res.status}). ${bodyText.slice(0, 200)}`,
      input,
      res.status,
      contentType,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError(
      `Response from ${input} claimed to be JSON but failed to parse (HTTP ${res.status})`,
      input,
      res.status,
      contentType,
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("ok" in body) ||
    typeof (body as { ok: unknown }).ok !== "boolean"
  ) {
    throw new ApiClientError(
      `Response from ${input} was JSON but not in the expected { ok, data|error } shape`,
      input,
      res.status,
      contentType,
    );
  }

  const parsed = body as { ok: boolean; data?: T; error?: { code: string; message: string } };

  if (!parsed.ok) {
    throw new ApiClientError(
      parsed.error?.message ?? `Request to ${input} failed`,
      input,
      res.status,
      contentType,
      parsed.error?.code,
    );
  }

  return parsed.data as T;
}
