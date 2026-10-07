import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_CODE_LENGTH } from '../../src/security/checker.js';
import { MAX_LISTED_VIOLATIONS } from '../../src/tools/check-code.js';
import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import {
  DEMO_CONTEXT_DIR,
  startTestServer,
  textOf,
  type TestServer,
} from '../helpers/mcp-client.js';

const LIMITS_NOTE =
  'The rules are regular expressions matched against the code as text: they can miss a ' +
  'problem, or flag harmless code such as a comment. A clean result does not prove that the ' +
  'code is secure.';

function rule(id: string, pattern: string, extra: Record<string, unknown> = {}) {
  return { id, severity: 'error', pattern, message: `${id} message`, fix: `${id} fix`, ...extra };
}

describe('check_code', () => {
  describe('on the demo context', () => {
    let demo: TestServer;

    beforeAll(async () => {
      demo = await startTestServer(DEMO_CONTEXT_DIR);
    });

    afterAll(async () => {
      await demo.server.close();
    });

    it('lists each violation with its rule, severity, position, explanation and fix', async () => {
      const code = ["const filters = eval('(' + rawFilters + ')');", 'console.log(filters);'].join(
        '\n',
      );

      const result = await demo.client.callTool('check_code', { code, language: 'ts' });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        language: 'ts',
        rulesChecked: 5,
        errors: 1,
        warnings: 1,
        violations: [
          {
            rule: 'no-eval',
            severity: 'error',
            line: 1,
            column: 17,
            message: 'Usage de eval() ou new Function() interdit',
            fix: 'Utiliser JSON.parse ou une logique explicite',
          },
          {
            rule: 'no-console-log',
            severity: 'warning',
            line: 2,
            column: 1,
            message: 'console.log interdit en production',
            fix: 'Back : Logger de NestJS ; front : shared/lib/logger.ts',
          },
        ],
        note: LIMITS_NOTE,
      });
      expect(textOf(result)).toBe(
        [
          'Checked against 5 rules of security/rules.json (ts code): 2 violations, 1 error and 1 warning.',
          '- Line 1, column 17 — error no-eval: Usage de eval() ou new Function() interdit',
          '  Fix: Utiliser JSON.parse ou une logique explicite',
          '- Line 2, column 1 — warning no-console-log: console.log interdit en production',
          '  Fix: Back : Logger de NestJS ; front : shared/lib/logger.ts',
          '',
          LIMITS_NOTE,
        ].join('\n'),
      );
    });

    it('answers that clean code has no violation, with the limits of the check', async () => {
      const code = 'const filters = taskFiltersSchema.parse(JSON.parse(rawFilters));';

      const result = await demo.client.callTool('check_code', { code, language: 'ts' });

      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toBe(
        `Checked against 5 rules of security/rules.json (ts code): no violation.\n\n${LIMITS_NOTE}`,
      );
      expect(result.structuredContent).toMatchObject({ errors: 0, warnings: 0, violations: [] });
    });

    it('does not quote the code back, so that a secret it holds is not copied', async () => {
      const secret = 'sk_live_51HabcdefghijKLMNOP';

      const result = await demo.client.callTool('check_code', {
        code: `const stripeApiKey = '${secret}';`,
        language: 'js',
      });

      expect(result.structuredContent).toMatchObject({
        violations: [{ rule: 'no-hardcoded-secret', line: 1, column: 7 }],
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    });

    it(`lists the first ${String(MAX_LISTED_VIOLATIONS)} violations, but counts them all`, async () => {
      const code = Array.from({ length: 150 }, (_, index) => `eval(input${String(index)});`).join(
        '\n',
      );

      const result = await demo.client.callTool('check_code', { code, language: 'js' });

      expect(result.structuredContent).toMatchObject({ errors: 150, warnings: 0 });
      expect(result.structuredContent?.violations).toHaveLength(MAX_LISTED_VIOLATIONS);
      expect(textOf(result)).toContain(
        'Only the first 100 are listed: fix them, then check the code again.',
      );
    });

    it(`refuses code longer than ${String(MAX_CODE_LENGTH)} characters`, async () => {
      const result = await demo.client.callTool('check_code', {
        code: 'x'.repeat(MAX_CODE_LENGTH + 1),
        language: 'ts',
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(
        'Code is too long (max 50000 characters): check it in smaller parts',
      );
    });

    it.each([
      ['empty code', { code: '', language: 'ts' }],
      ['an unknown language', { code: 'eval(x);', language: 'python' }],
      ['a missing language', { code: 'eval(x);' }],
    ])('refuses %s', async (_, args) => {
      const result = await demo.client.callTool('check_code', args);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Input validation error');
    });
  });

  describe('on a context with its own rules', () => {
    let root: string;
    let test: TestServer;
    const rulesPath = () => path.join(root, 'security', 'rules.json');

    beforeAll(async () => {
      root = await createFixtureDir({
        'security/rules.json': JSON.stringify([
          rule('no-var', String.raw`\bvar\s`),
          rule('no-inner-html', 'innerHTML', { severity: 'warning', languages: ['tsx', 'jsx'] }),
        ]),
      });
      test = await startTestServer(root);
    });

    afterAll(async () => {
      await test.server.close();
      await removeFixtureDir(root);
    });

    it('applies only the rules of the language of the code', async () => {
      const code = 'var html = node.innerHTML;';

      const ts = await test.client.callTool('check_code', { code, language: 'ts' });
      const tsx = await test.client.callTool('check_code', { code, language: 'tsx' });

      expect(ts.structuredContent).toMatchObject({
        rulesChecked: 1,
        violations: [{ rule: 'no-var' }],
      });
      expect(tsx.structuredContent).toMatchObject({
        rulesChecked: 2,
        violations: [{ rule: 'no-var' }, { rule: 'no-inner-html' }],
      });
    });

    it('applies an edited rules file without a restart, and reports an invalid one', async () => {
      await writeFile(rulesPath(), JSON.stringify([rule('no-let', String.raw`\blet\s`)]));
      const edited = await test.client.callTool('check_code', { code: 'let a;', language: 'ts' });

      await writeFile(rulesPath(), JSON.stringify([rule('broken', '(unclosed')]));
      const broken = await test.client.callTool('check_code', { code: 'let a;', language: 'ts' });

      expect(edited.structuredContent).toMatchObject({ violations: [{ rule: 'no-let' }] });
      expect(broken.isError).toBe(true);
      expect(textOf(broken)).toContain(
        'Invalid security/rules.json: rule "broken" has an invalid pattern',
      );
    });

    it('says that nothing was checked when no rule applies to the language', async () => {
      await writeFile(
        rulesPath(),
        JSON.stringify([rule('no-inner-html', 'innerHTML', { languages: ['tsx'] })]),
      );

      const result = await test.client.callTool('check_code', { code: 'let a;', language: 'js' });

      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toBe(
        'No rule of security/rules.json applies to js code: nothing was checked.',
      );
      expect(result.structuredContent).toMatchObject({ rulesChecked: 0, violations: [] });
    });
  });

  it('explains that no rule is configured when the context has no rules file', async () => {
    const root = await createFixtureDir({ 'project.md': '# Project' });
    const test = await startTestServer(root);

    const result = await test.client.callTool('check_code', { code: 'eval(x);', language: 'ts' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'No security rule is configured for this project: the context folder has no security/rules.json file.',
    );
    await test.server.close();
    await removeFixtureDir(root);
  });
});
