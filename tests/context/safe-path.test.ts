import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ContextFolderMissingError,
  ContextNotFoundError,
  PathTraversalError,
} from '../../src/context/errors.js';
import {
  assertSafeRelativePath,
  isInsideDirectory,
  isSafePathSegment,
  MAX_RELATIVE_PATH_LENGTH,
  resolveInsideRoot,
} from '../../src/context/safe-path.js';
import {
  createDirectoryLink,
  createFixtureDir,
  removeFixtureDir,
  tryCreateFileLink,
} from '../helpers/fixture-dir.js';

describe('assertSafeRelativePath', () => {
  it.each([
    'project.md',
    'features/authentication.md',
    'security/rules.json',
    'notes v2.md',
    'gestion-des-tâches.md',
    'gestion-des-ta\u0302ches.md', // same name, decomposed (NFD) as macOS stores it
    '',
  ])('accepts %j', (relativePath) => {
    expect(() => {
      assertSafeRelativePath(relativePath);
    }).not.toThrow();
  });

  it.each([
    ['parent traversal', '../secret.md'],
    ['nested parent traversal', 'features/../../secret.md'],
    ['current folder segment', './project.md'],
    ['absolute POSIX path', '/etc/passwd'],
    ['absolute Windows path', 'C:\\Windows\\win.ini'],
    ['Windows drive with slashes', 'C:/Windows/win.ini'],
    ['drive-relative Windows path', 'C:secret.md'],
    ['UNC path', '\\\\server\\share\\secret.md'],
    ['backslash traversal', '..\\secret.md'],
    ['URL-encoded traversal', '%2e%2e/secret.md'],
    ['URL-encoded separator', '..%2fsecret.md'],
    ['double URL-encoded traversal', '%252e%252e/secret.md'],
    ['overlong UTF-8 encoding', '%c0%ae%c0%ae/secret.md'],
    ['fullwidth dots and slash', '\uFF0E\uFF0E\uFF0Fsecret.md'],
    ['two-dot leader', '\u2025/secret.md'],
    ['null byte', 'project.md\u0000.png'],
    ['file URL', 'file:///etc/passwd'],
    ['hidden file', '.env'],
    ['hidden folder', '.git/config'],
    ['empty segment', 'features//authentication.md'],
    ['trailing slash', 'features/'],
    ['trailing dot', 'project.md.'],
    ['right-to-left override', 'project\u202Edm.md'],
  ])('rejects %s', (_label, relativePath) => {
    expect(() => {
      assertSafeRelativePath(relativePath);
    }).toThrow(PathTraversalError);
  });

  it('rejects paths longer than the limit', () => {
    expect(() => {
      assertSafeRelativePath('a'.repeat(MAX_RELATIVE_PATH_LENGTH + 1));
    }).toThrow(/too long/);
  });

  it('does not echo control characters in its error message', () => {
    expect(() => {
      assertSafeRelativePath('a\u0000b');
    }).toThrow('"a\\u0000b"');
  });
});

describe('isSafePathSegment', () => {
  it('accepts plain names and rejects separators', () => {
    expect(isSafePathSegment('authentication.md')).toBe(true);
    expect(isSafePathSegment('a/b')).toBe(false);
    expect(isSafePathSegment('..')).toBe(false);
  });
});

describe('isInsideDirectory', () => {
  const directory = path.resolve('/data/context');

  it.each([
    ['the folder itself', directory, true],
    ['a nested file', path.join(directory, 'features', 'auth.md'), true],
    ['a child whose name starts with two dots', path.join(directory, '..notes.md'), true],
    ['the parent folder', path.dirname(directory), false],
    ['a sibling sharing the same prefix', `${directory}-evil${path.sep}secret.md`, false],
    ['an unrelated path', path.resolve('/etc/passwd'), false],
  ])('%s', (_label, candidate, expected) => {
    expect(isInsideDirectory(directory, candidate)).toBe(expected);
  });
});

describe('resolveInsideRoot', () => {
  let base: string;
  let root: string;

  beforeAll(async () => {
    base = await createFixtureDir({
      'context/project.md': '# Project',
      'context/features/authentication.md': '# Authentication',
      'outside/secret.md': 'secret',
      'context-evil/secret.md': 'secret',
    });
    root = path.join(base, 'context');
  });

  afterAll(async () => {
    await removeFixtureDir(base);
  });

  it('returns the real path of a file inside the folder', async () => {
    await expect(resolveInsideRoot(root, 'features/authentication.md')).resolves.toBe(
      await realpath(path.join(root, 'features', 'authentication.md')),
    );
  });

  it('resolves the empty path to the folder itself', async () => {
    await expect(resolveInsideRoot(root, '')).resolves.toBe(await realpath(root));
  });

  it('rejects a traversal attempt', async () => {
    await expect(resolveInsideRoot(root, '../outside/secret.md')).rejects.toThrow(
      PathTraversalError,
    );
  });

  it('reports a missing file as not found', async () => {
    await expect(resolveInsideRoot(root, 'features/missing.md')).rejects.toThrow(
      ContextNotFoundError,
    );
  });

  it('reports a missing context folder as missing, not as a missing document', async () => {
    const missing = resolveInsideRoot(path.join(base, 'missing'), 'project.md');

    await expect(missing).rejects.toThrow(ContextFolderMissingError);
    await expect(missing).rejects.not.toThrow(ContextNotFoundError);
  });

  it('reports a file in place of the context folder as a missing folder', async () => {
    await expect(resolveInsideRoot(path.join(root, 'project.md'), '')).rejects.toThrow(
      ContextFolderMissingError,
    );
  });

  it('rejects a folder link pointing outside the context folder', async () => {
    await createDirectoryLink(path.join(base, 'outside'), path.join(root, 'escape'));

    await expect(resolveInsideRoot(root, 'escape/secret.md')).rejects.toThrow(
      /Symbolic link points outside/,
    );
  });

  it('rejects a link to a sibling folder that shares the same name prefix', async () => {
    await createDirectoryLink(path.join(base, 'context-evil'), path.join(root, 'evil'));

    await expect(resolveInsideRoot(root, 'evil/secret.md')).rejects.toThrow(PathTraversalError);
  });

  it('accepts a link that stays inside the context folder', async () => {
    await createDirectoryLink(path.join(root, 'features'), path.join(root, 'docs'));

    await expect(resolveInsideRoot(root, 'docs/authentication.md')).resolves.toBe(
      await realpath(path.join(root, 'features', 'authentication.md')),
    );
  });

  it('rejects a file link pointing outside the context folder', async (context) => {
    const created = await tryCreateFileLink(
      path.join(base, 'outside', 'secret.md'),
      path.join(root, 'leak.md'),
    );
    if (!created) context.skip('file symbolic links are not allowed on this machine');

    await expect(resolveInsideRoot(root, 'leak.md')).rejects.toThrow(PathTraversalError);
  });
});
