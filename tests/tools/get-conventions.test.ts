import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatLargeDocuments, LARGE_DOCUMENT_CHARACTERS } from '../../src/tools/format.js';
import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  startTestServer,
  textOf,
  type TestServer,
} from '../helpers/mcp-client.js';

const DEMO_TOPICS = [
  '3 convention topics:',
  '- nestjs: Conventions NestJS',
  '- react: Conventions React',
  '- typescript: Conventions TypeScript',
  '',
  'Call get_conventions with one of these topics to read it.',
].join('\n');

describe('get_conventions', () => {
  let demo: TestServer;

  beforeAll(async () => {
    demo = await startTestServer(DEMO_CONTEXT_DIR);
  });

  afterAll(async () => {
    await demo.server.close();
  });

  it.each([
    ['without a topic', {}],
    ['with an empty topic', { topic: '' }],
  ])('lists the available topics %s', async (_label, args) => {
    const result = await demo.client.callTool('get_conventions', args);

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(DEMO_TOPICS);
  });

  it('returns the conventions of a topic', async () => {
    const result = await demo.client.callTool('get_conventions', { topic: 'nestjs' });

    expect(textOf(result)).toMatch(
      /^---\ntitle: Conventions NestJS\nsource: conventions\/nestjs\.md\n/,
    );
    expect(textOf(result)).toContain('## DTO et validation');
  });

  it('lists the valid topics when the topic is unknown', async () => {
    const result = await demo.client.callTool('get_conventions', { topic: 'java' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Convention topic "java" not found. Available: nestjs, react, typescript.',
    );
  });

  it('refuses a topic that tries to leave the conventions folder', async () => {
    const result = await demo.client.callTool('get_conventions', { topic: '../project' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid convention topic "../project"');
  });

  it('reports convention files that could not be loaded', async () => {
    const root = await createFixtureDir({
      'conventions/react.md': '# React',
      'conventions/broken.md': '---\ntitle: [oops\n---\n',
    });
    const test = await startTestServer(root);

    const text = textOf(await test.client.callTool('get_conventions'));

    expect(text).toContain('1 convention topic:\n- react: React');
    expect(text).toContain('Skipped 1 file that could not be loaded');
    expect(text).toContain('- conventions/broken.md: Invalid front-matter');
    await test.server.close();
    await removeFixtureDir(root);
  });

  it('flags a large topic, to search first and to split', async () => {
    const largeBody = `# Laravel\n\n${'x'.repeat(LARGE_DOCUMENT_CHARACTERS)}`;
    const root = await createFixtureDir({
      'conventions/laravel.md': largeBody,
      'conventions/tests.md': '# Tests',
    });
    const test = await startTestServer(root);

    const text = textOf(await test.client.callTool('get_conventions'));

    expect(text).toBe(
      [
        '2 convention topics:',
        `- laravel: Laravel (large: ${String(largeBody.length)} characters)`,
        '- tests: Tests',
        '',
        'Call get_conventions with one of these topics to read it.',
        '',
        formatLargeDocuments(['laravel'], 'for instance one per topic under conventions/'),
      ].join('\n'),
    );
    await test.server.close();
    await removeFixtureDir(root);
  });

  it('explains that no convention is documented', async () => {
    const root = await createFixtureDir({ 'project.md': '# Project' });
    const test = await startTestServer(root);

    const text = textOf(await test.client.callTool('get_conventions'));

    expect(text).toBe(
      'No coding convention is documented yet: the context folder has no Markdown file under conventions/.',
    );
    await test.server.close();
    await removeFixtureDir(root);
  });
});
