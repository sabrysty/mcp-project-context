import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONTEXT_FOLDER_MISSING_MESSAGE } from '../src/context/errors.js';
import { createFixtureDir, removeFixtureDir } from './helpers/fixture-dir.js';
import { resultOf, startTestServer, textOf, type TestServer } from './helpers/mcp-client.js';

// Configured once for every project, the server starts in projects that have no context
// folder yet: each request must say so, rather than answer as if the context were empty.
describe('a project without context folder', () => {
  let base: string;
  let test: TestServer;

  beforeAll(async () => {
    base = await createFixtureDir();
    test = await startTestServer(path.join(base, 'docs', 'context'));
  });

  afterAll(async () => {
    await test.server.close();
    await removeFixtureDir(base);
  });

  it.each([
    ['get_project_context', {}],
    ['list_features', {}],
    ['get_feature_doc', { name: 'authentication' }],
    ['get_conventions', {}],
    ['get_conventions', { topic: 'typescript' }],
    ['search_docs', { query: 'pagination' }],
    ['check_code', { code: 'eval(input);', language: 'ts' }],
  ])('%s %j reports the missing folder', async (tool, args) => {
    const result = await test.client.callTool(tool, args);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(CONTEXT_FOLDER_MISSING_MESSAGE);
  });

  it('lists no resource and completes nothing, without error', async () => {
    expect(resultOf(await test.client.request('resources/list'))).toEqual({ resources: [] });
    expect(
      resultOf(
        await test.client.request('completion/complete', {
          ref: { type: 'ref/prompt', name: 'explain-feature' },
          argument: { name: 'name', value: '' },
        }),
      ),
    ).toMatchObject({ completion: { values: [] } });
  });
});

describe('a context folder created while the server runs', () => {
  let base: string;
  let test: TestServer;

  beforeAll(async () => {
    base = await createFixtureDir();
    test = await startTestServer(path.join(base, 'docs', 'context'));
  });

  afterAll(async () => {
    await test.server.close();
    await removeFixtureDir(base);
  });

  it('is read at the next call, without restart', async () => {
    expect((await test.client.callTool('list_features')).isError).toBe(true);

    await mkdir(path.join(base, 'docs', 'context', 'features'), { recursive: true });
    await writeFile(path.join(base, 'docs', 'context', 'features', 'billing.md'), '# Billing');

    const result = await test.client.callTool('list_features');
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('- billing: Billing');
  });
});
