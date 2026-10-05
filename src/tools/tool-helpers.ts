import type { CallToolResult } from '@modelcontextprotocol/server';

import { ContextError } from '../context/errors.js';
import type { ProjectContext } from '../context/project-context.js';
import type { Logger } from '../logger.js';

export interface ToolDependencies {
  context: ProjectContext;
  logger: Logger;
}

/** Longest feature name or convention topic a tool accepts. */
export const MAX_NAME_LENGTH = 200;

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Runs a tool handler and turns its failures into `isError` results the agent can act on.
 * Unexpected errors are logged in full but reported with a generic message: system details
 * such as absolute paths or stack traces never reach the client.
 */
export async function runTool(
  toolName: string,
  logger: Logger,
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ContextError) {
      return errorResult(error.message);
    }
    logger.error(`Tool ${toolName} failed`, {
      error: error instanceof Error ? error.stack : String(error),
    });
    return errorResult(
      `${toolName} failed because of an internal error; details are in the server logs.`,
    );
  }
}
