import type { ContextDocument, ContextLoader, DocumentListing, SkippedFile } from './loader.js';
import { parseQuery, searchDocuments, type SearchResult } from './search.js';

export const PROJECT_FILE = 'project.md';
export const FEATURES_FOLDER = 'features';
export const CONVENTIONS_FOLDER = 'conventions';
export const SECURITY_GUIDELINES_FILE = 'security/guidelines.md';
export const RULES_FILE = 'security/rules.json';

/** A document of a collection (features, conventions) with the name used to fetch it. */
export interface NamedDocument {
  /** Path inside the collection folder, without `.md` (e.g. `authentication`, `billing/invoices`). */
  name: string;
  document: ContextDocument;
}

export interface Collection {
  entries: NamedDocument[];
  skipped: SkippedFile[];
}

export interface SearchOutcome {
  /** Words actually searched, once common words are removed. */
  terms: string[];
  results: SearchResult[];
  skipped: SkippedFile[];
}

/** Which part of the context a document belongs to. */
export type DocumentLocation =
  | { kind: 'project' }
  | { kind: 'feature'; name: string }
  | { kind: 'convention'; topic: string }
  | { kind: 'other' };

/** Knows where each part of the context lives (layout of PROJECT_CONTEXT.md §5.1). */
export class ProjectContext {
  constructor(private readonly loader: ContextLoader) {}

  getProject(): Promise<ContextDocument> {
    return this.loader.loadDocument(PROJECT_FILE);
  }

  listFeatures(): Promise<Collection> {
    return this.listCollection(FEATURES_FOLDER);
  }

  getFeature(name: string): Promise<ContextDocument> {
    return this.getEntry(FEATURES_FOLDER, name);
  }

  listConventions(): Promise<Collection> {
    return this.listCollection(CONVENTIONS_FOLDER);
  }

  getConvention(topic: string): Promise<ContextDocument> {
    return this.getEntry(CONVENTIONS_FOLDER, topic);
  }

  getSecurityGuidelines(): Promise<ContextDocument> {
    return this.loader.loadDocument(SECURITY_GUIDELINES_FILE);
  }

  /** Text of the security rules checked by check_code (PROJECT_CONTEXT.md §5.3). */
  readRules(): Promise<string> {
    return this.loader.readText(RULES_FILE);
  }

  /** Every Markdown document of the context, whatever its folder. */
  listDocuments(): Promise<DocumentListing> {
    return this.loader.listDocuments();
  }

  /** Any Markdown document, by its path relative to the context folder, `.md` optional. */
  getDocument(path: string): Promise<ContextDocument> {
    return this.loader.loadDocument(`${stripMarkdownExtension(path)}.md`);
  }

  /** Full-text search across every Markdown document of the context. */
  async search(query: string, limit: number): Promise<SearchOutcome> {
    // Parsed first: a query with nothing to search should not cost a read of the whole folder.
    const terms = parseQuery(query);
    const { documents, skipped } = await this.loader.listDocuments();
    return { terms, results: searchDocuments(documents, terms, limit), skipped };
  }

  private async listCollection(folder: string): Promise<Collection> {
    const { documents, skipped } = await this.loader.listDocuments(folder);
    return {
      entries: documents.map((document) => ({
        name: entryName(folder, document.path),
        document,
      })),
      skipped,
    };
  }

  private getEntry(folder: string, name: string): Promise<ContextDocument> {
    // Agents often pass the file name: "authentication.md" is understood as "authentication".
    return this.loader.loadDocument(`${folder}/${stripMarkdownExtension(name)}.md`);
  }
}

/** Tells which part of the context the document at `path` belongs to. */
export function locateDocument(path: string): DocumentLocation {
  if (path === PROJECT_FILE) return { kind: 'project' };
  if (path.startsWith(`${FEATURES_FOLDER}/`)) {
    return { kind: 'feature', name: entryName(FEATURES_FOLDER, path) };
  }
  if (path.startsWith(`${CONVENTIONS_FOLDER}/`)) {
    return { kind: 'convention', topic: entryName(CONVENTIONS_FOLDER, path) };
  }
  return { kind: 'other' };
}

function entryName(folder: string, path: string): string {
  return stripMarkdownExtension(path.slice(folder.length + 1));
}

export function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '');
}
