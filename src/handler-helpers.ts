import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import { ContextError, PathTraversalError, UnsupportedFileTypeError } from './context/errors.js';
import type { ProjectContext } from './context/project-context.js';
import type { Logger } from './logger.js';

/** What the handlers of the tools, resources and prompts need. */
export interface HandlerDependencies {
  context: ProjectContext;
  logger: Logger;
}

/**
 * Runs a resource or prompt handler. Unlike a tool, such a request has no error result: a
 * failure is a JSON-RPC error, whose message the SDK sends as it is. So, as in runTool,
 * unexpected errors are logged in full but reported with a generic message: system details
 * such as absolute paths or stack traces never reach the client.
 */
export async function runRequest<T>(
  description: string,
  logger: Logger,
  handler: () => Promise<T>,
): Promise<T> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    // The request names a path that cannot be a document: the client's mistake.
    if (error instanceof PathTraversalError || error instanceof UnsupportedFileTypeError) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, error.message);
    }
    // A problem with the content, such as an invalid front-matter. Context errors only hold
    // paths relative to the context folder: their messages are safe to show.
    if (error instanceof ContextError) {
      throw new ProtocolError(ProtocolErrorCode.InternalError, error.message);
    }
    logger.error(`${description} failed`, {
      error: error instanceof Error ? error.stack : String(error),
    });
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      `${description} failed because of an internal error; details are in the server logs.`,
    );
  }
}
