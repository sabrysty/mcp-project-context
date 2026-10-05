import { McpServer } from '@modelcontextprotocol/server';

import type { Config } from './config.js';
import { ContextLoader } from './context/loader.js';
import { ProjectContext } from './context/project-context.js';
import type { Logger } from './logger.js';
import { registerGetConventionsTool } from './tools/get-conventions.js';
import { registerGetFeatureDocTool } from './tools/get-feature-doc.js';
import { registerGetProjectContextTool } from './tools/get-project-context.js';
import { registerListFeaturesTool } from './tools/list-features.js';
import { registerPingTool } from './tools/ping.js';
import type { ToolDependencies } from './tools/tool-helpers.js';

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
  const tools: ToolDependencies = {
    context: new ProjectContext(new ContextLoader({ rootDir: config.contextDir })),
    logger,
  };

  registerPingTool(server);
  registerGetProjectContextTool(server, tools);
  registerListFeaturesTool(server, tools);
  registerGetFeatureDocTool(server, tools);
  registerGetConventionsTool(server, tools);

  logger.debug('Server created', { contextDir: config.contextDir });
  return server;
}
