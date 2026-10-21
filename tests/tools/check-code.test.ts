import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_CODE_LENGTH } from '../../src/security/checker.js';
import { MAX_PATHS } from '../../src/security/project-files.js';
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
      ['an empty list of paths', { paths: [] }],
      [
        `more than ${String(MAX_PATHS)} paths`,
        { paths: Array.from({ length: MAX_PATHS + 1 }, (_, index) => `f${String(index)}.ts`) },
      ],
    ])('refuses %s', async (_, args) => {
      const result = await demo.client.callTool('check_code', args);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Input validation error');
    });

    it.each([
      ['nothing to check', {}],
      ['code without its language', { code: 'eval(x);' }],
      ['a language without code', { language: 'ts' }],
    ])('asks for paths, or code with its language, when given %s', async (_, args) => {
      const result = await demo.client.callTool('check_code', args);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'Give the paths of the files to check, relative to the project folder, or the code ' +
          'itself with its language.',
      );
    });

    it.each([
      ['paths and code', { paths: ['a.ts'], code: 'eval(x);', language: 'ts' }],
      ['paths and a language', { paths: ['a.ts'], language: 'ts' }],
    ])('refuses %s together', async (_, args) => {
      const result = await demo.client.callTool('check_code', args);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'Give either paths, or code with its language, not both: with paths, the language ' +
          'comes from the extension of each file.',
      );
    });
  });

  describe('with paths, on the demo', () => {
    let demo: TestServer;

    beforeAll(async () => {
      // The demo context lies in examples/, next to the file the README checks.
      demo = await startTestServer(DEMO_CONTEXT_DIR, undefined, path.dirname(DEMO_CONTEXT_DIR));
    });

    afterAll(async () => {
      await demo.server.close();
    });

    it('reads the file itself and finds the same violations as with its code', async () => {
      const code = await readFile(
        path.join(path.dirname(DEMO_CONTEXT_DIR), 'demo', 'search-tasks.service.ts'),
        'utf8',
      );

      const byPath = await demo.client.callTool('check_code', {
        paths: ['demo/search-tasks.service.ts'],
      });
      const byCode = await demo.client.callTool('check_code', { code, language: 'ts' });

      expect(byPath.isError).toBeUndefined();
      const { language, rulesChecked, errors, warnings, violations } =
        byCode.structuredContent as Record<string, unknown>;
      expect(byPath.structuredContent).toEqual({
        errors,
        warnings,
        files: [
          {
            path: 'demo/search-tasks.service.ts',
            language,
            rulesChecked,
            errors,
            warnings,
            violations,
          },
        ],
        note: LIMITS_NOTE,
      });
      expect(errors).toBeGreaterThan(0);
    });
  });

  describe('with paths, on a project of its own', () => {
    let project: string;
    let test: TestServer;

    beforeAll(async () => {
      project = await createFixtureDir({
        'docs/context/security/rules.json': JSON.stringify([
          rule('no-eval', String.raw`\beval\(`),
          rule('no-inner-html', 'innerHTML', { severity: 'warning', languages: ['tsx'] }),
        ]),
        'src/api.ts': 'export const run = (x: string) => eval(x);',
        'src/View.tsx': 'node.innerHTML = html;\neval(script);',
        'src/clean.js': 'export const one = 1;',
        'src/secret.ts': 'const key = "sk_live_do_not_copy"; eval(key);',
        'src/many-a.ts': 'eval(x);\n'.repeat(60),
        'src/many-b.ts': 'eval(y);\n'.repeat(60),
        'notes.md': '# Notes',
      });
      test = await startTestServer(path.join(project, 'docs', 'context'), undefined, project);
    });

    afterAll(async () => {
      await test.server.close();
      await removeFixtureDir(project);
    });

    it('checks every file in one call, in the order given, and reports those it cannot check', async () => {
      const result = await test.client.callTool('check_code', {
        paths: ['src/View.tsx', 'notes.md', 'src/api.ts', '../outside.ts', 'src/clean.js'],
      });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        errors: 2,
        warnings: 1,
        files: [
          {
            path: 'src/View.tsx',
            language: 'tsx',
            rulesChecked: 2,
            errors: 1,
            warnings: 1,
            violations: [
              {
                rule: 'no-inner-html',
                severity: 'warning',
                line: 1,
                column: 6,
                message: 'no-inner-html message',
                fix: 'no-inner-html fix',
              },
              {
                rule: 'no-eval',
                severity: 'error',
                line: 2,
                column: 1,
                message: 'no-eval message',
                fix: 'no-eval fix',
              },
            ],
          },
          {
            path: 'notes.md',
            errors: 0,
            warnings: 0,
            violations: [],
            problem:
              'Unsupported file type: notes.md (check_code reads .ts, .mts, .cts, .tsx, .js, ' +
              '.mjs, .cjs, .jsx, .php files)',
          },
          {
            path: 'src/api.ts',
            language: 'ts',
            rulesChecked: 1,
            errors: 1,
            warnings: 0,
            violations: [
              {
                rule: 'no-eval',
                severity: 'error',
                line: 1,
                column: 35,
                message: 'no-eval message',
                fix: 'no-eval fix',
              },
            ],
          },
          {
            path: '../outside.ts',
            errors: 0,
            warnings: 0,
            violations: [],
            problem:
              'Invalid path "../outside.ts": expected a path relative to the project folder, ' +
              'with "/" separators, without "." or ".." segments',
          },
          {
            path: 'src/clean.js',
            language: 'js',
            rulesChecked: 1,
            errors: 0,
            warnings: 0,
            violations: [],
          },
        ],
        note: LIMITS_NOTE,
      });
      expect(textOf(result)).toBe(
        [
          'Checked 3 files against security/rules.json: 3 violations, 2 errors and 1 warning. 2 files could not be checked.',
          '',
          [
            'src/View.tsx (tsx code, 2 rules): 2 violations, 1 error and 1 warning.',
            '- Line 1, column 6 — warning no-inner-html: no-inner-html message',
            '  Fix: no-inner-html fix',
            '- Line 2, column 1 — error no-eval: no-eval message',
            '  Fix: no-eval fix',
            'notes.md: not checked. Unsupported file type: notes.md (check_code reads .ts, .mts, .cts, .tsx, .js, .mjs, .cjs, .jsx, .php files)',
            'src/api.ts (ts code, 1 rule): 1 violation, 1 error and 0 warnings.',
            '- Line 1, column 35 — error no-eval: no-eval message',
            '  Fix: no-eval fix',
            '../outside.ts: not checked. Invalid path "../outside.ts": expected a path relative to the project folder, with "/" separators, without "." or ".." segments',
            'src/clean.js (js code, 1 rule): no violation.',
          ].join('\n'),
          '',
          LIMITS_NOTE,
        ].join('\n'),
      );
    });

    it('checks a file given twice only once', async () => {
      const result = await test.client.callTool('check_code', {
        paths: ['src/api.ts', 'src/api.ts'],
      });

      expect(result.structuredContent).toMatchObject({
        errors: 1,
        files: [{ path: 'src/api.ts', errors: 1 }],
      });
    });

    it(`lists the first ${String(MAX_LISTED_VIOLATIONS)} violations of all files, but counts them all`, async () => {
      const result = await test.client.callTool('check_code', {
        paths: ['src/many-a.ts', 'src/many-b.ts'],
      });

      const { errors, files } = result.structuredContent as {
        errors: number;
        files: { errors: number; violations: unknown[] }[];
      };
      expect(errors).toBe(120);
      expect(files.map((file) => [file.errors, file.violations.length])).toEqual([
        [60, 60],
        [60, MAX_LISTED_VIOLATIONS - 60],
      ]);
      expect(textOf(result)).toContain(
        `Only the first ${String(MAX_LISTED_VIOLATIONS)} violations are listed: fix them, then check the files again.`,
      );
    });

    it('does not quote the code of a file back, so that a secret it holds is not copied', async () => {
      const result = await test.client.callTool('check_code', { paths: ['src/secret.ts'] });

      expect(result.structuredContent).toMatchObject({ errors: 1 });
      expect(JSON.stringify(result)).not.toContain('sk_live_do_not_copy');
    });

    it('says that nothing was checked in a file when no rule applies to its language', async () => {
      await writeFile(
        path.join(project, 'docs', 'context', 'security', 'rules.json'),
        JSON.stringify([rule('no-inner-html', 'innerHTML', { languages: ['tsx'] })]),
      );

      const result = await test.client.callTool('check_code', { paths: ['src/clean.js'] });

      expect(textOf(result)).toContain(
        'src/clean.js: no rule of security/rules.json applies to js code, nothing was checked.',
      );
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
          rule('no-unescaped-blade', String.raw`\{!!`, { languages: ['php'] }),
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

    it('checks PHP, Blade templates included, with its own rules and the general ones', async () => {
      const code = '<p>{!! $user->bio !!}</p>\n<?php var $legacy; ?>';

      const result = await test.client.callTool('check_code', { code, language: 'php' });

      expect(result.structuredContent).toMatchObject({
        language: 'php',
        rulesChecked: 2,
        violations: [
          { rule: 'no-unescaped-blade', line: 1 },
          { rule: 'no-var', line: 2 },
        ],
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
