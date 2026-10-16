import { afterAll, describe, expect, it } from 'vitest';

import { FileTooLargeError } from '../../src/context/errors.js';
import { ContextLoader, DEFAULT_MAX_FILE_SIZE_BYTES } from '../../src/context/loader.js';
import { ProjectContext } from '../../src/context/project-context.js';
import {
  InvalidRulesError,
  loadRules,
  MAX_PATTERN_LENGTH,
  MAX_RULES,
  parseRules,
} from '../../src/security/rules.js';
import { createFixtureDir, removeFixtureDir } from '../helpers/fixture-dir.js';
import { DEMO_CONTEXT_DIR } from '../helpers/mcp-client.js';

const VALID_RULE = {
  id: 'no-eval',
  severity: 'error',
  pattern: String.raw`\beval\s*\(`,
  message: 'eval() is forbidden',
  fix: 'Use JSON.parse',
};

function parse(rules: unknown) {
  return parseRules(JSON.stringify(rules));
}

describe('parseRules', () => {
  it('compiles each pattern with the global flag, in addition to the flags of the rule', () => {
    const [rule] = parse([{ ...VALID_RULE, flags: 'i' }]);

    expect(rule).toMatchObject({
      id: 'no-eval',
      severity: 'error',
      message: 'eval() is forbidden',
      fix: 'Use JSON.parse',
    });
    expect(rule?.regex.source).toBe(String.raw`\beval\s*\(`);
    expect(rule?.regex.flags).toBe('gi');
  });

  it('keeps the languages a rule is restricted to', () => {
    const [rule] = parse([{ ...VALID_RULE, languages: ['tsx', 'jsx'] }]);

    expect(rule?.languages).toEqual(['tsx', 'jsx']);
  });

  it('accepts rules restricted to PHP', () => {
    const [rule] = parse([{ ...VALID_RULE, languages: ['php'] }]);

    expect(rule?.languages).toEqual(['php']);
  });

  it('accepts a file without rules', () => {
    expect(parse([])).toEqual([]);
  });

  it('rejects a text that is not JSON', () => {
    expect(() => parseRules('[{ "id": ')).toThrow(InvalidRulesError);
    expect(() => parseRules('[{ "id": ')).toThrow('security/rules.json is not valid JSON');
  });

  it.each([
    ['an object instead of a list', { rules: [VALID_RULE] }, 'expected array'],
    ['a missing fix', [{ ...VALID_RULE, fix: undefined }], 'at [0].fix'],
    ['a blank message', [{ ...VALID_RULE, message: '   ' }], 'at [0].message'],
    ['a misspelled key', [{ ...VALID_RULE, flag: 'i' }], 'Unrecognized key: "flag"'],
    ['an unknown severity', [{ ...VALID_RULE, severity: 'critical' }], 'at [0].severity'],
    ['an id with spaces', [{ ...VALID_RULE, id: 'no eval' }], 'Expected letters, digits'],
    ['the global flag', [{ ...VALID_RULE, flags: 'g' }], 'Only the flags i, m, s and u'],
    ['the sticky flag', [{ ...VALID_RULE, flags: 'iy' }], 'Only the flags i, m, s and u'],
    ['an empty pattern', [{ ...VALID_RULE, pattern: '' }], 'at [0].pattern'],
    [
      'a pattern too long',
      [{ ...VALID_RULE, pattern: 'a'.repeat(MAX_PATTERN_LENGTH + 1) }],
      'at [0].pattern',
    ],
    ['an unknown language', [{ ...VALID_RULE, languages: ['py'] }], 'at [0].languages[0]'],
    ['an empty list of languages', [{ ...VALID_RULE, languages: [] }], 'at [0].languages'],
    [
      'too many rules',
      Array.from({ length: MAX_RULES + 1 }, (_, index) => ({
        ...VALID_RULE,
        id: `r${String(index)}`,
      })),
      `<=${String(MAX_RULES)}`,
    ],
  ])('rejects %s', (_, rules, reason) => {
    expect(() => parse(rules)).toThrow(InvalidRulesError);
    expect(() => parse(rules)).toThrow(reason);
  });

  it('names the rule whose pattern does not compile, with the flags as written', () => {
    const rules = [{ ...VALID_RULE, id: 'no-sql-concat', pattern: '(SELECT', flags: 'i' }];

    expect(() => parse(rules)).toThrow(InvalidRulesError);
    expect(() => parse(rules)).toThrow(
      'Invalid security/rules.json: rule "no-sql-concat" has an invalid pattern: ' +
        'Invalid regular expression: /(SELECT/i: Unterminated group',
    );
  });

  it('rejects flags that JavaScript refuses, such as a repeated one', () => {
    expect(() => parse([{ ...VALID_RULE, flags: 'ii' }])).toThrow('has an invalid pattern');
  });

  it('rejects a pattern that matches an empty text, which would flag every position', () => {
    expect(() => parse([{ ...VALID_RULE, pattern: 'eval|' }])).toThrow(
      'rule "no-eval" has a pattern that matches an empty text',
    );
  });

  it('rejects two rules with the same id', () => {
    expect(() => parse([VALID_RULE, { ...VALID_RULE, severity: 'warning' }])).toThrow(
      'Invalid security/rules.json: two rules have the id "no-eval"',
    );
  });
});

describe('loadRules', () => {
  it('loads the rules of the demo context', async () => {
    const rules = await loadRules(
      new ProjectContext(new ContextLoader({ rootDir: DEMO_CONTEXT_DIR })),
    );

    expect(rules?.map((rule) => rule.id)).toEqual([
      'no-eval',
      'no-hardcoded-secret',
      'no-sql-concat',
      'no-console-log',
      'no-dangerously-set-html',
    ]);
  });

  describe('on fixtures', () => {
    const roots: string[] = [];

    afterAll(async () => {
      await Promise.all(roots.map(removeFixtureDir));
    });

    async function contextWith(files: Record<string, string>): Promise<ProjectContext> {
      const root = await createFixtureDir(files);
      roots.push(root);
      return new ProjectContext(new ContextLoader({ rootDir: root }));
    }

    it('returns undefined when the context folder has no rules file', async () => {
      await expect(loadRules(await contextWith({ 'project.md': '# P' }))).resolves.toBeUndefined();
    });

    it('reads a file saved by a Windows editor (byte order mark, CRLF)', async () => {
      const text = `${String.fromCodePoint(0xfeff)}[\r\n${JSON.stringify(VALID_RULE)}\r\n]\r\n`;
      const rules = await loadRules(await contextWith({ 'security/rules.json': text }));

      expect(rules?.map((rule) => rule.id)).toEqual(['no-eval']);
    });

    it('fails on an invalid file instead of ignoring it', async () => {
      const context = await contextWith({ 'security/rules.json': '[{}]' });

      await expect(loadRules(context)).rejects.toThrow(InvalidRulesError);
    });

    it('fails on a file it cannot read, instead of taking it for a missing one', async () => {
      const tooLarge = `[${' '.repeat(DEFAULT_MAX_FILE_SIZE_BYTES)}]`;
      const context = await contextWith({ 'security/rules.json': tooLarge });

      await expect(loadRules(context)).rejects.toThrow(FileTooLargeError);
    });
  });
});
