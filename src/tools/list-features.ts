import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ProjectContext } from '../context/project-context.js';
import {
  countOf,
  formatLargeDocuments,
  formatSkipped,
  isLargeDocument,
  joinSections,
  LARGE_DOCUMENT_CHARACTERS,
} from './format.js';
import { READ_ONLY_ANNOTATIONS, runTool, type HandlerDependencies } from './tool-helpers.js';

export const LIST_FEATURES_TOOL = 'list_features';

const outputSchema = z.object({
  features: z.array(
    z.object({
      name: z.string().describe('Name to pass to get_feature_doc'),
      title: z.string(),
      tags: z.array(z.string()),
      owner: z.string().optional(),
      updated: z.string().optional().describe('Last update, YYYY-MM-DD'),
      characters: z
        .number()
        .describe(
          `Length of the document; over ${String(LARGE_DOCUMENT_CHARACTERS)}, search it ` +
            'rather than reading it whole',
        ),
    }),
  ),
  note: z
    .string()
    .optional()
    .describe('Present when some documents are large: how to read them, and to split them'),
  skipped: z
    .array(z.object({ path: z.string(), reason: z.string() }))
    .describe('Feature files that could not be loaded, with the reason'),
});

type FeatureList = z.infer<typeof outputSchema>;
type FeatureSummary = FeatureList['features'][number];

export async function listFeatures(context: ProjectContext): Promise<CallToolResult> {
  const { entries, skipped } = await context.listFeatures();
  const features = entries.map(({ name, document }) => ({
    name,
    title: document.title,
    tags: document.tags,
    owner: document.owner,
    updated: document.updated,
    characters: document.content.length,
  }));
  const note = formatLargeDocuments(
    features.filter((feature) => isLargeDocument(feature.characters)).map(({ name }) => name),
    'for instance one per part under features/<feature name>/',
  );
  // In the structured content too: some clients, such as Claude Code, show it to the agent
  // instead of the text.
  const result: FeatureList = { features, ...(note === undefined ? {} : { note }), skipped };

  return {
    content: [{ type: 'text', text: formatFeatureList(result) }],
    structuredContent: result,
  };
}

function formatFeatureList({ features, note, skipped }: FeatureList): string {
  const list =
    features.length === 0
      ? 'No feature is documented yet: the context folder has no Markdown file under features/.'
      : [
          `${countOf(features.length, 'documented feature')}:`,
          ...features.map(formatFeatureLine),
          '',
          'Read one with get_feature_doc, passing its name.',
        ].join('\n');

  return joinSections(list, note, formatSkipped(skipped));
}

function formatFeatureLine({ name, title, tags, updated, characters }: FeatureSummary): string {
  const details: string[] = [];
  if (tags.length > 0) details.push(`tags: ${tags.join(', ')}`);
  if (updated) details.push(`updated ${updated}`);
  if (isLargeDocument(characters)) details.push(`large: ${String(characters)} characters`);

  return `- ${name}: ${title}${details.length > 0 ? ` (${details.join('; ')})` : ''}`;
}

export function registerListFeaturesTool(
  server: McpServer,
  { context, logger }: HandlerDependencies,
): void {
  server.registerTool(
    LIST_FEATURES_TOOL,
    {
      title: 'List documented features',
      description:
        'Lists the features documented for this project, with their name, title, tags, last ' +
        'update and length. Call it to discover what is documented, then read a feature with ' +
        'get_feature_doc; search a large one with search_docs first. Feature files that could ' +
        'not be loaded are reported with the reason.',
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () => runTool(LIST_FEATURES_TOOL, logger, () => listFeatures(context)),
  );
}
