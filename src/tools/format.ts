import type { ContextDocument, SkippedFile } from '../context/loader.js';

/**
 * Above this length, a document read whole takes a large part of the agent's context: about
 * 10,000 tokens, from which Claude Code warns about a tool result, and under the 50,000
 * characters from which it saves a result to a file instead of showing it.
 */
export const LARGE_DOCUMENT_CHARACTERS = 40_000;
const CHARACTERS_PER_TOKEN = 4;

/** Whether a document of `characters` characters, front-matter left out, is large. */
export function isLargeDocument(characters: number): boolean {
  return characters > LARGE_DOCUMENT_CHARACTERS;
}

/** Renders a document for an agent: its metadata as a front-matter block, then its body. */
export function formatDocument(document: ContextDocument): string {
  const metadata = [`title: ${document.title}`, `source: ${document.path}`];
  if (document.owner) metadata.push(`owner: ${document.owner}`);
  if (document.updated) metadata.push(`updated: ${document.updated}`);
  if (document.tags.length > 0) metadata.push(`tags: [${document.tags.join(', ')}]`);

  return ['---', ...metadata, '---', '', document.content].join('\n');
}

/**
 * Lists the files the loader could not read. Shown in every listing, so that a document
 * with a broken front-matter is reported instead of silently disappearing.
 */
export function formatSkipped(skipped: readonly SkippedFile[]): string | undefined {
  if (skipped.length === 0) return undefined;

  const lines = skipped.map((file) => `- ${file.path}: ${file.reason.replace(/\s*\n\s*/g, ' ')}`);
  return [
    `Skipped ${countOf(skipped.length, 'file')} that could not be loaded (fix them to make them available):`,
    ...lines,
  ].join('\n');
}

/**
 * Advises on the large documents of a listing: the agent can search them instead of reading
 * them whole, and the team can split them, as `splitHint` suggests.
 */
export function formatLargeDocuments(
  names: readonly string[],
  splitHint: string,
): string | undefined {
  if (names.length === 0) return undefined;

  const tokens = LARGE_DOCUMENT_CHARACTERS / CHARACTERS_PER_TOKEN;
  return (
    `${countOf(names.length, 'large document')}, over ${String(LARGE_DOCUMENT_CHARACTERS)} ` +
    `characters (about ${String(tokens)} tokens): ${names.join(', ')}. Read whole, such a ` +
    'document takes a large part of your context: find the relevant section with search_docs ' +
    `first. Suggest to the team to split it into smaller documents, ${splitHint}.`
  );
}

/** Explains that a name does not exist and lists the valid ones, so the agent can retry. */
export function formatNotFound(kind: string, name: string, available: readonly string[]): string {
  const subject = `${kind} ${JSON.stringify(name)} not found`;
  return available.length > 0
    ? `${subject}. Available: ${available.join(', ')}.`
    : `${subject}: none is documented in this project.`;
}

export function countOf(count: number, noun: string): string {
  return `${String(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** Joins the non-empty sections of a tool answer with a blank line. */
export function joinSections(...sections: (string | undefined)[]): string {
  return sections.filter((section) => section !== undefined && section !== '').join('\n\n');
}
