import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { hasErrorCode } from '../../src/context/errors.js';

/** Creates a temporary folder holding `files` (relative path → content) and returns its path. */
export async function createFixtureDir(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mcp-context-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

export async function removeFixtureDir(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/** Links a folder: a junction on Windows (no special rights needed), a symbolic link elsewhere. */
export async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, 'junction');
}

/**
 * Links a file, or returns false when the OS refuses it: on Windows, file symbolic links
 * require Developer Mode or administrator rights.
 */
export async function tryCreateFileLink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, 'file');
    return true;
  } catch (error) {
    if (hasErrorCode(error, 'EPERM')) return false;
    throw error;
  }
}
