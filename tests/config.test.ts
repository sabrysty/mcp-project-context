import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  let contextDir: string;
  let filePath: string;

  beforeAll(() => {
    contextDir = mkdtempSync(join(tmpdir(), 'mcp-context-'));
    filePath = join(contextDir, 'not-a-dir.md');
    writeFileSync(filePath, '# test');
  });

  afterAll(() => {
    rmSync(contextDir, { recursive: true, force: true });
  });

  it('reads the context folder from --context-dir', () => {
    const config = loadConfig(['--context-dir', contextDir], {});
    expect(config.contextDir).toBe(resolve(contextDir));
    expect(config.logLevel).toBe('info');
  });

  it('falls back to PROJECT_CONTEXT_DIR', () => {
    const config = loadConfig([], { PROJECT_CONTEXT_DIR: contextDir });
    expect(config.contextDir).toBe(resolve(contextDir));
  });

  it('gives precedence to the CLI argument over the environment', () => {
    const config = loadConfig(['--context-dir', contextDir], {
      PROJECT_CONTEXT_DIR: '/does/not/exist',
    });
    expect(config.contextDir).toBe(resolve(contextDir));
  });

  it('reads the log level from the CLI or LOG_LEVEL', () => {
    expect(loadConfig(['--context-dir', contextDir, '--log-level', 'debug'], {}).logLevel).toBe(
      'debug',
    );
    expect(loadConfig(['--context-dir', contextDir], { LOG_LEVEL: 'error' }).logLevel).toBe(
      'error',
    );
  });

  it('rejects a missing context folder setting', () => {
    expect(() => loadConfig([], {})).toThrow(ConfigError);
    expect(() => loadConfig([], {})).toThrow(/--context-dir/);
  });

  it('rejects an empty path', () => {
    expect(() => loadConfig([], { PROJECT_CONTEXT_DIR: '   ' })).toThrow(ConfigError);
  });

  it('rejects a path that does not exist', () => {
    expect(() => loadConfig(['--context-dir', join(contextDir, 'missing')], {})).toThrow(
      /not found/,
    );
  });

  it('rejects a path that is a file', () => {
    expect(() => loadConfig(['--context-dir', filePath], {})).toThrow(/not a directory/);
  });

  it('rejects an invalid log level', () => {
    expect(() => loadConfig(['--context-dir', contextDir, '--log-level', 'verbose'], {})).toThrow(
      ConfigError,
    );
  });

  it('rejects unknown CLI options', () => {
    expect(() => loadConfig(['--context-dir', contextDir, '--write'], {})).toThrow(ConfigError);
  });
});
