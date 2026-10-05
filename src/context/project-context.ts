import type { ContextDocument, ContextLoader, SkippedFile } from './loader.js';

export const PROJECT_FILE = 'project.md';
export const FEATURES_FOLDER = 'features';
export const CONVENTIONS_FOLDER = 'conventions';

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

  private async listCollection(folder: string): Promise<Collection> {
    const { documents, skipped } = await this.loader.listDocuments(folder);
    return {
      entries: documents.map((document) => ({
        name: stripMarkdownExtension(document.path.slice(folder.length + 1)),
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

function stripMarkdownExtension(name: string): string {
  return name.replace(/\.md$/i, '');
}
