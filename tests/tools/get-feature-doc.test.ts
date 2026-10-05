import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  startTestServer,
  textOf,
  type TestServer,
} from '../helpers/mcp-client.js';

describe('get_feature_doc', () => {
  let demo: TestServer;

  beforeAll(async () => {
    demo = await startTestServer(DEMO_CONTEXT_DIR);
  });

  afterAll(async () => {
    await demo.server.close();
  });

  it('returns the documentation of a feature with its metadata', async () => {
    const result = await demo.client.callTool('get_feature_doc', { name: 'authentication' });

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toMatch(
      /^---\ntitle: Authentification\nsource: features\/authentication\.md\nowner: équipe back\n/,
    );
    expect(textOf(result)).toContain('## Endpoints');
  });

  it.each(['authentication.md', '  authentication  '])('understands %j', async (name) => {
    const result = await demo.client.callTool('get_feature_doc', { name });

    expect(textOf(result)).toContain('source: features/authentication.md');
  });

  it('lists the available features when the name is unknown', async () => {
    const result = await demo.client.callTool('get_feature_doc', { name: 'billing' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Feature "billing" not found. Available: authentication, task-management.',
    );
  });

  it('refuses a name that tries to leave the features folder', async () => {
    const result = await demo.client.callTool('get_feature_doc', { name: '../project' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Invalid feature name "../project": use a name returned by list_features.',
    );
  });

  it.each([
    ['an empty name', { name: '   ' }],
    ['a name longer than 200 characters', { name: 'a'.repeat(201) }],
    ['a missing name', {}],
  ])('rejects %s before running the tool', async (_label, args) => {
    const result = await demo.client.callTool('get_feature_doc', args);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Input validation error');
  });

  it('reports a feature whose front-matter is invalid', async () => {
    const root = await createFixtureDir({ 'features/broken.md': '---\nupdated: hier\n---\n' });
    const test = await startTestServer(root);

    const result = await test.client.callTool('get_feature_doc', { name: 'broken' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid front-matter in features/broken.md');
    await test.server.close();
    await removeFixtureDir(root);
  });

  it('says so when no feature is documented', async () => {
    const root = await createFixtureDir({ 'project.md': '# Project' });
    const test = await startTestServer(root);

    const result = await test.client.callTool('get_feature_doc', { name: 'authentication' });

    expect(textOf(result)).toBe(
      'Feature "authentication" not found: none is documented in this project.',
    );
    await test.server.close();
    await removeFixtureDir(root);
  });
});
