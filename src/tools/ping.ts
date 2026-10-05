import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';

import { READ_ONLY_ANNOTATIONS } from './tool-helpers.js';

export const PING_TOOL_NAME = 'ping';

export function handlePing(): CallToolResult {
  return { content: [{ type: 'text', text: 'pong' }] };
}

export function registerPingTool(server: McpServer): void {
  server.registerTool(
    PING_TOOL_NAME,
    {
      title: 'Ping',
      description:
        'Health check. Call it to verify that the project-context server is reachable. Returns the text "pong" and has no side effects.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () => handlePing(),
  );
}
