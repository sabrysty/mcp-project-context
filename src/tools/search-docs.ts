import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { locateDocument, type ProjectContext } from '../context/project-context.js';
import type { SearchResult } from '../context/search.js';
import { documentUri } from '../resources/context-documents.js';
import { countOf, formatSkipped, joinSections } from './format.js';
import { GET_CONVENTIONS_TOOL } from './get-conventions.js';
import { GET_FEATURE_DOC_TOOL } from './get-feature-doc.js';
import { GET_PROJECT_CONTEXT_TOOL } from './get-project-context.js';
import { READ_ONLY_ANNOTATIONS, runTool, type HandlerDependencies } from './tool-helpers.js';

export const SEARCH_DOCS_TOOL = 'search_docs';
export const DEFAULT_SEARCH_LIMIT = 5;
export const MAX_SEARCH_LIMIT = 20;
const MAX_QUERY_LENGTH = 200;

// Seen in a test from Claude Code: given an excerpt without the line of default values, the
// agent stated that the documentation did not give them, instead of reading the document.
const PARTIAL_EXCERPTS_NOTE =
  'Excerpts with "…" leave text out: read the whole document before stating that the ' +
  'documentation does not cover a point.';

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .describe('Words to look for, e.g. "refresh token rotation". Case and accents are ignored.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .default(DEFAULT_SEARCH_LIMIT)
    .describe(
      `Maximum number of results, from 1 to ${String(MAX_SEARCH_LIMIT)} (default ${String(DEFAULT_SEARCH_LIMIT)})`,
    ),
});

const outputSchema = z.object({
  query: z.string(),
  terms: z
    .array(z.string())
    .describe('Word stems actually searched, once accents and common words are removed'),
  results: z.array(
    z.object({
      source: z.string().describe('Path of the document, relative to the context folder'),
      section: z.string().describe('Document title and headings leading to the excerpt'),
      excerpt: z
        .string()
        .describe(
          'The whole section when its heading holds a searched word, else its paragraphs, ' +
            'list items, table rows and code blocks holding one; "…" marks left-out text',
        ),
      score: z.number(),
      readWith: z
        .string()
        .describe(
          'How to read the whole document: a tool call, or the MCP resource to read for ' +
            'documents that no tool returns',
        ),
    }),
  ),
  note: z
    .string()
    .optional()
    .describe('Present when an excerpt leaves text out: what to do before concluding'),
  skipped: z
    .array(z.object({ path: z.string(), reason: z.string() }))
    .describe('Files that could not be loaded, so they were not searched'),
});

type SearchOutput = z.infer<typeof outputSchema>;
type SearchHit = SearchOutput['results'][number];

export async function searchDocs(
  context: ProjectContext,
  query: string,
  limit: number,
): Promise<CallToolResult> {
  const { terms, results, skipped } = await context.search(query, limit);
  const hits = results.map((result) => ({
    source: result.path,
    section: describeSection(result),
    excerpt: result.excerpt,
    score: result.score,
    readWith: readWith(result.path),
  }));
  // In the structured content too: some clients, such as Claude Code, show it to the agent
  // instead of the text.
  const output: SearchOutput = {
    query,
    terms,
    results: hits,
    ...(hits.some(isPartial) ? { note: PARTIAL_EXCERPTS_NOTE } : {}),
    skipped,
  };

  return {
    content: [{ type: 'text', text: formatSearch(output) }],
    structuredContent: output,
  };
}

function describeSection({ title, headings }: SearchResult): string {
  // The first heading of a document usually repeats its title.
  const trail = headings[0] === title ? headings.slice(1) : headings;
  return [title, ...trail].join(' › ');
}

/**
 * How an agent can read the whole document a result comes from: a tool call when a tool
 * returns it, since every client supports tools, else its resource.
 */
export function readWith(path: string): string {
  const location = locateDocument(path);
  switch (location.kind) {
    case 'project':
      return GET_PROJECT_CONTEXT_TOOL;
    case 'feature':
      return `${GET_FEATURE_DOC_TOOL} {"name": ${JSON.stringify(location.name)}}`;
    case 'convention':
      return `${GET_CONVENTIONS_TOOL} {"topic": ${JSON.stringify(location.topic)}}`;
    case 'other':
      return `resource ${documentUri(path)}`;
  }
}

function isPartial({ excerpt }: SearchHit): boolean {
  return excerpt.split('\n').includes('…');
}

function formatSearch({ query, terms, results, note, skipped }: SearchOutput): string {
  const searched = `searched stems: ${terms.join(', ')}`;
  const body =
    results.length === 0
      ? `No result for ${JSON.stringify(query)} (${searched}). Try other words, or browse ` +
        'the documentation with list_features and get_conventions.'
      : [
          `${countOf(results.length, 'result')} for ${JSON.stringify(query)} (${searched}), best first:`,
          ...results.map(formatHit),
        ].join('\n\n');

  return joinSections(body, note, formatSkipped(skipped));
}

function formatHit(hit: SearchHit, index: number): string {
  const header = `## ${String(index + 1)}. ${hit.source} — ${hit.section}`;
  return [header, `Whole document: ${hit.readWith}`, '', hit.excerpt].join('\n');
}

export function registerSearchDocsTool(
  server: McpServer,
  { context, logger }: HandlerDependencies,
): void {
  server.registerTool(
    SEARCH_DOCS_TOOL,
    {
      title: 'Search the documentation',
      description:
        'Full-text search across the whole project documentation: overview, features, coding ' +
        'conventions and security guidelines. Returns the most relevant sections, best first, ' +
        'each with its source file, how to read the whole document (a tool call, or an MCP ' +
        'resource) and an ' +
        'excerpt: the whole section when its heading names the topic, else only the passages ' +
        'that mention it ("…" marks left-out text). An excerpt can leave out nearby details: ' +
        'read the whole document before stating that something is not documented. Use it to ' +
        'find where a topic is documented (e.g. "refresh token", "pagination", ' +
        '"ValidationPipe"). Case and accents are ignored.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    ({ query, limit }) =>
      runTool(SEARCH_DOCS_TOOL, logger, () => searchDocs(context, query, limit)),
  );
}
