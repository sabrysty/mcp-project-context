import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatLargeDocuments, LARGE_DOCUMENT_CHARACTERS } from '../../src/tools/format.js';
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
          '- authentication: Authentification (tags: auth, jwt, nestjs; updated 2026-10-13)',
          '- task-management: Gestion des tâches (tags: tasks, kanban, workspace, nestjs, react, typeorm; updated 2026-10-13)',
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
            updated: '2026-10-13',
            characters: expect.any(Number) as number,
          },
          {
            name: 'task-management',
            title: 'Gestion des tâches',
            tags: ['tasks', 'kanban', 'workspace', 'nestjs', 'react', 'typeorm'],
            owner: 'équipe produit',
            updated: '2026-10-13',
            characters: expect.any(Number) as number,
          },
        ],
        skipped: [],
      });
    });
  });

  describe('on a context with a large feature', () => {
    // Front-matter and leading blank lines are not part of the document's length.
    const largeBody = `# Reporting\n\n${'x'.repeat(LARGE_DOCUMENT_CHARACTERS)}\n`;
    let root: string;
    let test: TestServer;

    beforeAll(async () => {
      root = await createFixtureDir({
        'features/authentication.md': '# Authentication',
        'features/reporting.md': `---\ntitle: Reporting\n---\n\n${largeBody}`,
      });
      test = await startTestServer(root);
    });

    afterAll(async () => {
      await test.server.close();
      await removeFixtureDir(root);
    });

    it('gives the length of each feature and flags the large one', async () => {
      const result = await test.client.callTool('list_features');
      const text = textOf(result);

      expect(text).toContain(
        `- authentication: Authentication\n- reporting: Reporting (large: ${String(largeBody.length)} characters)\n`,
      );
      expect(result.structuredContent).toMatchObject({
        features: [
          { name: 'authentication', characters: '# Authentication'.length },
          { name: 'reporting', characters: largeBody.length },
        ],
      });
    });

    it('advises searching the large feature and splitting it, in the text and the structure', async () => {
      const result = await test.client.callTool('list_features');
      const note = result.structuredContent?.note;

      expect(note).toBe(
        formatLargeDocuments(
          ['reporting'],
          'for instance one per part under features/<feature name>/',
        ),
      );
      expect(textOf(result)).toContain(`\n\n${String(note)}`);
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
