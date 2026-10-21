import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as z from 'zod/v4';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface Config {
  /** Absolute path of the context folder. */
  contextDir: string;
  /** Absolute path of the project folder: check_code reads the files it is given from there. */
  projectDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/** The context folder when none is given, relative to the project folder. */
export const DEFAULT_CONTEXT_DIR = 'docs/context';

const rawConfigSchema = z.object({
  contextDir: z
    .string()
    .trim()
    .min(1, 'Context folder path must not be empty')
    .max(4096, 'Context folder path is too long')
    .optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Builds the configuration from CLI arguments and environment variables.
 * CLI arguments take precedence over the environment; without either, the context folder is
 * docs/context in the project folder.
 */
export function loadConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Config {
  const { values } = parseCliArgs(argv);

  const parsed = rawConfigSchema.safeParse({
    contextDir: values['context-dir'] ?? env.PROJECT_CONTEXT_DIR,
    logLevel: values['log-level'] ?? env.LOG_LEVEL,
  });
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  const given = parsed.data.contextDir;
  const projectDir = projectFolder(env, cwd);
  // An absolute path is kept as it is; a relative one starts from the project folder.
  const contextDir = resolve(projectDir, given ?? DEFAULT_CONTEXT_DIR);
  // A folder given explicitly must exist: a typo stops the server. The default one may not
  // exist yet, in a project that is not documented: the tools then report it.
  if (given !== undefined) assertIsDirectory(contextDir);

  return { contextDir, projectDir, logLevel: parsed.data.logLevel };
}

/**
 * The folder that relative paths start from. Claude Code gives the project root in
 * CLAUDE_PROJECT_DIR, since the working directory of a server it starts is not guaranteed;
 * without it, the working directory.
 */
function projectFolder(env: NodeJS.ProcessEnv, cwd: string): string {
  const projectDir = env.CLAUDE_PROJECT_DIR?.trim();
  return projectDir ? resolve(cwd, projectDir) : resolve(cwd);
}

function parseCliArgs(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      options: {
        'context-dir': { type: 'string' },
        'log-level': { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
}

function assertIsDirectory(path: string): void {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) {
    throw new ConfigError(`Context folder not found or not a directory: ${path}`);
  }
}
