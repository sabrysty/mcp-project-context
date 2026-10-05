import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { ContextNotFoundError, PathTraversalError } from '../context/errors.js';
import type { ProjectContext } from '../context/project-context.js';
import { formatDocument, formatNotFound } from './format.js';
import {
  errorResult,
  MAX_NAME_LENGTH,
  READ_ONLY_ANNOTATIONS,
  runTool,
  textResult,
  type ToolDependencies,
} from './tool-helpers.js';

export const GET_FEATURE_DOC_TOOL = 'get_feature_doc';

const inputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .describe('Feature name, as returned by list_features (e.g. "authentication")'),
});

export async function getFeatureDoc(
  context: ProjectContext,
  name: string,
): Promise<CallToolResult> {
  try {
    return textResult(formatDocument(await context.getFeature(name)));
  } catch (error) {
    if (error instanceof PathTraversalError) {
      return errorResult(
        `Invalid feature name ${JSON.stringify(name)}: use a name returned by list_features.`,
      );
    }
    if (error instanceof ContextNotFoundError) {
      const { entries } = await context.listFeatures();
      return errorResult(
        formatNotFound(
          'Feature',
          name,
          entries.map((entry) => entry.name),
        ),
      );
    }
    throw error;
  }
}

export function registerGetFeatureDocTool(
  server: McpServer,
  { context, logger }: ToolDependencies,
): void {
  server.registerTool(
    GET_FEATURE_DOC_TOOL,
    {
      title: 'Feature documentation',
      description:
        'Returns the full documentation of one feature of the project: goal, flows, endpoints, ' +
        'data model and points of attention, as Markdown preceded by its metadata. Call it ' +
        'before modifying or extending a feature. Valid names come from list_features.',
      inputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    ({ name }) => runTool(GET_FEATURE_DOC_TOOL, logger, () => getFeatureDoc(context, name)),
  );
}
