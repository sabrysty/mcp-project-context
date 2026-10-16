import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  ContextFolderMissingError,
  ContextNotFoundError,
  hasErrorCode,
  PathTraversalError,
} from './errors.js';

export const MAX_RELATIVE_PATH_LENGTH = 256;

// Allowlist rather than denylist: "..", absolute paths, drive letters, backslashes,
// URL-encoded sequences (%2e%2e), control characters and look-alike Unicode dots or
// slashes are all rejected without having to enumerate them.
const SAFE_SEGMENT = /^[\p{L}\p{N}_-](?:[\p{L}\p{M}\p{N}._ -]*[\p{L}\p{M}\p{N}_-])?$/u;

/** True when `name` is usable as one segment of a path inside the context folder. */
export function isSafePathSegment(name: string): boolean {
  return SAFE_SEGMENT.test(name);
}

/**
 * Validates a path relative to the context folder, written with `/` separators.
 * The empty string designates the context folder itself.
 */
export function assertSafeRelativePath(relativePath: string): void {
  if (relativePath === '') return;

  if (relativePath.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new PathTraversalError(
      `Path is too long (max ${String(MAX_RELATIVE_PATH_LENGTH)} characters)`,
    );
  }
  if (!relativePath.split('/').every(isSafePathSegment)) {
    throw new PathTraversalError(
      `Invalid path ${JSON.stringify(relativePath)}: expected a relative path with "/" separators, ` +
        'made of letters, digits, ".", "-", "_" or spaces',
    );
  }
}

/** True when `candidate` is `directory` itself or a path inside it. */
export function isInsideDirectory(directory: string, candidate: string): boolean {
  // A plain prefix test is not enough: "/data/context-evil" starts with "/data/context".
  const relative = path.relative(directory, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/**
 * Resolves `relativePath` inside `rootDir` and guarantees that the result, symbolic links
 * included, does not leave it. Returns the real absolute path of the target.
 */
export async function resolveInsideRoot(rootDir: string, relativePath: string): Promise<string> {
  assertSafeRelativePath(relativePath);

  const lexicalPath = path.resolve(rootDir, relativePath);
  assertInside(rootDir, lexicalPath, `Path leaves the context folder: ${relativePath}`);

  // Lexically inside does not mean physically inside: a symbolic link can point anywhere.
  const realRoot = await realRootOf(rootDir);
  const realTarget = await realpathOrNotFound(lexicalPath, `Not found: ${relativePath}`);
  assertInside(
    realRoot,
    realTarget,
    `Symbolic link points outside the context folder: ${relativePath}`,
  );

  return realTarget;
}

function assertInside(directory: string, candidate: string, message: string): void {
  if (!isInsideDirectory(directory, candidate)) {
    throw new PathTraversalError(message);
  }
}

/**
 * The real path of the context folder. A missing folder, or a file in its place, is not a
 * missing document: the whole context is absent.
 */
async function realRootOf(rootDir: string): Promise<string> {
  try {
    const realRoot = await realpath(rootDir);
    if (!(await stat(realRoot)).isDirectory()) throw new ContextFolderMissingError();
    return realRoot;
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT', 'ENOTDIR')) throw new ContextFolderMissingError();
    throw error;
  }
}

async function realpathOrNotFound(target: string, notFoundMessage: string): Promise<string> {
  try {
    return await realpath(target);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT', 'ENOTDIR')) {
      throw new ContextNotFoundError(notFoundMessage);
    }
    throw error;
  }
}
