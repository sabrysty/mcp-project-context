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
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const rawConfigSchema = z.object({
  contextDir: z
    .string({
      error: 'Missing context folder: pass --context-dir <path> or set PROJECT_CONTEXT_DIR',
    })
    .trim()
    .min(1, 'Context folder path must not be empty')
    .max(4096, 'Context folder path is too long'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * Builds the configuration from CLI arguments and environment variables.
 * CLI arguments take precedence over the environment.
 */
export function loadConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const { values } = parseCliArgs(argv);

  const parsed = rawConfigSchema.safeParse({
    contextDir: values['context-dir'] ?? env.PROJECT_CONTEXT_DIR,
    logLevel: values['log-level'] ?? env.LOG_LEVEL,
  });
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  const contextDir = resolve(parsed.data.contextDir);
  assertIsDirectory(contextDir);

  return { contextDir, logLevel: parsed.data.logLevel };
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
