import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  startTestServer,
  textOf,
  type TestServer,
} from '../helpers/mcp-client.js';

interface SearchOutput {
  terms: string[];
  results: { source: string; section: string; excerpt: string; readWith?: string }[];
  note?: string;
  skipped: { path: string }[];
}

describe('search_docs', () => {
  let demo: TestServer;

  const search = async (args: Record<string, unknown>) => {
    const result = await demo.client.callTool('search_docs', args);
    return {
      result,
      text: textOf(result),
      output: result.structuredContent as unknown as SearchOutput,
    };
  };

  beforeAll(async () => {
    demo = await startTestServer(DEMO_CONTEXT_DIR);
  });

  afterAll(async () => {
    await demo.server.close();
  });

  it('returns the most relevant sections first, with a way to read the whole document', async () => {
    const { result, text } = await search({ query: 'refresh token' });

    expect(result.isError).toBeUndefined();
    expect(text).toMatch(
      /^\d+ results for "refresh token" \(searched stems: refresh, token\), best first:\n\n## 1\. features\/authentication\.md — Authentification › Principe\nWhole document: get_feature_doc \{"name": "authentication"\}\n\n- \*\*Access token\*\*/,
    );
  });

  it('returns the same results as structured content', async () => {
    const { output } = await search({ query: 'refresh token' });

    expect(output.terms).toEqual(['refresh', 'token']);
    expect(output.results[0]).toMatchObject({
      source: 'features/authentication.md',
      section: 'Authentification › Principe',
      readWith: 'get_feature_doc {"name": "authentication"}',
    });
    expect(output.results[0]?.excerpt).toContain('Refresh token');
  });

  it('points to the tool that reads each kind of document', async () => {
    const conventions = await search({ query: 'ValidationPipe whitelist' });
    const project = await search({ query: 'glossaire' });

    expect(
      conventions.output.results.find((hit) => hit.source === 'conventions/nestjs.md'),
    ).toMatchObject({ readWith: 'get_conventions {"topic": "nestjs"}' });
    expect(project.output.results[0]).toMatchObject({
      source: 'project.md',
      readWith: 'get_project_context',
    });
  });

  it('searches the security guidelines too, which no tool reads whole', async () => {
    const { output } = await search({ query: 'securite IDOR' });

    expect(output.results[0]?.source).toBe('security/guidelines.md');
    expect(output.results[0]?.section).toBe(
      "Règles de sécurité › Règles vérifiées en revue de code › Contrôle d'accès (IDOR)",
    );
    expect(output.results[0]?.readWith).toBeUndefined();
  });

  // Cases reported while testing the server from Claude Code (step 5 review).
  describe('relevance on the demo context', () => {
    it('only returns sections that mention the word, whatever the tags (secrets)', async () => {
      const { output } = await search({ query: 'secrets', limit: 20 });

      expect(output.results.length).toBeGreaterThan(0);
      for (const hit of output.results) {
        expect(hit.excerpt.toLowerCase()).toContain('secret');
      }
      expect(output.results.map((hit) => hit.source)).toContain('conventions/react.md');
    });

    it('returns a section whose heading names the topic whole, so no rule is cut (IDOR)', async () => {
      const { output } = await search({ query: 'IDOR' });
      const [section, mention] = output.results;

      expect(section?.section).toContain("Contrôle d'accès (IDOR)");
      expect(section?.excerpt).toContain('@CurrentUser()');
      expect(section?.excerpt).toContain('répondre **404**, pas 403');
      expect(mention?.section).toBe("Gestion des tâches › Points d'attention");
      expect(mention?.excerpt).toMatch(/^- \*\*IDOR\*\* : toujours charger une tâche/);
      expect(mention?.excerpt).not.toContain('**Pagination**');
    });

    it('ranks the overview rule among the first results (pagination)', async () => {
      const { output } = await search({ query: 'pagination' });

      expect(output.results.slice(0, 3).map((hit) => hit.source)).toContain('project.md');
    });

    it('returns only the passages about the topic from sections that mention it (pagination)', async () => {
      const { output } = await search({ query: 'pagination' });
      const excerptOf = (section: string) =>
        output.results.find((hit) => hit.section.endsWith(section))?.excerpt;

      expect(excerptOf("Points d'attention")).toBe(
        '…\n- **Pagination** : `limit` plafonné à 100 dans le DTO.\n…',
      );
      expect(excerptOf("Gestion d'état")).toMatch(
        /^\| Type d'état +\| Outil +\|\n\| -+ \| -+ \|\n…\n\| Filtres, tri, pagination +\|/,
      );
      expect(excerptOf("Gestion d'état")).not.toContain('taskKeys');
    });

    it('tells the agent to read the document before concluding when an excerpt leaves text out (pagination)', async () => {
      const { text, output } = await search({ query: 'pagination' });
      const note =
        'Excerpts with "…" leave text out: read the whole document before stating that the ' +
        'documentation does not cover a point.';

      expect(output.note).toBe(note);
      expect(text.endsWith(`\n\n${note}`)).toBe(true);
    });
  });

  it('adds no note when every excerpt is a whole section', async () => {
    const root = await createFixtureDir({ 'features/rotation.md': '# Token\n\nRotated daily.' });
    const test = await startTestServer(root);

    const result = await test.client.callTool('search_docs', { query: 'token' });

    expect(result.structuredContent).not.toHaveProperty('note');
    expect(textOf(result)).not.toContain('leave text out');
    await test.server.close();
    await removeFixtureDir(root);
  });

  it('returns 5 results by default, or `limit` results', async () => {
    expect((await search({ query: 'token' })).output.results).toHaveLength(5);
    expect((await search({ query: 'token', limit: 2 })).output.results).toHaveLength(2);
  });

  it.each([
    ['a limit of 0', { query: 'token', limit: 0 }],
    ['a limit above 20', { query: 'token', limit: 21 }],
    ['a decimal limit', { query: 'token', limit: 2.5 }],
    ['an empty query', { query: '   ' }],
    ['a query longer than 200 characters', { query: 'a'.repeat(201) }],
  ])('rejects %s before running the search', async (_label, args) => {
    const { result, text } = await search(args);

    expect(result.isError).toBe(true);
    expect(text).toContain('Input validation error');
  });

  it('explains a query made only of common words', async () => {
    const { result, text } = await search({ query: 'le la the' });

    expect(result.isError).toBe(true);
    expect(text).toContain('Nothing to search in "le la the"');
  });

  it('says so when nothing matches, without failing', async () => {
    const { result, text, output } = await search({ query: 'kubernetes' });

    expect(result.isError).toBeUndefined();
    expect(text).toMatch(/^No result for "kubernetes"/);
    expect(output.results).toEqual([]);
  });

  it('reports the files it could not search', async () => {
    const root = await createFixtureDir({
      'features/ok.md': '# Token',
      'features/broken.md': '---\ntitle: [oops\n---\n# Token',
    });
    const test = await startTestServer(root);

    const result = await test.client.callTool('search_docs', { query: 'token' });

    expect(textOf(result)).toContain('Skipped 1 file that could not be loaded');
    expect(result.structuredContent).toMatchObject({ skipped: [{ path: 'features/broken.md' }] });
    await test.server.close();
    await removeFixtureDir(root);
  });
});
