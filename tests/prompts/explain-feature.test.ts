import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  errorOf,
  resultOf,
  startTestServer,
  type TestServer,
} from '../helpers/mcp-client.js';

const INVALID_PARAMS = -32602;

interface PromptResult {
  description: string;
  messages: { role: string; content: { type: string; text: string } }[];
}

async function explain(test: TestServer, name: string): Promise<PromptResult> {
  const response = await test.client.request('prompts/get', {
    name: 'explain-feature',
    arguments: { name },
  });
  return resultOf(response) as PromptResult;
}

async function explainError(test: TestServer, args: Record<string, string>) {
  return errorOf(
    await test.client.request('prompts/get', { name: 'explain-feature', arguments: args }),
  );
}

describe('explain-feature', () => {
  describe('on the demo context', () => {
    let demo: TestServer;

    beforeAll(async () => {
      demo = await startTestServer(DEMO_CONTEXT_DIR);
    });

    afterAll(async () => {
      await demo.server.close();
    });

    it('is listed with its argument', async () => {
      const result = resultOf(await demo.client.request('prompts/list'));

      expect(result).toMatchObject({
        prompts: expect.arrayContaining([
          expect.objectContaining({
            name: 'explain-feature',
            arguments: [
              {
                name: 'name',
                description:
                  'Name of the feature, as listed by list_features (e.g. "authentication")',
                required: true,
              },
            ],
          }),
        ]) as unknown,
      });
    });

    it('brings the project overview, then the feature documentation, then the instructions', async () => {
      const { description, messages } = await explain(demo, 'authentication');
      const text = messages[0]?.content.text ?? '';
      const positions = [
        '<document source="project.md" title="TaskFlow — Contexte du projet">',
        '<document source="features/authentication.md" title="Authentification">',
        '</documentation>',
        'Explain the feature "Authentification" (features/authentication.md) to a developer who has just joined the project',
        'Rely on the documentation only: when it does not cover a point, say so instead of guessing.',
      ].map((part) => text.indexOf(part));

      expect(description).toBe('Explanation of the feature "Authentification" for a new developer');
      expect(messages).toHaveLength(1);
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(text).toContain('POST /auth/refresh');
      // project.md links to it, but its documentation is not brought.
      expect(text).not.toContain('<document source="features/task-management.md"');
    });

    it('accepts the file name of the feature', async () => {
      const { description } = await explain(demo, ' authentication.md ');

      expect(description).toBe('Explanation of the feature "Authentification" for a new developer');
    });

    it('lists the available features when the name is unknown', async () => {
      const error = await explainError(demo, { name: 'billing' });

      expect(error).toEqual({
        code: INVALID_PARAMS,
        message: 'Feature "billing" not found. Available: authentication, task-management.',
      });
    });

    it.each(['../project', 'features/../../package', 'C:\\Windows\\win'])(
      'refuses the name %j, which leaves the features folder',
      async (name) => {
        const error = await explainError(demo, { name });

        expect(error).toEqual({
          code: INVALID_PARAMS,
          message: `Invalid feature name ${JSON.stringify(name)}: use a name returned by list_features.`,
        });
      },
    );

    it.each([
      ['no name', {}],
      ['a blank name', { name: '   ' }],
      ['a name that is too long', { name: 'a'.repeat(201) }],
    ])('refuses %s', async (_, args: Record<string, string>) => {
      const error = await explainError(demo, args);

      expect(error.code).toBe(INVALID_PARAMS);
      expect(error.message).toContain('Invalid arguments for prompt explain-feature');
    });

    it('completes the feature names', async () => {
      const complete = async (value: string) =>
        resultOf(
          await demo.client.request('completion/complete', {
            ref: { type: 'ref/prompt', name: 'explain-feature' },
            argument: { name: 'name', value },
          }),
        );

      await expect(complete('AUTH')).resolves.toMatchObject({
        completion: { values: ['authentication'] },
      });
      await expect(complete('')).resolves.toMatchObject({
        completion: { values: ['authentication', 'task-management'] },
      });
    });
  });

  it('explains a nested feature of a project without overview', async () => {
    const root = await createFixtureDir({
      'features/billing/invoices.md': '---\ntitle: Invoices\n---\n# Invoices\n\nMonthly.',
    });
    const test = await startTestServer(root);

    const { messages } = await explain(test, 'billing/invoices');
    const text = messages[0]?.content.text ?? '';

    expect(
      text.startsWith('<documentation>\n<document source="features/billing/invoices.md"'),
    ).toBe(true);
    expect(text).not.toContain('project.md');
    await test.server.close();
    await removeFixtureDir(root);
  });
});
