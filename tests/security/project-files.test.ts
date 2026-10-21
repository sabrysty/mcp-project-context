import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_CODE_LENGTH } from '../../src/security/checker.js';
import {
  languageOfFile,
  MAX_PROJECT_PATH_LENGTH,
  ProjectFileError,
  readProjectFile,
} from '../../src/security/project-files.js';
import {
  createDirectoryLink,
  createFixtureDir,
  removeFixtureDir,
  tryCreateFileLink,
} from '../helpers/fixture-dir.js';

describe('readProjectFile', () => {
  let project: string;
  let outside: string;

  beforeAll(async () => {
    project = await createFixtureDir({
      'src/app/page.tsx': 'export default function Page() {}',
      'src/app/[slug]/page.tsx': 'export {};',
      'src/(marketing)/about/page.tsx': 'export {};',
      'packages/@scope/lib/index.ts': 'export {};',
      'src/routes/+page.ts': 'export {};',
      '.storybook/main.ts': 'export {};',
      'My Folder/file.js': 'export {};',
      'resources/views/home.blade.php': '<p>{{ $name }}</p>',
      'dir.ts/readme.md': '# A folder named like a code file',
      '.env': 'SECRET=1',
      'notes.md': '# Notes',
      'exact.ts': 'a'.repeat(MAX_CODE_LENGTH),
      'long.ts': 'a'.repeat(MAX_CODE_LENGTH + 1),
    });
    outside = await createFixtureDir({ 'secret.ts': 'export const key = "outside";' });
    await createDirectoryLink(outside, path.join(project, 'linked-outside'));
    await createDirectoryLink(path.join(project, 'src'), path.join(project, 'linked-inside'));
  });

  afterAll(async () => {
    await removeFixtureDir(project);
    await removeFixtureDir(outside);
  });

  async function messageOf(relativePath: string, projectDir = project): Promise<string> {
    const error = await readProjectFile(projectDir, relativePath).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ProjectFileError);
    return (error as ProjectFileError).message;
  }

  it('reads a code file and gives its language, from the extension', async () => {
    await expect(readProjectFile(project, 'src/app/page.tsx')).resolves.toEqual({
      path: 'src/app/page.tsx',
      language: 'tsx',
      code: 'export default function Page() {}',
    });
  });

  it('maps every code extension to its language, whatever the case', () => {
    const files = ['a.ts', 'a.mts', 'a.cts', 'a.tsx', 'a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.php'];
    expect(files.map(languageOfFile)).toEqual([
      'ts',
      'ts',
      'ts',
      'tsx',
      'js',
      'js',
      'js',
      'jsx',
      'php',
    ]);
    expect(languageOfFile('views/home.blade.php')).toBe('php');
    expect(languageOfFile('A.TSX')).toBe('tsx');
    expect(languageOfFile('notes.md')).toBeUndefined();
    expect(languageOfFile('Makefile')).toBeUndefined();
  });

  it.each([
    'src/app/[slug]/page.tsx',
    'src/(marketing)/about/page.tsx',
    'packages/@scope/lib/index.ts',
    'src/routes/+page.ts',
    '.storybook/main.ts',
    'My Folder/file.js',
    'resources/views/home.blade.php',
  ])('accepts %j, a name real projects use', async (relativePath) => {
    await expect(readProjectFile(project, relativePath)).resolves.toMatchObject({
      path: relativePath,
    });
  });

  it.each([
    '',
    '../secret.ts',
    'src/../../secret.ts',
    './src/app/page.tsx',
    'src/./app/page.tsx',
    '...',
    '.../secret.ts',
    '/etc/secret.ts',
    'C:/secret.ts',
    'C:\\secret.ts',
    'src\\app\\page.tsx',
    'src//app/page.tsx',
    'src/app/page.tsx.',
    'src /app/page.tsx',
    ' src/app/page.tsx',
    'src/%2e%2e/secret.ts',
    'PROGRA~1/secret.ts',
    'src/app/page.tsx:stream',
    'src/app/page\u0000.tsx',
    'src/app/page.tsx\n',
  ])('refuses the path %j', async (relativePath) => {
    expect(await messageOf(relativePath)).toMatch(/^Invalid path /);
  });

  it('refuses a path that is too long', async () => {
    const relativePath = `${'a/'.repeat(MAX_PROJECT_PATH_LENGTH / 2)}x.ts`;
    expect(await messageOf(relativePath)).toBe(
      `Path is too long (max ${String(MAX_PROJECT_PATH_LENGTH)} characters)`,
    );
  });

  it.each(['.env', 'notes.md', 'src/app'])(
    'refuses %j, which is not code',
    async (relativePath) => {
      expect(await messageOf(relativePath)).toBe(
        `Unsupported file type: ${relativePath} (check_code reads .ts, .mts, .cts, .tsx, .js, .mjs, .cjs, .jsx, .php files)`,
      );
    },
  );

  it('reports a missing file', async () => {
    expect(await messageOf('src/missing.ts')).toBe('Not found: src/missing.ts');
  });

  it('refuses a folder named like a code file', async () => {
    expect(await messageOf('dir.ts')).toBe('Not a file: dir.ts');
  });

  it('refuses a link to a folder outside the project', async () => {
    expect(await messageOf('linked-outside/secret.ts')).toBe(
      'Symbolic link points outside the project folder: linked-outside/secret.ts',
    );
  });

  it('follows a link that stays inside the project', async () => {
    await expect(readProjectFile(project, 'linked-inside/app/page.tsx')).resolves.toMatchObject({
      language: 'tsx',
      code: 'export default function Page() {}',
    });
  });

  it('refuses a file link to a file outside the project, where the OS allows one', async () => {
    const created = await tryCreateFileLink(
      path.join(outside, 'secret.ts'),
      path.join(project, 'secret-link.ts'),
    );
    if (!created) return;
    expect(await messageOf('secret-link.ts')).toBe(
      'Symbolic link points outside the project folder: secret-link.ts',
    );
  });

  it('accepts a file of the maximum length and refuses a longer one', async () => {
    await expect(readProjectFile(project, 'exact.ts')).resolves.toMatchObject({
      path: 'exact.ts',
    });
    expect(await messageOf('long.ts')).toBe(
      `File is too long (${String(MAX_CODE_LENGTH + 1)} characters): long.ts ` +
        `(max ${String(MAX_CODE_LENGTH)} characters; check it in parts with the code argument)`,
    );
  });

  it('refuses a file too large to hold the maximum length, without reading it', async () => {
    // 4 bytes per character at most in UTF-8: a larger file is refused from its size alone.
    await writeFile(path.join(project, 'huge.ts'), 'a'.repeat(MAX_CODE_LENGTH * 4 + 1));

    expect(await messageOf('huge.ts')).toBe(
      `File is too long: huge.ts (max ${String(MAX_CODE_LENGTH)} characters; check it in ` +
        'parts with the code argument)',
    );
  });

  it('reports a missing project folder', async () => {
    expect(await messageOf('src/app/page.tsx', path.join(project, 'missing'))).toBe(
      'The project folder does not exist',
    );
  });

  it('never puts an absolute path in its messages', async () => {
    const messages = await Promise.all(
      ['../secret.ts', 'notes.md', 'src/missing.ts', 'dir.ts', 'linked-outside/secret.ts'].map(
        (relativePath) => messageOf(relativePath),
      ),
    );
    for (const message of messages) {
      expect(message).not.toContain(project);
      expect(message).not.toContain(outside);
    }
  });
});
