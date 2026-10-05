import { describe, expect, it } from 'vitest';

import type { ContextDocument } from '../../src/context/loader.js';
import {
  countOf,
  formatDocument,
  formatNotFound,
  formatSkipped,
  joinSections,
} from '../../src/tools/format.js';

const DOCUMENT: ContextDocument = {
  path: 'features/authentication.md',
  name: 'authentication',
  title: 'Authentification',
  tags: ['auth', 'jwt'],
  owner: 'équipe back',
  updated: '2026-10-01',
  content: '# Authentification\n\nBody.',
};

describe('formatDocument', () => {
  it('puts the metadata in a front-matter block before the body', () => {
    expect(formatDocument(DOCUMENT)).toBe(
      [
        '---',
        'title: Authentification',
        'source: features/authentication.md',
        'owner: équipe back',
        'updated: 2026-10-01',
        'tags: [auth, jwt]',
        '---',
        '',
        '# Authentification',
        '',
        'Body.',
      ].join('\n'),
    );
  });

  it('leaves out the metadata a document does not have', () => {
    const minimal: ContextDocument = {
      ...DOCUMENT,
      tags: [],
      owner: undefined,
      updated: undefined,
    };

    expect(formatDocument(minimal)).toMatch(
      /^---\ntitle: Authentification\nsource: features\/authentication\.md\n---\n/,
    );
  });
});

describe('formatSkipped', () => {
  it('returns nothing when no file was skipped', () => {
    expect(formatSkipped([])).toBeUndefined();
  });

  it('lists skipped files on one line each', () => {
    expect(
      formatSkipped([
        { path: 'features/broken.md', reason: 'Invalid front-matter:\n  ✖ bad\n  → at tags' },
      ]),
    ).toBe(
      'Skipped 1 file that could not be loaded (fix them to make them available):\n' +
        '- features/broken.md: Invalid front-matter: ✖ bad → at tags',
    );
  });
});

describe('formatNotFound', () => {
  it('lists the available names', () => {
    expect(formatNotFound('Feature', 'billing', ['authentication'])).toBe(
      'Feature "billing" not found. Available: authentication.',
    );
  });

  it('says when nothing is available', () => {
    expect(formatNotFound('Feature', 'billing', [])).toBe(
      'Feature "billing" not found: none is documented in this project.',
    );
  });
});

describe('countOf and joinSections', () => {
  it('pluralizes only when needed', () => {
    expect(countOf(1, 'file')).toBe('1 file');
    expect(countOf(2, 'file')).toBe('2 files');
  });

  it('joins non-empty sections with a blank line', () => {
    expect(joinSections('a', undefined, '', 'b')).toBe('a\n\nb');
  });
});
