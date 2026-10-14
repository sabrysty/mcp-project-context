import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { ContextLoader } from '../../src/context/loader.js';
import { ProjectContext } from '../../src/context/project-context.js';
import { findViolations } from '../../src/security/checker.js';
import {
  LANGUAGES,
  loadRules,
  type Language,
  type SecurityRule,
} from '../../src/security/rules.js';
import { DEMO_CONTEXT_DIR } from '../helpers/mcp-client.js';

const DEMO_FILE = fileURLToPath(
  new URL('../../examples/demo/search-tasks.service.ts', import.meta.url),
);

// The rules shipped with the demo context, on code an agent could write. Cases marked
// "missed before" or "flagged before" are the defects found in the rules of the
// specification (PROJECT_CONTEXT.md §5.3), which the demo copied at first.
describe('demo security rules', () => {
  const loader = new ContextLoader({ rootDir: DEMO_CONTEXT_DIR });
  let rules: SecurityRule[];

  beforeAll(async () => {
    rules = (await loadRules(new ProjectContext(loader))) ?? [];
  });

  function rulesBrokenBy(code: string, language: Language = 'ts'): string[] {
    const { violations } = findViolations(code, language, rules);
    return [...new Set(violations.map((violation) => violation.rule))];
  }

  describe('no-eval', () => {
    it.each([
      "const filters = eval('(' + rawFilters + ')');",
      'window.eval(script);',
      // Missed before: the guidelines name new Function() along with eval().
      "const run = new Function('a', 'b', body);",
    ])('flags %j', (code) => {
      expect(rulesBrokenBy(code)).toEqual(['no-eval']);
    });

    it.each([
      'const filters = taskFiltersSchema.parse(JSON.parse(rawFilters));',
      'const result = evaluate(expression);',
      'const medieval = getMedieval(period);',
    ])('accepts %j', (code) => {
      expect(rulesBrokenBy(code)).toEqual([]);
    });
  });

  describe('no-hardcoded-secret', () => {
    it.each([
      "const jwtSecret = 'super-secret-value-123';",
      "function connect(password = 'admin1234!') {}",
      // Missed before: a type annotation, or a name that goes on after the keyword.
      "private readonly apiKey: string = 'sk_live_51Habcdefgh';",
      "const secretKey = 'f3a9c2d4e5b6';",
      "const SECRET_KEY = 'f3a9c2d4e5b6';",
      // Missed before: a quoted key, a template literal, a private key.
      "const headers = { 'x-api-key': 'abcdef123456' };",
      'const config = { "apiKey": "abcdef123456" };',
      'const accessToken = `eyJhbGciOiJIUzI1NiJ9`;',
      "const privateKey = 'MIIEvQIBADANBgkqhkiG';",
    ])('flags %j', (code) => {
      expect(rulesBrokenBy(code)).toEqual(['no-hardcoded-secret']);
    });

    it.each([
      "const jwtSecret = this.config.get('JWT_ACCESS_SECRET', { infer: true });",
      "const token = 'abc123';",
      'const authorization = `Bearer ${token}`;',
      "const passwordLabel = 'Mot de passe oublié ?';",
      // Flagged before: a label is text with spaces, a secret has none.
      "const messages = { forgotPassword: 'Mot de passe oublié ?' };",
      "const tokenExpiresIn = '15minutes';",
      "const secretName = 'taskflow/prod/database';",
    ])('accepts %j', (code) => {
      expect(rulesBrokenBy(code)).toEqual([]);
    });
  });

  describe('no-sql-concat', () => {
    it.each([
      `await this.dataSource.query("SELECT * FROM tasks WHERE id = '" + taskId + "'");`,
      "const sql = 'SELECT id, title FROM tasks WHERE owner_id = ' + ownerId;",
      "const sql = 'select * from tasks where id = ' + id;",
      "const sql =\n  'SELECT * FROM tasks ' +\n  'WHERE id = ' + id;",
      "db.query('DELETE FROM tasks WHERE id = ' + id);",
      `db.query("UPDATE tasks SET title = '" + title + "'");`,
      `db.query("INSERT INTO tasks (title) VALUES ('" + title + "')");`,
      // Missed before: values interpolated in a template literal.
      'await this.dataSource.query(`SELECT * FROM tasks WHERE id = ${taskId}`);',
      'const rows = await db.query(`\n  SELECT *\n  FROM tasks\n  WHERE id = ${taskId}\n`);',
      'db.query(`DELETE FROM tasks WHERE id = ${id}`);',
    ])('flags %j', (code) => {
      expect(rulesBrokenBy(code)).toEqual(['no-sql-concat']);
    });

    it.each([
      "await this.dataSource.query('SELECT * FROM tasks WHERE id = $1', [taskId]);",
      "const sql = 'SELECT * FROM tasks ' + 'WHERE id = $1';",
      ".andWhere('task.title ILIKE :search', { search: `%${escapeLike(q)}%` })",
      // Flagged before: "update", "delete" or "selected" in a message are not SQL.
      "this.logger.log('Task updated: ' + taskId);",
      "throw new Error('Failed to update task ' + taskId);",
      "const message = 'Cannot delete ' + name;",
      "toast('3 tasks selected: ' + names.join(', '));",
      'this.logger.log(`Task ${taskId} updated by ${userId}`);',
      // A tagged template sends the values as parameters (Prisma, postgres.js…).
      'const rows = await prisma.$queryRaw`SELECT * FROM tasks WHERE id = ${id}`;',
    ])('accepts %j', (code) => {
      expect(rulesBrokenBy(code)).toEqual([]);
    });
  });

  describe('no-console-log and no-dangerously-set-html', () => {
    it('flags console.log, but not a logger', () => {
      expect(rulesBrokenBy('console.log(task);')).toEqual(['no-console-log']);
      expect(rulesBrokenBy('this.logger.log(`Task ${taskId} archived`);')).toEqual([]);
    });

    it('flags dangerouslySetInnerHTML, but not rendered Markdown', () => {
      expect(
        rulesBrokenBy('<div dangerouslySetInnerHTML={{ __html: task.description }} />', 'tsx'),
      ).toEqual(['no-dangerously-set-html']);
      expect(rulesBrokenBy('<Markdown>{task.description}</Markdown>', 'tsx')).toEqual([]);
    });
  });

  // The README shows this result: the test keeps it true.
  it('finds the violations the README shows in the demo file, and misses the same line', async () => {
    const code = await readFile(DEMO_FILE, 'utf8');

    const { violations } = findViolations(code, 'ts', rules);

    expect(violations.map(({ rule, line, column }) => ({ rule, line, column }))).toEqual([
      { rule: 'no-hardcoded-secret', line: 6, column: 7 },
      { rule: 'no-console-log', line: 18, column: 5 },
      // Line 21 goes on concatenating the query, but holds no SQL keyword: a regex limit.
      { rule: 'no-sql-concat', line: 20, column: 17 },
    ]);
  });

  describe('on the code examples of the demo documentation', () => {
    let flagged: { source: string; rule: string; marker: string | undefined }[];

    beforeAll(async () => {
      const { documents } = await loader.listDocuments();
      flagged = documents.flatMap((document) =>
        codeBlocksOf(document.content).flatMap(({ language, code }) =>
          findViolations(code, language, rules).violations.map((violation) => ({
            source: document.path,
            rule: violation.rule,
            marker: markerAt(code, violation.line),
          })),
        ),
      );
    });

    it('never flags a ✅ example', () => {
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged.filter((hit) => hit.marker !== '❌')).toEqual([]);
    });

    it('flags the ❌ example of each rule the security guidelines illustrate', () => {
      const rulesFlagged = flagged
        .filter((hit) => hit.source === 'security/guidelines.md')
        .map((hit) => hit.rule);

      expect(new Set(rulesFlagged)).toEqual(
        new Set(['no-eval', 'no-hardcoded-secret', 'no-sql-concat', 'no-dangerously-set-html']),
      );
    });
  });
});

/** The fenced code blocks of a Markdown text written in a language check_code accepts. */
function codeBlocksOf(markdown: string): { language: Language; code: string }[] {
  return Array.from(markdown.matchAll(/^```(\w+)\n([\s\S]*?)^```/gm)).flatMap((match) => {
    const language = LANGUAGES.find((candidate) => candidate === match[1]);
    return language ? [{ language, code: match[2] ?? '' }] : [];
  });
}

/** The ✅ or ❌ marker of the example that `line` of a code block belongs to. */
function markerAt(code: string, line: number): string | undefined {
  const linesUpToHere = code.split('\n').slice(0, line).reverse();
  return linesUpToHere.map((text) => /[✅❌]/u.exec(text)?.[0]).find(Boolean);
}
