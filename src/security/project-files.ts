import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { hasErrorCode } from '../context/errors.js';
import { isInsideDirectory } from '../context/safe-path.js';
import { MAX_CODE_LENGTH } from './checker.js';
import type { Language } from './rules.js';

/** Most files check_code reads in one call. */
export const MAX_PATHS = 50;
export const MAX_PROJECT_PATH_LENGTH = 512;

/** Language of each file extension check_code reads; any other file is refused. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, Language>> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',
  // Blade templates end in .blade.php.
  '.php': 'php',
};

export const CODE_EXTENSIONS = Object.keys(LANGUAGE_BY_EXTENSION);

// Wider than the context folder's allowlist: real projects name folders "[slug]", "(group)",
// "@scope" or "+page", and keep tool settings in ".storybook". Still no separator, ":", "%",
// "~" or control character. A segment never ends with a dot or a space, which Windows
// silently drops: that also rules out "." and "..".
const PROJECT_SEGMENT = /^[\p{L}\p{N}_\-.()[\]@+][\p{L}\p{M}\p{N}_\-.()[\]@+ ]*(?<![. ])$/u;

// A UTF-8 character takes at most 4 bytes: a larger file holds more characters than allowed.
const MAX_FILE_BYTES = MAX_CODE_LENGTH * 4;

/**
 * Why a file of the project could not be checked. Its message names the path as it was given,
 * never an absolute path, so it is safe to return to an MCP client.
 */
export class ProjectFileError extends Error {
  override name = 'ProjectFileError';
}

export interface ProjectFile {
  /** The path as it was given, relative to the project folder. */
  path: string;
  language: Language;
  code: string;
}

/** The language check_code applies to a file, from its extension; undefined when it is not code. */
export function languageOfFile(relativePath: string): Language | undefined {
  return LANGUAGE_BY_EXTENSION[path.posix.extname(relativePath).toLowerCase()];
}

/**
 * Reads a code file of the project for check_code. The path is relative to `projectDir`, with
 * "/" separators; the file, symbolic links included, must stay inside the project folder.
 */
export async function readProjectFile(
  projectDir: string,
  relativePath: string,
): Promise<ProjectFile> {
  assertProjectPath(relativePath);
  const language = languageOfFile(relativePath);
  if (language === undefined) {
    throw new ProjectFileError(
      `Unsupported file type: ${relativePath} (check_code reads ${CODE_EXTENSIONS.join(', ')} files)`,
    );
  }

  // Unreachable while the segment allowlist refuses "..": a second barrier, so that a wider
  // allowlist could not turn "Not found" into a way of probing files outside the project.
  const lexicalPath = path.resolve(projectDir, relativePath);
  if (!isInsideDirectory(projectDir, lexicalPath)) {
    throw new ProjectFileError(`Path leaves the project folder: ${relativePath}`);
  }

  // Lexically inside does not mean physically inside: a symbolic link can point anywhere.
  const realRoot = await realpathOf(projectDir, 'The project folder does not exist');
  const realTarget = await realpathOf(lexicalPath, `Not found: ${relativePath}`);
  if (!isInsideDirectory(realRoot, realTarget)) {
    throw new ProjectFileError(`Symbolic link points outside the project folder: ${relativePath}`);
  }

  const info = await stat(realTarget);
  if (!info.isFile()) throw new ProjectFileError(`Not a file: ${relativePath}`);
  if (info.size > MAX_FILE_BYTES) throw tooLong(relativePath);

  const code = await readText(realTarget, relativePath);
  if (code.length > MAX_CODE_LENGTH) throw tooLong(relativePath, code.length);
  return { path: relativePath, language, code };
}

function assertProjectPath(relativePath: string): void {
  if (relativePath.length > MAX_PROJECT_PATH_LENGTH) {
    throw new ProjectFileError(
      `Path is too long (max ${String(MAX_PROJECT_PATH_LENGTH)} characters)`,
    );
  }
  if (!relativePath.split('/').every((segment) => PROJECT_SEGMENT.test(segment))) {
    throw new ProjectFileError(
      `Invalid path ${JSON.stringify(relativePath)}: expected a path relative to the project ` +
        'folder, with "/" separators, without "." or ".." segments',
    );
  }
}

async function realpathOf(target: string, notFoundMessage: string): Promise<string> {
  try {
    return await realpath(target);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT', 'ENOTDIR')) throw new ProjectFileError(notFoundMessage);
    throw error;
  }
}

async function readText(realTarget: string, relativePath: string): Promise<string> {
  try {
    return await readFile(realTarget, 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'EACCES', 'EPERM', 'EISDIR')) {
      throw new ProjectFileError(`Cannot read: ${relativePath}`);
    }
    throw error;
  }
}

function tooLong(relativePath: string, length?: number): ProjectFileError {
  const size = length === undefined ? '' : ` (${String(length)} characters)`;
  return new ProjectFileError(
    `File is too long${size}: ${relativePath} (max ${String(MAX_CODE_LENGTH)} characters; ` +
      'check it in parts with the code argument)',
  );
}
