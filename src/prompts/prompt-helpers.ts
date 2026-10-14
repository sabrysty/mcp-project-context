import type { GetPromptResult } from '@modelcontextprotocol/server';

import { ContextNotFoundError } from '../context/errors.js';
import type { ContextDocument } from '../context/loader.js';

/** A prompt made of one message from the user, the form every client supports. */
export function userPrompt(description: string, text: string): GetPromptResult {
  return { description, messages: [{ role: 'user', content: { type: 'text', text } }] };
}

/**
 * A document between XML-like tags, with its source: models tell documents apart from
 * instructions more reliably this way than with Markdown headings, which the documents
 * use themselves.
 */
export function documentBlock({ path, title, content }: ContextDocument): string {
  return [
    `<document source=${JSON.stringify(path)} title=${JSON.stringify(title)}>`,
    content.trim(),
    '</document>',
  ].join('\n');
}

/** Loads a document that a project may not have, such as project.md. */
export async function loadIfPresent(
  loading: Promise<ContextDocument>,
): Promise<ContextDocument | undefined> {
  try {
    return await loading;
  } catch (error) {
    if (error instanceof ContextNotFoundError) return undefined;
    throw error;
  }
}
