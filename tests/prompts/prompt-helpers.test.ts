import { describe, expect, it } from 'vitest';

import { ContextNotFoundError, InvalidFrontMatterError } from '../../src/context/errors.js';
import type { ContextDocument } from '../../src/context/loader.js';
import { documentBlock, loadIfPresent } from '../../src/prompts/prompt-helpers.js';

const DOCUMENT: ContextDocument = {
  path: 'features/auth.md',
  name: 'auth',
  title: 'Authentification "JWT"',
  tags: [],
  content: '\n# Authentification\n\nTokens.\n',
};

describe('documentBlock', () => {
  it('tags a document with its source and title, quotes escaped', () => {
    expect(documentBlock(DOCUMENT)).toBe(
      [
        '<document source="features/auth.md" title="Authentification \\"JWT\\"">',
        '# Authentification\n\nTokens.',
        '</document>',
      ].join('\n'),
    );
  });
});

describe('loadIfPresent', () => {
  it('returns the document, or undefined when it does not exist', async () => {
    await expect(loadIfPresent(Promise.resolve(DOCUMENT))).resolves.toBe(DOCUMENT);
    await expect(
      loadIfPresent(Promise.reject(new ContextNotFoundError('Not found: project.md'))),
    ).resolves.toBeUndefined();
  });

  it('does not hide a document that exists but is broken', async () => {
    const broken = new InvalidFrontMatterError('Invalid front-matter in project.md');

    await expect(loadIfPresent(Promise.reject(broken))).rejects.toBe(broken);
  });
});
