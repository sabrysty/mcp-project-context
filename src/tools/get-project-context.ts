import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';

import { ContextNotFoundError } from '../context/errors.js';
import type { ProjectContext } from '../context/project-context.js';
import { formatDocument } from './format.js';
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  runTool,
  textResult,
  type ToolDependencies,
} from './tool-helpers.js';

export const GET_PROJECT_CONTEXT_TOOL = 'get_project_context';

export async function getProjectContext(context: ProjectContext): Promise<CallToolResult> {
  try {
    return textResult(formatDocument(await context.getProject()));
  } catch (error) {
    if (error instanceof ContextNotFoundError) {
      return errorResult(
        'The project overview is not documented: the context folder has no project.md file.',
      );
    }
    throw error;
  }
}

export function registerGetProjectContextTool(
  server: McpServer,
  { context, logger }: ToolDependencies,
): void {
  server.registerTool(
    GET_PROJECT_CONTEXT_TOOL,
    {
      title: 'Project overview',
      description:
        'Returns the overview of the project you are working on: business domain and glossary, ' +
        'architecture, tech stack, environments and team organization, as Markdown preceded by ' +
        'its metadata (owner, last update). Call it first, before writing or changing code in ' +
        'this project, to understand where your change fits.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () => runTool(GET_PROJECT_CONTEXT_TOOL, logger, () => getProjectContext(context)),
  );
}
