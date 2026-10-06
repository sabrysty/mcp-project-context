import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import matter from 'gray-matter';
import * as z from 'zod/v4';

import {
  ContextError,
  ContextNotFoundError,
  ContextTooLargeError,
  FileTooLargeError,
  InvalidFrontMatterError,
  UnsupportedFileTypeError,
} from './errors.js';
import { isSafePathSegment, resolveInsideRoot } from './safe-path.js';

export const DEFAULT_MAX_FILE_SIZE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_DOCUMENTS = 500;
export const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

// Files read at the same time by a listing: reading 200 files one by one was 4× slower.
const LOAD_CONCURRENCY = 16;

const RULES_FILE_NAME = 'rules.json';
// Some Windows editors start UTF-8 files with this invisible character.
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

export interface ContextDocument {
  /** Path relative to the context folder, with `/` separators (e.g. `features/authentication.md`). */
  path: string;
  /** File name without its extension (e.g. `authentication`). */
  name: string;
  /** Front-matter title, else the first level-1 heading, else the file name. */
  title: string;
  tags: string[];
  owner?: string;
  /** Last update, formatted `YYYY-MM-DD`. */
  updated?: string;
  /** Markdown body, without the front-matter. */
  content: string;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface DocumentListing {
  documents: ContextDocument[];
  /** Markdown files or folders that could not be loaded, with the reason. */
  skipped: SkippedFile[];
}

export interface ContextLoaderOptions {
  rootDir: string;
  maxFileSizeBytes?: number;
  maxDocuments?: number;
  /** Total size of the documents a single listing may load (it bounds search time and memory). */
  maxTotalBytes?: number;
}

const frontMatterSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  owner: z.string().trim().min(1).max(100).optional(),
  // YAML turns an unquoted `2026-10-01` into a Date, while a quoted one stays a string.
  updated: z
    .union([z.date(), z.iso.date()])
    .transform((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value))
    .optional(),
});

const FRONT_MATTER_OPTIONS = {
  engines: {
    // gray-matter runs "---js" front-matter through eval(): a context file must never execute code.
    javascript: (): never => {
      throw new Error('JavaScript front-matter is not allowed');
    },
  },
};

/** Reads the context folder. It never writes, and never reads outside of the folder. */
export class ContextLoader {
  private readonly rootDir: string;
  private readonly maxFileSizeBytes: number;
  private readonly maxDocuments: number;
  private readonly maxTotalBytes: number;

  constructor(options: ContextLoaderOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    this.maxDocuments = options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  }

  /** Reads a Markdown file or a `rules.json` file of the context folder as text. */
  async readText(relativePath: string): Promise<string> {
    if (!isMarkdownFile(relativePath) && path.posix.basename(relativePath) !== RULES_FILE_NAME) {
      throw new UnsupportedFileTypeError(
        `Only Markdown files and ${RULES_FILE_NAME} can be read: ${relativePath}`,
      );
    }
    const absolutePath = await resolveInsideRoot(this.rootDir, relativePath);

    // Checked before reading, so that an oversized file is never loaded in memory.
    const stats = await stat(absolutePath);
    if (!stats.isFile()) {
      throw new ContextNotFoundError(`Not a file: ${relativePath}`);
    }
    if (stats.size > this.maxFileSizeBytes) {
      throw new FileTooLargeError(
        `File too large (${String(stats.size)} bytes, max ${String(this.maxFileSizeBytes)}): ${relativePath}`,
      );
    }

    const text = await readFile(absolutePath, 'utf8');
    const withoutBom = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
    return withoutBom.replace(/\r\n?/g, '\n');
  }

  async loadDocument(relativePath: string): Promise<ContextDocument> {
    if (!isMarkdownFile(relativePath)) {
      throw new UnsupportedFileTypeError(`Not a Markdown document: ${relativePath}`);
    }
    return parseDocument(relativePath, await this.readText(relativePath));
  }

  /**
   * Loads every Markdown document under `directory`, recursively (the whole context by default).
   * A missing folder gives an empty listing, and a document that cannot be loaded is reported
   * in `skipped` rather than failing the whole listing.
   */
  async listDocuments(directory = ''): Promise<DocumentListing> {
    const listing: DocumentListing = { documents: [], skipped: [] };

    let absoluteDirectory: string;
    try {
      absoluteDirectory = await resolveInsideRoot(this.rootDir, directory);
    } catch (error) {
      if (error instanceof ContextNotFoundError) return listing;
      throw error;
    }
    if (!(await stat(absoluteDirectory)).isDirectory()) {
      throw new ContextNotFoundError(`Not a folder: ${directory}`);
    }

    const paths = await this.findMarkdownFiles(directory, absoluteDirectory, listing.skipped);
    // Counted before reading anything: a folder chosen by mistake fails fast.
    if (paths.length > this.maxDocuments) {
      throw new ContextTooLargeError(
        `The context folder holds more than ${String(this.maxDocuments)} Markdown files`,
      );
    }
    await this.loadAll(paths, listing);

    listing.documents.sort(byPath);
    listing.skipped.sort(byPath);
    return listing;
  }

  /** Walks `directory` recursively and returns the paths of its Markdown files. */
  private async findMarkdownFiles(
    directory: string,
    absoluteDirectory: string,
    skipped: SkippedFile[],
  ): Promise<string[]> {
    // withFileTypes describes the entries themselves: a symbolic link to a folder is not a
    // directory here, so the walk never follows links (no escape, no infinite loop).
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      // Hidden entries (.git, .env, .DS_Store…) are never part of the context.
      if (entry.name.startsWith('.')) continue;

      const relativePath = directory === '' ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (isSafePathSegment(entry.name)) {
          const absolutePath = path.join(absoluteDirectory, entry.name);
          files.push(...(await this.findMarkdownFiles(relativePath, absolutePath, skipped)));
        } else {
          skipped.push({ path: relativePath, reason: 'Unsupported characters in folder name' });
        }
      } else if (isMarkdownFile(entry.name)) {
        files.push(relativePath);
      }
    }
    return files;
  }

  /** Loads documents by batches read in parallel, within the total size budget. */
  private async loadAll(paths: readonly string[], listing: DocumentListing): Promise<void> {
    let totalBytes = 0;

    for (let start = 0; start < paths.length; start += LOAD_CONCURRENCY) {
      const batch = paths.slice(start, start + LOAD_CONCURRENCY);
      const outcomes = await Promise.all(batch.map((file) => this.tryLoadDocument(file)));

      for (const outcome of outcomes) {
        if ('reason' in outcome) {
          listing.skipped.push(outcome);
        } else {
          listing.documents.push(outcome);
          totalBytes += Buffer.byteLength(outcome.content);
        }
      }
      if (totalBytes > this.maxTotalBytes) {
        throw new ContextTooLargeError(
          `The context folder holds more than ${formatSize(this.maxTotalBytes)} of Markdown: ` +
            'point the server to a smaller folder',
        );
      }
    }
  }

  private async tryLoadDocument(relativePath: string): Promise<ContextDocument | SkippedFile> {
    try {
      return await this.loadDocument(relativePath);
    } catch (error) {
      if (!(error instanceof ContextError)) throw error;
      return { path: relativePath, reason: error.message };
    }
  }
}

/** Builds a document from the text of a Markdown file: validated front-matter and body. */
export function parseDocument(relativePath: string, text: string): ContextDocument {
  const { data, body } = parseFrontMatter(relativePath, text);
  const name = path.posix.basename(relativePath, path.posix.extname(relativePath));

  return {
    path: relativePath,
    name,
    title: data.title ?? findFirstHeading(body) ?? name,
    tags: data.tags ?? [],
    owner: data.owner,
    updated: data.updated,
    content: body,
  };
}

function parseFrontMatter(relativePath: string, text: string) {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(text, FRONT_MATTER_OPTIONS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InvalidFrontMatterError(`Invalid front-matter in ${relativePath}: ${reason}`);
  }

  const result = frontMatterSchema.safeParse(parsed.data);
  if (!result.success) {
    throw new InvalidFrontMatterError(
      `Invalid front-matter in ${relativePath}: ${z.prettifyError(result.error)}`,
    );
  }
  return { data: result.data, body: parsed.content.replace(/^\n+/, '') };
}

function findFirstHeading(markdown: string): string | undefined {
  return /^#[ \t]+(.+?)[ \t]*$/m.exec(markdown)?.[1];
}

function isMarkdownFile(fileName: string): boolean {
  return path.posix.extname(fileName).toLowerCase() === '.md';
}

function byPath(a: { path: string }, b: { path: string }): number {
  return a.path.localeCompare(b.path);
}

function formatSize(bytes: number): string {
  const megabyte = 1024 * 1024;
  if (bytes >= megabyte) return `${String(Math.round(bytes / megabyte))} MB`;
  if (bytes >= 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(bytes)} bytes`;
}
