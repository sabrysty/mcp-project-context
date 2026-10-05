import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ProjectContext } from '../context/project-context.js';
import { countOf, formatSkipped, joinSections } from './format.js';
import { READ_ONLY_ANNOTATIONS, runTool, type ToolDependencies } from './tool-helpers.js';

export const LIST_FEATURES_TOOL = 'list_features';

const outputSchema = z.object({
  features: z.array(
    z.object({
      name: z.string().describe('Name to pass to get_feature_doc'),
      title: z.string(),
      tags: z.array(z.string()),
      owner: z.string().optional(),
      updated: z.string().optional().describe('Last update, YYYY-MM-DD'),
    }),
  ),
  skipped: z
    .array(z.object({ path: z.string(), reason: z.string() }))
    .describe('Feature files that could not be loaded, with the reason'),
});

type FeatureList = z.infer<typeof outputSchema>;
type FeatureSummary = FeatureList['features'][number];

export async function listFeatures(context: ProjectContext): Promise<CallToolResult> {
  const { entries, skipped } = await context.listFeatures();
  const result: FeatureList = {
    features: entries.map(({ name, document }) => ({
      name,
      title: document.title,
      tags: document.tags,
      owner: document.owner,
      updated: document.updated,
    })),
    skipped,
  };

  return {
    content: [{ type: 'text', text: formatFeatureList(result) }],
    structuredContent: result,
  };
}

function formatFeatureList({ features, skipped }: FeatureList): string {
  const list =
    features.length === 0
      ? 'No feature is documented yet: the context folder has no Markdown file under features/.'
      : [
          `${countOf(features.length, 'documented feature')}:`,
          ...features.map(formatFeatureLine),
          '',
          'Read one with get_feature_doc, passing its name.',
        ].join('\n');

  return joinSections(list, formatSkipped(skipped));
}

function formatFeatureLine({ name, title, tags, updated }: FeatureSummary): string {
  const details: string[] = [];
  if (tags.length > 0) details.push(`tags: ${tags.join(', ')}`);
  if (updated) details.push(`updated ${updated}`);

  return `- ${name}: ${title}${details.length > 0 ? ` (${details.join('; ')})` : ''}`;
}

export function registerListFeaturesTool(
  server: McpServer,
  { context, logger }: ToolDependencies,
): void {
  server.registerTool(
    LIST_FEATURES_TOOL,
    {
      title: 'List documented features',
      description:
        'Lists the features documented for this project, with their name, title, tags and last ' +
        'update. Call it to discover what is documented, then read a feature with ' +
        'get_feature_doc. Feature files that could not be loaded are reported with the reason.',
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () => runTool(LIST_FEATURES_TOOL, logger, () => listFeatures(context)),
  );
}
