import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { documentUri } from '../../src/resources/context-documents.js';
import { createDirectoryLink, createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  errorOf,
  resultOf,
  startTestServer,
  textOf,
  type TestServer,
} from '../helpers/mcp-client.js';

const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

interface ListedResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

interface ResourceContents {
  uri: string;
  mimeType?: string;
  text: string;
}

async function listResources(test: TestServer): Promise<ListedResource[]> {
  const result = resultOf(await test.client.request('resources/list'));
  return (result as { resources: ListedResource[] }).resources;
}

async function readResource(test: TestServer, uri: string): Promise<ResourceContents> {
  const result = resultOf(await test.client.request('resources/read', { uri }));
  const [contents] = (result as { contents: ResourceContents[] }).contents;
  if (!contents) throw new Error(`No contents for ${uri}`);
  return contents;
}

async function readError(test: TestServer, uri: string) {
  return errorOf(await test.client.request('resources/read', { uri }));
}

async function completePath(test: TestServer, value: string): Promise<string[]> {
  const result = resultOf(
    await test.client.request('completion/complete', {
      ref: { type: 'ref/resource', uri: 'context://{+path}' },
      argument: { name: 'path', value },
    }),
  );
  return (result as { completion: { values: string[] } }).completion.values;
}

describe('documentUri', () => {
  it.each([
    ['project.md', 'context://project'],
    ['features/authentication.md', 'context://features/authentication'],
    ['features/billing/invoices.md', 'context://features/billing/invoices'],
    ['features/gestion des tâches.md', 'context://features/gestion%20des%20t%C3%A2ches'],
  ])('gives %s the URI %s', (documentPath, uri) => {
    expect(documentUri(documentPath)).toBe(uri);
  });
});

describe('context document resources', () => {
  describe('on the demo context', () => {
    let demo: TestServer;

    beforeAll(async () => {
      demo = await startTestServer(DEMO_CONTEXT_DIR);
    });

    afterAll(async () => {
      await demo.server.close();
    });

    it('declares the resources capability', () => {
      expect(demo.initializeResponse).toMatchObject({
        result: { capabilities: { resources: {} } },
      });
    });

    it('advertises one URI template for every document', async () => {
      const result = resultOf(await demo.client.request('resources/templates/list'));

      expect(result).toEqual({
        resourceTemplates: [
          expect.objectContaining({
            name: 'context-document',
            uriTemplate: 'context://{+path}',
            title: 'Context document',
            mimeType: 'text/markdown',
          }),
        ],
      });
    });

    it('lists every Markdown document with its URI, title and description', async () => {
      const resources = await listResources(demo);

      expect(resources.map((resource) => resource.uri)).toEqual([
        'context://conventions/nestjs',
        'context://conventions/react',
        'context://conventions/typescript',
        'context://features/authentication',
        'context://features/task-management',
        'context://project',
        'context://security/guidelines',
      ]);
      expect(resources).toContainEqual({
        uri: 'context://security/guidelines',
        name: 'security/guidelines',
        title: 'Règles de sécurité',
        description: 'Security guidelines, including the rules that check_code verifies',
        mimeType: 'text/markdown',
      });
      expect(resources.find((resource) => resource.name === 'features/authentication')).toEqual(
        expect.objectContaining({ description: 'Documentation of the feature "authentication"' }),
      );
    });

    it('reads every listed document as Markdown, with its metadata', async () => {
      for (const { uri, title } of await listResources(demo)) {
        const contents = await readResource(demo, uri);

        expect(contents.uri).toBe(uri);
        expect(contents.mimeType).toBe('text/markdown');
        expect(contents.text.startsWith(`---\ntitle: ${String(title)}\nsource: `)).toBe(true);
      }
    });

    it('returns the same text as the tools that read the same document', async () => {
      const project = await readResource(demo, 'context://project');
      const feature = await readResource(demo, 'context://features/authentication');
      const convention = await readResource(demo, 'context://conventions/nestjs');

      expect(project.text).toBe(textOf(await demo.client.callTool('get_project_context')));
      expect(feature.text).toBe(
        textOf(await demo.client.callTool('get_feature_doc', { name: 'authentication' })),
      );
      expect(convention.text).toBe(
        textOf(await demo.client.callTool('get_conventions', { topic: 'nestjs' })),
      );
    });

    it('accepts the .md extension in the URI', async () => {
      const contents = await readResource(demo, 'context://features/authentication.md');

      expect(contents.text).toContain('source: features/authentication.md');
    });

    it('answers a missing document with a "not found" error that names the URI', async () => {
      const error = await readError(demo, 'context://features/billing');

      expect(error).toEqual({
        code: INVALID_PARAMS,
        message:
          'No document at context://features/billing: list the resources to see the available documents.',
        data: { uri: 'context://features/billing' },
      });
    });

    it('does not expose the security rules file, which is not Markdown', async () => {
      const error = await readError(demo, 'context://security/rules');

      expect(error.message).toContain('No document at context://security/rules');
    });

    it.each([
      ['a parent folder', 'context://../package'],
      ['an encoded parent folder', 'context://%2e%2e/package'],
      ['encoded slashes', 'context://features%2F..%2F..%2Fpackage'],
      ['a query string', 'context://features/authentication?raw=1'],
      ['a trailing slash', 'context://project/'],
      ['a backslash', 'context://features%5C..%5Cpackage'],
    ])('refuses a URI holding %s', async (_, uri) => {
      const error = await readError(demo, uri);

      expect(error.code).toBe(INVALID_PARAMS);
      expect(error.message).not.toContain(DEMO_CONTEXT_DIR);
    });

    it('stays inside the context folder when the URL parser resolves "..", "." and "%2e"', async () => {
      // new URL() turns context://features/../../x into context://features/x before the
      // template is even matched.
      const error = await readError(demo, 'context://features/%2e%2e/%2e%2e/package');

      expect(error.message).toBe(
        'No document at context://features/package: list the resources to see the available documents.',
      );
    });

    it('refuses a malformed percent-encoding', async () => {
      const error = await readError(demo, 'context://features/%E0%A4%A');

      expect(error.code).toBe(INVALID_PARAMS);
      expect(error.message).toContain('Invalid document URI context://features/%E0%A4%A');
    });

    it('does not serve other URI schemes', async () => {
      const error = await readError(demo, 'file:///etc/passwd');

      expect(error).toMatchObject({ code: INVALID_PARAMS, data: { uri: 'file:///etc/passwd' } });
    });

    it('completes document paths from what was typed', async () => {
      await expect(completePath(demo, 'feat')).resolves.toEqual([
        'features/authentication',
        'features/task-management',
      ]);
      await expect(completePath(demo, 'SEC')).resolves.toEqual(['security/guidelines']);
      await expect(completePath(demo, '')).resolves.toHaveLength(7);
      await expect(completePath(demo, 'nothing')).resolves.toEqual([]);
    });
  });

  describe('on a context with unusual names and problems', () => {
    let root: string;
    let outside: string;
    let test: TestServer;
    const logs: string[] = [];

    beforeAll(async () => {
      outside = await createFixtureDir({ 'secret.md': '# Secret' });
      root = await createFixtureDir({
        'features/billing/invoices.md': '# Invoices',
        'features/gestion des tâches.md': '---\ntitle: Gestion des tâches\n---\n# Tâches',
        'notes/décisions.md': '# Décisions',
        'features/broken.md': '---\ntags: auth\n---\n# Broken',
      });
      await createDirectoryLink(outside, path.join(root, 'features', 'outside'));
      test = await startTestServer(root, logs);
    });

    afterAll(async () => {
      await test.server.close();
      await removeFixtureDir(root);
      await removeFixtureDir(outside);
    });

    it('lists nested documents and names with spaces or accents, percent-encoded', async () => {
      const resources = await listResources(test);

      expect(resources.map((resource) => resource.uri)).toEqual([
        'context://features/billing/invoices',
        'context://features/gestion%20des%20t%C3%A2ches',
        'context://notes/d%C3%A9cisions',
      ]);
      expect(resources[2]).toMatchObject({
        name: 'notes/décisions',
        description: 'Context document notes/décisions.md',
      });
    });

    it('reads them back by the URI it listed', async () => {
      for (const { uri } of await listResources(test)) {
        await expect(readResource(test, uri)).resolves.toMatchObject({ uri });
      }
    });

    it('leaves a document with an invalid front-matter out of the list, with a warning', async () => {
      await listResources(test);

      expect(logs.join('\n')).toContain('WARN Documents left out of the resource list');
      expect(logs.join('\n')).toContain('features/broken.md');
    });

    it('explains why such a document cannot be read', async () => {
      const error = await readError(test, 'context://features/broken');

      expect(error.code).toBe(INTERNAL_ERROR);
      expect(error.message).toContain('Invalid front-matter in features/broken.md');
    });

    it('refuses a symbolic link that leads outside the context folder', async () => {
      const error = await readError(test, 'context://features/outside/secret');

      expect(error).toMatchObject({
        code: INVALID_PARAMS,
        message: 'Symbolic link points outside the context folder: features/outside/secret.md',
      });
      expect(error.message).not.toContain(outside);
    });
  });
});
