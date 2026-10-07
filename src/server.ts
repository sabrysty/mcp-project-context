import { McpServer } from '@modelcontextprotocol/server';

import type { Config } from './config.js';
import { ContextLoader } from './context/loader.js';
import { ProjectContext, RULES_FILE } from './context/project-context.js';
import type { Logger } from './logger.js';
import { loadRules } from './security/rules.js';
import { registerCheckCodeTool } from './tools/check-code.js';
import { registerGetConventionsTool } from './tools/get-conventions.js';
import { registerGetFeatureDocTool } from './tools/get-feature-doc.js';
import { registerGetProjectContextTool } from './tools/get-project-context.js';
import { registerListFeaturesTool } from './tools/list-features.js';
import { registerPingTool } from './tools/ping.js';
import { registerSearchDocsTool } from './tools/search-docs.js';
import type { ToolDependencies } from './tools/tool-helpers.js';

export const SERVER_NAME = 'mcp-project-context';
export const SERVER_VERSION = '0.1.0';

export interface ServerDependencies {
  config: Config;
  logger: Logger;
}

/**
 * Creates the MCP server and registers its tools, without connecting any transport,
 * so that it can be exercised directly in tests. Rejects when the security rules of the
 * context folder are invalid: a server whose guardrails are broken must not start.
 */
export async function createServer({ config, logger }: ServerDependencies): Promise<McpServer> {
  const context = new ProjectContext(new ContextLoader({ rootDir: config.contextDir }));
  await checkRulesAtStartup(context, logger);

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const tools: ToolDependencies = { context, logger };

  registerPingTool(server);
  registerGetProjectContextTool(server, tools);
  registerListFeaturesTool(server, tools);
  registerGetFeatureDocTool(server, tools);
  registerGetConventionsTool(server, tools);
  registerSearchDocsTool(server, tools);
  registerCheckCodeTool(server, tools);

  logger.debug('Server created', { contextDir: config.contextDir });
  return server;
}

/** Fails fast on invalid rules (PROJECT_CONTEXT.md §5.3), instead of at the first check. */
async function checkRulesAtStartup(context: ProjectContext, logger: Logger): Promise<void> {
  const rules = await loadRules(context);
  if (rules === undefined) {
    logger.warn(`No ${RULES_FILE} in the context folder: check_code has no rule to apply`);
  } else {
    logger.debug('Security rules loaded', { count: rules.length });
  }
}
