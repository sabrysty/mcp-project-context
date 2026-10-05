import { McpServer } from '@modelcontextprotocol/server';

import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { registerPingTool } from './tools/ping.js';

export const SERVER_NAME = 'mcp-project-context';
export const SERVER_VERSION = '0.1.0';

export interface ServerDependencies {
  config: Config;
  logger: Logger;
}

/**
 * Creates the MCP server and registers its tools, without connecting any transport,
 * so that it can be exercised directly in tests.
 */
export function createServer({ config, logger }: ServerDependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerPingTool(server);

  logger.debug('Server created', { contextDir: config.contextDir });
  return server;
}
