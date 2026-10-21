import { McpServer } from '@modelcontextprotocol/server';

import type { Config } from './config.js';
import { ContextFolderMissingError } from './context/errors.js';
import { ContextLoader } from './context/loader.js';
import { ProjectContext, RULES_FILE } from './context/project-context.js';
import type { HandlerDependencies } from './handler-helpers.js';
import type { Logger } from './logger.js';
import { registerExplainFeaturePrompt } from './prompts/explain-feature.js';
import { registerReviewWithConventionsPrompt } from './prompts/review-with-conventions.js';
import { registerContextDocumentResources } from './resources/context-documents.js';
import { loadRules } from './security/rules.js';
import { SERVER_INSTRUCTIONS } from './server-instructions.js';
import { registerCheckCodeTool } from './tools/check-code.js';
import { registerGetConventionsTool } from './tools/get-conventions.js';
import { registerGetFeatureDocTool } from './tools/get-feature-doc.js';
import { registerGetProjectContextTool } from './tools/get-project-context.js';
import { registerListFeaturesTool } from './tools/list-features.js';
import { registerSearchDocsTool } from './tools/search-docs.js';

export const SERVER_NAME = 'mcp-project-context';
export const SERVER_VERSION = '1.3.0';

export interface ServerDependencies {
  config: Config;
  logger: Logger;
}

/**
 * Creates the MCP server and registers its tools, resources and prompts, without connecting any transport,
 * so that it can be exercised directly in tests. Rejects when the security rules of the
 * context folder are invalid: a server whose guardrails are broken must not start.
 */
export async function createServer({ config, logger }: ServerDependencies): Promise<McpServer> {
  const context = new ProjectContext(new ContextLoader({ rootDir: config.contextDir }));
  await checkRulesAtStartup(context, logger, config.contextDir);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const dependencies: HandlerDependencies = { context, logger };

  registerGetProjectContextTool(server, dependencies);
  registerListFeaturesTool(server, dependencies);
  registerGetFeatureDocTool(server, dependencies);
  registerGetConventionsTool(server, dependencies);
  registerSearchDocsTool(server, dependencies);
  registerCheckCodeTool(server, { ...dependencies, projectDir: config.projectDir });

  registerContextDocumentResources(server, dependencies);

  registerReviewWithConventionsPrompt(server, dependencies);
  registerExplainFeaturePrompt(server, dependencies);

  logger.debug('Server created', { contextDir: config.contextDir });
  return server;
}

/**
 * Fails fast on invalid rules (PROJECT_CONTEXT.md §5.3), instead of at the first check. A
 * missing context folder does not stop the server: configured once for every project, it
 * starts in projects that are not documented yet, and its tools say so.
 */
async function checkRulesAtStartup(
  context: ProjectContext,
  logger: Logger,
  contextDir: string,
): Promise<void> {
  let rules: Awaited<ReturnType<typeof loadRules>>;
  try {
    rules = await loadRules(context);
  } catch (error) {
    if (error instanceof ContextFolderMissingError) {
      logger.warn('No context folder yet: every tool reports it until the folder exists', {
        contextDir,
      });
      return;
    }
    throw error;
  }
  if (rules === undefined) {
    logger.warn(`No ${RULES_FILE} in the context folder: check_code has no rule to apply`);
  } else {
    logger.debug('Security rules loaded', { count: rules.length });
  }
}
