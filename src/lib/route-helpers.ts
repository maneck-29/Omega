/**
 * Route handler plumbing: uniform error mapping and JSON body parsing.
 */

import { NextResponse } from "next/server";
import { badRequest, toErrorResponse } from "./errors";
import { ensureSeeded } from "./seed";

/**
 * Wraps a handler so domain errors become correct status codes and fixtures are
 * present. Seeding here is a development affordance of the in-memory store; it
 * goes away with a real database and migrations.
 */
export function handler<T>(
  fn: () => Promise<T>,
  { status = 200 }: { status?: number } = {},
): Promise<NextResponse> {
  return (async () => {
    try {
      await ensureSeeded();
      const data = await fn();
      return NextResponse.json(data as object, { status });
    } catch (error) {
      const { status: errorStatus, body } = toErrorResponse(error);
      if (errorStatus === 500) {
        console.error("Unhandled route error:", error);
      }
      return NextResponse.json(body, { status: errorStatus });
    }
  })();
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON", "invalid_json");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Request body must be a JSON object", "invalid_json");
  }

  return parsed as Record<string, unknown>;
}
