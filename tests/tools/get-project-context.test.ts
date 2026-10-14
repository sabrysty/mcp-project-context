import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  startTestServer,
  textOf,
  type TestServer,
} from '../helpers/mcp-client.js';

describe('get_project_context', () => {
  let demo: TestServer;

  beforeAll(async () => {
    demo = await startTestServer(DEMO_CONTEXT_DIR);
  });

  afterAll(async () => {
    await demo.server.close();
  });

  it('returns project.md preceded by its metadata', async () => {
    const result = await demo.client.callTool('get_project_context');

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(
      /^---\ntitle: TaskFlow — Contexte du projet\nsource: project\.md\nowner: tech lead\nupdated: 2026-10-13\ntags: \[overview, architecture, /,
    );
    expect(textOf(result)).toContain('## Architecture');
  });

  it('reports a context folder without project.md', async () => {
    const root = await createFixtureDir({ 'features/a.md': '# A' });
    const test = await startTestServer(root);

    const result = await test.client.callTool('get_project_context');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('has no project.md file');
    await test.server.close();
    await removeFixtureDir(root);
  });
});
