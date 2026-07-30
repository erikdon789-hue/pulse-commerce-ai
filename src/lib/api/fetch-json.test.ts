import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchJson, ApiClientError } from "./fetch-json";

function mockFetchOnce(response: {
  status?: number;
  contentType?: string | null;
  body: string;
}) {
  const headers = new Headers();
  if (response.contentType) headers.set("content-type", response.contentType);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(response.body, {
        status: response.status ?? 200,
        headers,
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("returns the unwrapped data field on a successful envelope", async () => {
    mockFetchOnce({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { store: { id: "abc" } } }),
    });
    const data = await fetchJson<{ store: { id: string } }>("/api/stores");
    expect(data).toEqual({ store: { id: "abc" } });
  });

  it("throws ApiClientError with the server's message/code on an error envelope", async () => {
    mockFetchOnce({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: { code: "INSUFFICIENT_CREDITS", message: "Not enough credits" },
      }),
    });
    await expect(fetchJson("/api/stores", { method: "POST" })).rejects.toMatchObject({
      message: "Not enough credits",
      code: "INSUFFICIENT_CREDITS",
      status: 402,
    });
  });

  it("throws a descriptive ApiClientError instead of crashing when the response is HTML — this is the exact failure mode from the reported bug (a proxy/tunnel timeout page served instead of JSON)", async () => {
    mockFetchOnce({
      status: 524,
      contentType: "text/html; charset=UTF-8",
      body: "<!DOCTYPE html><html><body>Gateway timeout</body></html>",
    });
    const promise = fetchJson("/api/stores/123/creative", { method: "POST" });
    await expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await expect(promise).rejects.toMatchObject({
      endpoint: "/api/stores/123/creative",
      status: 524,
      contentType: "text/html; charset=UTF-8",
    });
    await expect(promise).rejects.toThrow(/Expected JSON/);
  });

  it("throws ApiClientError when content-type claims JSON but the body doesn't parse", async () => {
    mockFetchOnce({
      contentType: "application/json",
      body: "not actually json{{{",
    });
    await expect(fetchJson("/api/x")).rejects.toThrow(/failed to parse/);
  });

  it("throws ApiClientError when the JSON body doesn't match the { ok, ... } envelope shape", async () => {
    mockFetchOnce({
      contentType: "application/json",
      body: JSON.stringify({ store: { id: "abc" } }), // old pre-Phase-0 shape
    });
    await expect(fetchJson("/api/x")).rejects.toThrow(/expected \{ ok, data\|error \} shape/);
  });

  it("wraps a network failure (fetch throwing) in ApiClientError rather than letting it propagate raw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchJson("/api/x")).rejects.toMatchObject({
      endpoint: "/api/x",
      status: 0,
    });
  });
});
