import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVER_NAME } from '../src/server.js';
import {
  DEMO_CONTEXT_DIR,
  startTestServer,
  textOf,
  type TestServer,
} from './helpers/mcp-client.js';

describe('createServer', () => {
  let test: TestServer;

  beforeAll(async () => {
    test = await startTestServer(DEMO_CONTEXT_DIR);
  });

  afterAll(async () => {
    await test.server.close();
  });

  it('identifies itself during initialization', () => {
    expect(test.initializeResponse).toMatchObject({
      result: { serverInfo: { name: SERVER_NAME } },
    });
  });

  it('registers every tool as read-only, with a description', async () => {
    const tools = await test.client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      'ping',
      'get_project_context',
      'list_features',
      'get_feature_doc',
      'get_conventions',
      'search_docs',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(50);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }
  });

  it('advertises bounded input schemas', async () => {
    const tools = await test.client.listTools();
    const inputOf = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema;

    expect(inputOf('get_feature_doc')).toMatchObject({
      properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['name'],
    });
    expect(inputOf('get_conventions')).toMatchObject({
      properties: { topic: { type: 'string', maxLength: 200 } },
    });
    expect(inputOf('get_conventions')).not.toHaveProperty('required');
    expect(inputOf('search_docs')).toMatchObject({
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        limit: { minimum: 1, maximum: 20, default: 5 },
      },
      required: ['query'],
    });
  });

  it.each([
    ['list_features', ['features', 'skipped']],
    ['search_docs', ['query', 'terms', 'results', 'skipped']],
  ])('advertises the output schema of %s', async (name, required) => {
    const tools = await test.client.listTools();

    expect(tools.find((tool) => tool.name === name)?.outputSchema).toMatchObject({
      type: 'object',
      required,
    });
  });

  it('answers pong to a ping call', async () => {
    const result = await test.client.callTool('ping');

    expect(textOf(result)).toBe('pong');
    expect(result.isError).toBeUndefined();
  });
});
