import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  startTestServer,
  textOf,
  type TestServer,
} from '../helpers/mcp-client.js';

describe('list_features', () => {
  describe('on the demo context', () => {
    let demo: TestServer;

    beforeAll(async () => {
      demo = await startTestServer(DEMO_CONTEXT_DIR);
    });

    afterAll(async () => {
      await demo.server.close();
    });

    it('lists the features as text', async () => {
      const result = await demo.client.callTool('list_features');

      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toBe(
        [
          '2 documented features:',
          '- authentication: Authentification (tags: auth, jwt, nestjs; updated 2026-10-01)',
          '- task-management: Gestion des tâches (tags: tasks, kanban, workspace, nestjs, react, typeorm; updated 2026-09-26)',
          '',
          'Read one with get_feature_doc, passing its name.',
        ].join('\n'),
      );
    });

    it('returns the same list as structured content', async () => {
      const result = await demo.client.callTool('list_features');

      expect(result.structuredContent).toEqual({
        features: [
          {
            name: 'authentication',
            title: 'Authentification',
            tags: ['auth', 'jwt', 'nestjs'],
            owner: 'équipe back',
            updated: '2026-10-01',
          },
          {
            name: 'task-management',
            title: 'Gestion des tâches',
            tags: ['tasks', 'kanban', 'workspace', 'nestjs', 'react', 'typeorm'],
            owner: 'équipe produit',
            updated: '2026-09-26',
          },
        ],
        skipped: [],
      });
    });
  });

  describe('on a context with problems', () => {
    let root: string;
    let test: TestServer;

    beforeAll(async () => {
      root = await createFixtureDir({
        'features/billing/invoices.md': '# Invoices',
        'features/broken.md': '---\ntags: auth\n---\n# Broken',
      });
      test = await startTestServer(root);
    });

    afterAll(async () => {
      await test.server.close();
      await removeFixtureDir(root);
    });

    it('names nested features by their path and reports skipped files', async () => {
      const result = await test.client.callTool('list_features');
      const text = textOf(result);

      expect(text).toContain('1 documented feature:\n- billing/invoices: Invoices\n');
      expect(text).toContain('Skipped 1 file that could not be loaded');
      expect(text).toContain('- features/broken.md: Invalid front-matter');
      expect(result.structuredContent).toMatchObject({
        features: [{ name: 'billing/invoices', title: 'Invoices', tags: [] }],
        skipped: [{ path: 'features/broken.md' }],
      });
    });
  });

  it('explains that no feature is documented', async () => {
    const root = await createFixtureDir({ 'project.md': '# Project' });
    const test = await startTestServer(root);

    const result = await test.client.callTool('list_features');

    expect(textOf(result)).toBe(
      'No feature is documented yet: the context folder has no Markdown file under features/.',
    );
    expect(result.structuredContent).toEqual({ features: [], skipped: [] });
    await test.server.close();
    await removeFixtureDir(root);
  });
});
