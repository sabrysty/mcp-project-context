/**
 * Base class for errors caused by a request on the context folder or by its content.
 * Their messages only contain paths relative to the context folder, so they are safe
 * to return to an MCP client.
 */
export class ContextError extends Error {
  override name = 'ContextError';
}

/** The requested path is invalid or would leave the context folder. */
export class PathTraversalError extends ContextError {
  override name = 'PathTraversalError';
}

export class ContextNotFoundError extends ContextError {
  override name = 'ContextNotFoundError';
}

export class UnsupportedFileTypeError extends ContextError {
  override name = 'UnsupportedFileTypeError';
}

export class FileTooLargeError extends ContextError {
  override name = 'FileTooLargeError';
}

export class InvalidFrontMatterError extends ContextError {
  override name = 'InvalidFrontMatterError';
}

/** The context folder holds more documents than the server agrees to load. */
export class ContextTooLargeError extends ContextError {
  override name = 'ContextTooLargeError';
}

/** A search query that holds no searchable word. */
export class InvalidQueryError extends ContextError {
  override name = 'InvalidQueryError';
}

export function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  );
}
