/**
 * Base application error class for service-layer errors.
 *
 * Caught by the global `.onError()` handler and normalised into:
 *   { error: { code, message, details? } }
 *
 * Use Elysia's `status()` helper for HTTP-layer short-circuits
 * (auth, permissions, etc.) — reserve AppError for domain / service errors.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
