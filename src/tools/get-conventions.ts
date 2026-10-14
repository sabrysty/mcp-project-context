import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { ContextNotFoundError, PathTraversalError } from '../context/errors.js';
import type { ProjectContext } from '../context/project-context.js';
import { countOf, formatDocument, formatNotFound, formatSkipped, joinSections } from './format.js';
import {
  errorResult,
  MAX_NAME_LENGTH,
  READ_ONLY_ANNOTATIONS,
  runTool,
  textResult,
  type HandlerDependencies,
} from './tool-helpers.js';

export const GET_CONVENTIONS_TOOL = 'get_conventions';

const inputSchema = z.object({
  topic: z
    .string()
    .trim()
    .max(MAX_NAME_LENGTH)
    .optional()
    .describe(
      'Convention topic, e.g. "typescript", "nestjs" or "react". Omit it to list the available topics.',
    ),
});

export async function getConventions(
  context: ProjectContext,
  topic: string | undefined,
): Promise<CallToolResult> {
  // Agents sometimes send an empty string for an optional argument: same as no topic.
  if (topic === undefined || topic === '') {
    return listConventionTopics(context);
  }

  try {
    return textResult(formatDocument(await context.getConvention(topic)));
  } catch (error) {
    if (error instanceof PathTraversalError) {
      return errorResult(
        `Invalid convention topic ${JSON.stringify(topic)}: call get_conventions without a topic to list the valid ones.`,
      );
    }
    if (error instanceof ContextNotFoundError) {
      const { entries } = await context.listConventions();
      return errorResult(
        formatNotFound(
          'Convention topic',
          topic,
          entries.map((entry) => entry.name),
        ),
      );
    }
    throw error;
  }
}

async function listConventionTopics(context: ProjectContext): Promise<CallToolResult> {
  const { entries, skipped } = await context.listConventions();
  const list =
    entries.length === 0
      ? 'No coding convention is documented yet: the context folder has no Markdown file under conventions/.'
      : [
          `${countOf(entries.length, 'convention topic')}:`,
          ...entries.map(({ name, document }) => `- ${name}: ${document.title}`),
          '',
          'Call get_conventions with one of these topics to read it.',
        ].join('\n');

  return textResult(joinSections(list, formatSkipped(skipped)));
}

export function registerGetConventionsTool(
  server: McpServer,
  { context, logger }: HandlerDependencies,
): void {
  server.registerTool(
    GET_CONVENTIONS_TOOL,
    {
      title: 'Coding conventions',
      description:
        "Returns the team's coding conventions for one topic (e.g. typescript, nestjs, react): " +
        'structure, naming, rules, and examples of good and bad code. Without a topic, lists the ' +
        'available topics. Read the relevant conventions before writing code for this project, ' +
        'and follow them.',
      inputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    ({ topic }) => runTool(GET_CONVENTIONS_TOOL, logger, () => getConventions(context, topic)),
  );
}
