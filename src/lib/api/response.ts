import { NextResponse } from "next/server";

// Every internal API route returns one of these two shapes — never a raw
// object, never an unhandled exception's HTML error page. Mirrors what the
// client-side fetchJson() in ./fetch-json.ts expects.
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function apiSuccess<T>(data: T, init?: { status?: number }): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, { status: init?.status ?? 200 });
}

export function apiError(
  code: string,
  message: string,
  init?: { status?: number; details?: unknown },
): NextResponse<ApiError> {
  return NextResponse.json(
    { ok: false, error: { code, message, details: init?.details } },
    { status: init?.status ?? 400 },
  );
}

// Wraps a route handler so ANY unhandled exception (thrown Error, thrown
// non-Error, a rejected promise from an awaited call we didn't wrap in its
// own try/catch) is converted into a structured JSON error instead of
// bubbling up to Next's default HTML error page — the root cause of the
// "Unexpected token '<', <!DOCTYPE>" failures the frontend was hitting.
export function withRoute<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      console.error(`[api] ${request.method} ${request.url} failed:`, err);
      return apiError("INTERNAL_ERROR", message, { status: 500 });
    }
  };
}
