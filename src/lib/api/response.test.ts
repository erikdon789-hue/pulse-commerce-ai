import { describe, it, expect, vi } from "vitest";
import { apiSuccess, apiError, withRoute } from "./response";

describe("apiSuccess", () => {
  it("wraps data in the { ok: true, data } envelope", async () => {
    const res = apiSuccess({ foo: "bar" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { foo: "bar" } });
  });

  it("respects a custom status", async () => {
    const res = apiSuccess({ id: 1 }, { status: 201 });
    expect(res.status).toBe(201);
  });
});

describe("apiError", () => {
  it("wraps code/message/details in the { ok: false, error } envelope", async () => {
    const res = apiError("VALIDATION_ERROR", "bad input", {
      status: 400,
      details: { field: "name" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "bad input", details: { field: "name" } },
    });
  });

  it("defaults to status 400 when unspecified", () => {
    const res = apiError("X", "y");
    expect(res.status).toBe(400);
  });
});

describe("withRoute", () => {
  it("passes through a handler's normal response untouched", async () => {
    const handler = withRoute(async () => apiSuccess({ ok: true }));
    const res = await handler(new Request("http://test/api/x"));
    expect(res.status).toBe(200);
  });

  it("converts a thrown Error into a structured 500 JSON error instead of letting it bubble up as an unhandled exception (the root cause of the HTML-instead-of-JSON failure)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withRoute(async () => {
      throw new Error("boom");
    });
    const res = await handler(new Request("http://test/api/x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("boom");
    consoleSpy.mockRestore();
  });

  it("converts a thrown non-Error value into a structured JSON error too", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withRoute(async () => {
      throw "not an Error instance";
    });
    const res = await handler(new Request("http://test/api/x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toBe("Internal server error");
    consoleSpy.mockRestore();
  });
});
