/**
 * Shared HTTP helpers for the route handlers.
 *
 * Domain errors carry no status codes of their own, so the mapping lives here
 * and every route reports failures consistently.
 */

import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError, ValidationError } from "./posts";

export function errorResponse(cause: unknown): NextResponse {
  if (cause instanceof ValidationError) {
    return NextResponse.json({ error: cause.message }, { status: 400 });
  }
  if (cause instanceof NotFoundError) {
    return NextResponse.json({ error: cause.message }, { status: 404 });
  }
  if (cause instanceof ForbiddenError) {
    return NextResponse.json({ error: cause.message }, { status: 403 });
  }

  // Unexpected: log the detail server-side, return something generic.
  console.error("[api] unhandled error:", cause);
  return NextResponse.json(
    { error: "Something went wrong. Try again." },
    { status: 500 },
  );
}

/** Parse a bounded integer query parameter, falling back to a default. */
export function intParam(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
}

/** Coerce an unknown JSON value to a trimmed string, or null. */
export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
