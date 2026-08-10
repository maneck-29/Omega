/**
 * Domain errors carrying HTTP status, so route handlers translate uniformly
 * instead of each one inventing its own mapping.
 */

export class DomainError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const badRequest = (message: string, code = "bad_request") =>
  new DomainError(message, 400, code);

export const unauthorized = (message = "Not authenticated") =>
  new DomainError(message, 401, "unauthorized");

export const forbidden = (message: string, code = "forbidden") =>
  new DomainError(message, 403, code);

export const notFound = (message: string, code = "not_found") =>
  new DomainError(message, 404, code);

export const conflict = (message: string, code = "conflict") =>
  new DomainError(message, 409, code);

export function toErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code: string };
} {
  if (error instanceof DomainError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
    };
  }
  // Repository uniqueness violations surface as plain Errors.
  if (error instanceof Error && /already exists/i.test(error.message)) {
    return { status: 409, body: { error: error.message, code: "conflict" } };
  }
  return {
    status: 500,
    body: { error: "Internal server error", code: "internal_error" },
  };
}
