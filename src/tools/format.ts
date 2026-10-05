import type { ContextDocument, SkippedFile } from '../context/loader.js';

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
