import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  let contextDir: string;
  let filePath: string;
  /** A project with a docs/context folder. */
  let projectDir: string;
  /** A folder without docs/context. */
  let otherDir: string;

  beforeAll(() => {
    contextDir = mkdtempSync(join(tmpdir(), 'mcp-context-'));
    filePath = join(contextDir, 'not-a-dir.md');
    writeFileSync(filePath, '# test');
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-project-'));
    mkdirSync(join(projectDir, 'docs', 'context'), { recursive: true });
    otherDir = mkdtempSync(join(tmpdir(), 'mcp-other-'));
  });

  afterAll(() => {
    for (const dir of [contextDir, projectDir, otherDir]) {
      rmSync(dir, { recursive: true, force: true });
    }
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

  describe('without a given folder', () => {
    it('reads docs/context in the project folder given by Claude Code', () => {
      const config = loadConfig([], { CLAUDE_PROJECT_DIR: projectDir }, otherDir);
      expect(config.contextDir).toBe(join(projectDir, 'docs', 'context'));
    });

    it('reads docs/context in the working folder otherwise', () => {
      expect(loadConfig([], {}, projectDir).contextDir).toBe(join(projectDir, 'docs', 'context'));
      expect(loadConfig([], { CLAUDE_PROJECT_DIR: '  ' }, projectDir).contextDir).toBe(
        join(projectDir, 'docs', 'context'),
      );
    });

    it('accepts a default folder that does not exist yet', () => {
      const config = loadConfig([], { CLAUDE_PROJECT_DIR: otherDir }, projectDir);
      expect(config.contextDir).toBe(join(otherDir, 'docs', 'context'));
    });
  });

  it('resolves a relative folder in the project folder, from the CLI or the environment', () => {
    expect(
      loadConfig(['--context-dir', 'docs/context'], { CLAUDE_PROJECT_DIR: projectDir }, otherDir)
        .contextDir,
    ).toBe(join(projectDir, 'docs', 'context'));
    expect(
      loadConfig(
        [],
        { CLAUDE_PROJECT_DIR: projectDir, PROJECT_CONTEXT_DIR: 'docs/context' },
        otherDir,
      ).contextDir,
    ).toBe(join(projectDir, 'docs', 'context'));
  });

  it('keeps an absolute folder whatever the project folder', () => {
    const config = loadConfig(['--context-dir', contextDir], { CLAUDE_PROJECT_DIR: projectDir });
    expect(config.contextDir).toBe(resolve(contextDir));
  });

  it('rejects a given relative folder that does not exist', () => {
    expect(() =>
      loadConfig(['--context-dir', 'docs/context'], { CLAUDE_PROJECT_DIR: otherDir }),
    ).toThrow(/not found/);
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
