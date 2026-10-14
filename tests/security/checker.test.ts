import { describe, expect, it } from 'vitest';

import { CodeTooLongError, findViolations, MAX_CODE_LENGTH } from '../../src/security/checker.js';
import { parseRules } from '../../src/security/rules.js';

function rule(id: string, pattern: string, extra: Record<string, unknown> = {}) {
  return { id, severity: 'error', pattern, message: `${id} message`, fix: `${id} fix`, ...extra };
}

function compile(...definitions: Record<string, unknown>[]) {
  return parseRules(JSON.stringify(definitions));
}

/** Violations as `rule@line:column`, to compare positions at a glance. */
function positions(code: string, rules: ReturnType<typeof compile>): string[] {
  return findViolations(code, 'ts', rules).violations.map(
    ({ rule: id, line, column }) => `${id}@${String(line)}:${String(column)}`,
  );
}

describe('findViolations', () => {
  it('reports each violation with its rule, severity, position, message and fix', () => {
    const rules = compile(rule('no-eval', String.raw`eval\(`, { severity: 'warning' }));

    expect(findViolations('const a = 1;\nconst b = eval(x);\n', 'ts', rules)).toEqual({
      rulesChecked: 1,
      violations: [
        {
          rule: 'no-eval',
          severity: 'warning',
          line: 2,
          column: 11,
          message: 'no-eval message',
          fix: 'no-eval fix',
        },
      ],
    });
  });

  it('finds every match, several on a line too, sorted by position across the rules', () => {
    const rules = compile(rule('b', 'b'), rule('a', 'a'));

    expect(positions('ba\nab', rules)).toEqual(['b@1:1', 'a@1:2', 'a@2:1', 'b@2:2']);
  });

  it('keeps the order of the rules for violations at the same position', () => {
    const rules = compile(rule('z-listed-first', 'eval'), rule('a-listed-second', 'ev'));

    expect(positions('eval', rules)).toEqual(['z-listed-first@1:1', 'a-listed-second@1:1']);
  });

  it('reports a match that spans several lines at the line where it starts', () => {
    const rules = compile(rule('no-sql-concat', String.raw`SELECT[^;]*'\s*\+`));

    expect(positions("const a = 1;\n  const q = 'SELECT *\nFROM t ' + id;", rules)).toEqual([
      'no-sql-concat@2:14',
    ]);
  });

  it('counts a Windows (CRLF) or an old Mac (CR) line ending as one line break', () => {
    const rules = compile(rule('no-eval', String.raw`eval\(`));

    expect(positions('a\r\nb\r\n  eval(x)', rules)).toEqual(['no-eval@3:3']);
    expect(positions('a\rb\r  eval(x)', rules)).toEqual(['no-eval@3:3']);
  });

  it('handles a pattern whose matches are empty, such as a lookahead', () => {
    const rules = compile(rule('before-eval', '(?=eval)'));

    expect(positions('x = eval(y); eval(z)', rules)).toEqual([
      'before-eval@1:5',
      'before-eval@1:14',
    ]);
  });

  it('applies only the rules of the language, and counts them', () => {
    const rules = compile(
      rule('everywhere', 'x'),
      rule('jsx-only', 'x', { languages: ['tsx', 'jsx'] }),
    );

    expect(findViolations('x', 'ts', rules)).toMatchObject({
      rulesChecked: 1,
      violations: [{ rule: 'everywhere' }],
    });
    expect(findViolations('x', 'tsx', rules)).toMatchObject({
      rulesChecked: 2,
      violations: [{ rule: 'everywhere' }, { rule: 'jsx-only' }],
    });
  });

  it('returns no violation for clean code', () => {
    const rules = compile(rule('no-eval', String.raw`eval\(`));

    expect(findViolations('JSON.parse(raw);', 'js', rules)).toEqual({
      rulesChecked: 1,
      violations: [],
    });
  });

  it('gives the same answer every time with the same rules', () => {
    const rules = compile(rule('no-eval', String.raw`eval\(`));
    const first = findViolations('eval(a);\neval(b);', 'ts', rules);

    expect(findViolations('eval(a);\neval(b);', 'ts', rules)).toEqual(first);
    expect(rules[0]?.regex.lastIndex).toBe(0);
  });

  it(`accepts up to ${String(MAX_CODE_LENGTH)} characters, and refuses more`, () => {
    const rules = compile(rule('no-eval', String.raw`eval\(`));

    expect(findViolations('x'.repeat(MAX_CODE_LENGTH), 'ts', rules).violations).toEqual([]);
    expect(() => findViolations('x'.repeat(MAX_CODE_LENGTH + 1), 'ts', rules)).toThrow(
      CodeTooLongError,
    );
  });
});
