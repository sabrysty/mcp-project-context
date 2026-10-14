import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
  type ListResourcesResult,
  type McpServer,
  type ReadResourceResult,
} from '@modelcontextprotocol/server';

import { ContextNotFoundError } from '../context/errors.js';
import {
  locateDocument,
  SECURITY_GUIDELINES_FILE,
  stripMarkdownExtension,
  type ProjectContext,
} from '../context/project-context.js';
import { runRequest, type HandlerDependencies } from '../handler-helpers.js';
import type { Logger } from '../logger.js';
import { formatDocument } from '../tools/format.js';

export const CONTEXT_DOCUMENT_RESOURCE = 'context-document';
// "+" lets the variable hold "/", so that nested documents (features/billing/invoices) match.
const DOCUMENT_URI_TEMPLATE = 'context://{+path}';
const MARKDOWN = 'text/markdown';

/**
 * URI of a context document: its path without `.md`, each segment percent-encoded
 * (e.g. `features/authentication.md` → `context://features/authentication`).
 */
export function documentUri(documentPath: string): string {
  const segments = stripMarkdownExtension(documentPath).split('/');
  return `context://${segments.map(encodeURIComponent).join('/')}`;
}

async function listDocumentResources(
  context: ProjectContext,
  logger: Logger,
): Promise<ListResourcesResult> {
  const { documents, skipped } = await context.listDocuments();
  // A resource list has no room to report them: the server log does.
  if (skipped.length > 0) {
    logger.warn('Documents left out of the resource list', { skipped });
  }
  return {
    resources: documents.map((document) => ({
      uri: documentUri(document.path),
      name: stripMarkdownExtension(document.path),
      title: document.title,
      description: describeDocument(document.path),
      mimeType: MARKDOWN,
    })),
  };
}

function describeDocument(path: string): string {
  if (path === SECURITY_GUIDELINES_FILE) {
    return 'Security guidelines, including the rules that check_code verifies';
  }
  const location = locateDocument(path);
  switch (location.kind) {
    case 'project':
      return 'Project overview: business domain, architecture, tech stack';
    case 'feature':
      return `Documentation of the feature ${JSON.stringify(location.name)}`;
    case 'convention':
      return `Coding conventions: ${location.topic}`;
    case 'other':
      return `Context document ${path}`;
  }
}

async function readDocumentResource(
  context: ProjectContext,
  uri: URL,
  variables: Record<string, string | string[]>,
): Promise<ReadResourceResult> {
  const path = decodePath(uri, variables.path);
  try {
    const document = await context.getDocument(path);
    return { contents: [{ uri: uri.href, mimeType: MARKDOWN, text: formatDocument(document) }] };
  } catch (error) {
    if (error instanceof ContextNotFoundError) {
      throw new ResourceNotFoundError(
        uri.href,
        `No document at ${uri.href}: list the resources to see the available documents.`,
      );
    }
    throw error;
  }
}

/**
 * The SDK leaves the variable percent-encoded. It is decoded here, and only then validated by
 * the loader's safe path check, so that "%2e%2e" cannot slip through as "..".
 */
function decodePath(uri: URL, path: string | string[] | undefined): string {
  if (typeof path === 'string') {
    try {
      return decodeURIComponent(path);
    } catch {
      // Malformed percent-encoding, such as a lone "%".
    }
  }
  throw new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    `Invalid document URI ${uri.href}: expected context://<path of the document without .md>`,
  );
}

async function completeDocumentPaths(context: ProjectContext, prefix: string): Promise<string[]> {
  const { documents } = await context.listDocuments();
  const lowerPrefix = prefix.toLowerCase();
  return documents
    .map((document) => stripMarkdownExtension(document.path))
    .filter((path) => path.toLowerCase().startsWith(lowerPrefix));
}

/**
 * Exposes every Markdown document of the context folder as a resource, under one URI
 * template: one entry point to secure, and the URIs of PROJECT_CONTEXT.md §5.4 follow from
 * it (context://project, context://features/{name}, context://security/guidelines…).
 */
export function registerContextDocumentResources(
  server: McpServer,
  { context, logger }: HandlerDependencies,
): void {
  server.registerResource(
    CONTEXT_DOCUMENT_RESOURCE,
    new ResourceTemplate(DOCUMENT_URI_TEMPLATE, {
      list: () =>
        runRequest('Listing the context documents', logger, () =>
          listDocumentResources(context, logger),
        ),
      complete: {
        path: (prefix) =>
          runRequest('Completing a document path', logger, () =>
            completeDocumentPaths(context, prefix),
          ),
      },
    }),
    {
      title: 'Context document',
      description:
        'A Markdown document of the project context, by its path without .md: ' +
        'context://project (overview), context://features/<name>, ' +
        'context://conventions/<topic>, context://security/guidelines…',
      mimeType: MARKDOWN,
    },
    (uri, variables) =>
      runRequest(`Reading ${uri.href}`, logger, () =>
        readDocumentResource(context, uri, variables),
      ),
  );
}
