import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ContextNotFoundError,
  ContextTooLargeError,
  FileTooLargeError,
  InvalidFrontMatterError,
  PathTraversalError,
  UnsupportedFileTypeError,
} from '../../src/context/errors.js';
import { ContextLoader, parseDocument } from '../../src/context/loader.js';
import { createDirectoryLink, createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';

const AUTHENTICATION_DOC = [
  '---',
  'title: Authentification',
  'tags: [auth, jwt]',
  'owner: équipe back',
  'updated: 2026-10-01',
  '---',
  '',
  '# Authentification',
  '',
  'Body.',
].join('\n');

const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

describe('parseDocument', () => {
  it('reads the front-matter and keeps only the body as content', () => {
    expect(parseDocument('features/authentication.md', AUTHENTICATION_DOC)).toEqual({
      path: 'features/authentication.md',
      name: 'authentication',
      title: 'Authentification',
      tags: ['auth', 'jwt'],
      owner: 'équipe back',
      updated: '2026-10-01',
      content: '# Authentification\n\nBody.',
    });
  });

  it('keeps a quoted date as is', () => {
    const doc = parseDocument('a.md', '---\nupdated: "2026-09-30"\n---\nBody');
    expect(doc.updated).toBe('2026-09-30');
  });

  it('falls back to the first heading, then to the file name, for the title', () => {
    expect(parseDocument('a.md', 'Intro\n\n# Main title  \n\nText').title).toBe('Main title');
    expect(parseDocument('features/task-management.md', 'No heading').title).toBe(
      'task-management',
    );
  });

  it('accepts a document without front-matter', () => {
    expect(parseDocument('a.md', '# A')).toMatchObject({
      tags: [],
      owner: undefined,
      updated: undefined,
    });
  });

  it('ignores unknown front-matter keys', () => {
    expect(parseDocument('a.md', '---\nstatus: draft\n---\n# A').title).toBe('A');
  });

  it('rejects malformed YAML', () => {
    expect(() => parseDocument('a.md', '---\ntitle: [unclosed\n---\n')).toThrow(
      InvalidFrontMatterError,
    );
  });

  it('rejects a field of the wrong type, naming the field', () => {
    expect(() => parseDocument('a.md', '---\ntitle: 42\n---\n')).toThrow(/title/);
  });

  it('rejects an invalid date', () => {
    expect(() => parseDocument('a.md', '---\nupdated: yesterday\n---\n')).toThrow(
      InvalidFrontMatterError,
    );
  });

  it.each(['js', 'javascript'])('rejects "---%s" front-matter without executing it', (language) => {
    const text = `---${language}\n{ title: (globalThis.__frontMatterExecuted = true, 'pwned') }\n---\nBody`;

    // The message proves the refusal comes from the disabled engine, not from a YAML error.
    expect(() => parseDocument('evil.md', text)).toThrow(/JavaScript front-matter is not allowed/);
    expect(Reflect.get(globalThis, '__frontMatterExecuted')).toBeUndefined();
  });
});

describe('ContextLoader', () => {
  let root: string;
  let outside: string;
  let loader: ContextLoader;

  beforeAll(async () => {
    root = await createFixtureDir({
      'project.md': '---\ntitle: Projet\n---\n\n# Projet\n',
      'features/authentication.md': AUTHENTICATION_DOC,
      'features/task-management.md': '# Gestion des tâches\n',
      'features/broken.md': '---\ntitle: [unclosed\n---\n',
      'features/diagram.png': 'not markdown',
      'features/.draft.md': '# Hidden draft',
      'conventions/nestjs.md': '# NestJS\n',
      'security/rules.json': '[]',
      'security/guidelines.md': '# Sécurité\n',
      'notes.txt': 'not a context file',
      'windows.md': `${BYTE_ORDER_MARK}---\r\ntitle: Windows\r\n---\r\n\r\nLine 1\r\nLine 2\r\n`,
      'big.md': 'x'.repeat(3000),
      'weird%folder/inside.md': '# Inside',
    });
    await mkdir(path.join(root, 'folder.md'));
    outside = await createFixtureDir({ 'secret.md': '# Secret' });
    await mkdir(path.join(root, 'links'));
    await createDirectoryLink(outside, path.join(root, 'links', 'escape'));

    loader = new ContextLoader({ rootDir: root, maxFileSizeBytes: 2048 });
  });

  afterAll(async () => {
    await removeFixtureDir(root);
    await removeFixtureDir(outside);
  });

  describe('loadDocument', () => {
    it('loads a document with its front-matter', async () => {
      await expect(loader.loadDocument('features/authentication.md')).resolves.toMatchObject({
        name: 'authentication',
        title: 'Authentification',
        tags: ['auth', 'jwt'],
        updated: '2026-10-01',
      });
    });

    it('strips the BOM and normalizes Windows line endings', async () => {
      await expect(loader.loadDocument('windows.md')).resolves.toMatchObject({
        title: 'Windows',
        content: 'Line 1\nLine 2\n',
      });
    });

    it('reports a missing file', async () => {
      await expect(loader.loadDocument('features/missing.md')).rejects.toThrow(
        ContextNotFoundError,
      );
    });

    it('refuses a file larger than the limit', async () => {
      await expect(loader.loadDocument('big.md')).rejects.toThrow(FileTooLargeError);
      await expect(loader.loadDocument('big.md')).rejects.toThrow(/3000 bytes, max 2048/);
    });

    it('refuses files that are not Markdown', async () => {
      await expect(loader.loadDocument('notes.txt')).rejects.toThrow(UnsupportedFileTypeError);
      await expect(loader.loadDocument('security/rules.json')).rejects.toThrow(
        UnsupportedFileTypeError,
      );
    });

    it('refuses a folder whose name looks like a document', async () => {
      await expect(loader.loadDocument('folder.md')).rejects.toThrow(/Not a file/);
    });

    it('refuses to leave the context folder', async () => {
      await expect(loader.loadDocument('../secret.md')).rejects.toThrow(PathTraversalError);
      await expect(loader.loadDocument('links/escape/secret.md')).rejects.toThrow(
        PathTraversalError,
      );
    });
  });

  describe('readText', () => {
    it('reads rules.json', async () => {
      await expect(loader.readText('security/rules.json')).resolves.toBe('[]');
    });

    it('refuses any other file type', async () => {
      await expect(loader.readText('notes.txt')).rejects.toThrow(UnsupportedFileTypeError);
    });
  });

  describe('listDocuments', () => {
    it('lists the documents of a folder and reports the ones it skipped', async () => {
      const listing = await loader.listDocuments('features');

      expect(listing.documents.map((doc) => doc.path)).toEqual([
        'features/authentication.md',
        'features/task-management.md',
      ]);
      expect(listing.skipped.map((file) => file.path)).toEqual(['features/broken.md']);
      expect(listing.skipped[0]?.reason).toMatch(/Invalid front-matter/);
    });

    it('walks the whole context by default', async () => {
      const listing = await loader.listDocuments();

      expect(listing.documents.map((doc) => doc.path)).toEqual([
        'conventions/nestjs.md',
        'features/authentication.md',
        'features/task-management.md',
        'project.md',
        'security/guidelines.md',
        'windows.md',
      ]);
      expect(listing.skipped.map((file) => file.path)).toEqual([
        'big.md',
        'features/broken.md',
        'weird%folder',
      ]);
    });

    it('does not follow folder links', async () => {
      await expect(loader.listDocuments('links')).resolves.toEqual({ documents: [], skipped: [] });
    });

    it('returns an empty listing for a missing folder', async () => {
      await expect(loader.listDocuments('missing')).resolves.toEqual({
        documents: [],
        skipped: [],
      });
    });

    it('refuses a file given as folder', async () => {
      await expect(loader.listDocuments('project.md')).rejects.toThrow(/Not a folder/);
    });

    it('refuses to leave the context folder', async () => {
      await expect(loader.listDocuments('..')).rejects.toThrow(PathTraversalError);
    });

    it('stops when the folder holds too many documents', async () => {
      const smallLoader = new ContextLoader({ rootDir: root, maxDocuments: 2 });

      await expect(smallLoader.listDocuments()).rejects.toThrow(ContextTooLargeError);
    });

    it('stops when the documents exceed the total size budget', async () => {
      const smallBudget = new ContextLoader({
        rootDir: root,
        maxFileSizeBytes: 2048,
        maxTotalBytes: 50,
      });

      await expect(smallBudget.listDocuments()).rejects.toThrow(
        'The context folder holds more than 50 bytes of Markdown',
      );
    });
  });
});

describe('demo context (examples/taskflow-context)', () => {
  const loader = new ContextLoader({
    rootDir: fileURLToPath(new URL('../../examples/taskflow-context', import.meta.url)),
  });

  it('loads every document without skipping any', async () => {
    const listing = await loader.listDocuments();

    expect(listing.skipped).toEqual([]);
    expect(listing.documents.map((doc) => doc.path)).toEqual([
      'conventions/nestjs.md',
      'conventions/react.md',
      'conventions/typescript.md',
      'features/authentication.md',
      'features/task-management.md',
      'project.md',
      'security/guidelines.md',
    ]);
  });

  it('exposes the front-matter of a feature', async () => {
    await expect(loader.loadDocument('features/authentication.md')).resolves.toMatchObject({
      name: 'authentication',
      title: 'Authentification',
      tags: ['auth', 'jwt', 'nestjs'],
      owner: 'équipe back',
      updated: '2026-10-13',
    });
  });

  it('reads the security rules file', async () => {
    const rules: unknown = JSON.parse(await loader.readText('security/rules.json'));

    expect(rules).toHaveLength(5);
  });
});
