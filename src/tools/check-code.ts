import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { RULES_FILE, type ProjectContext } from '../context/project-context.js';
import { findViolations, MAX_CODE_LENGTH, type Violation } from '../security/checker.js';
import { LANGUAGES, loadRules, SEVERITIES, type Language } from '../security/rules.js';
import { countOf, joinSections } from './format.js';
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  runTool,
  type HandlerDependencies,
} from './tool-helpers.js';

export const CHECK_CODE_TOOL = 'check_code';
/** Violations listed in one answer: enough to fix the code, then check it again. */
export const MAX_LISTED_VIOLATIONS = 100;

// Sent with every answer: an agent tends to read "no violation" as "the code is secure".
const LIMITS_NOTE =
  'The rules are regular expressions matched against the code as text: they can miss a ' +
  'problem, or flag harmless code such as a comment. A clean result does not prove that the ' +
  'code is secure.';

const inputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(
      MAX_CODE_LENGTH,
      `Code is too long (max ${String(MAX_CODE_LENGTH)} characters): check it in smaller parts`,
    )
    .describe('Source code to check, from a few lines to a whole file. Read as text, never run.'),
  language: z.enum(LANGUAGES).describe('Language of the code'),
});

const outputSchema = z.object({
  language: z.enum(LANGUAGES),
  rulesChecked: z.number().int().describe(`Rules of ${RULES_FILE} that apply to this language`),
  errors: z.number().int().describe('Violations of severity "error", listed or not'),
  warnings: z.number().int().describe('Violations of severity "warning", listed or not'),
  violations: z
    .array(
      z.object({
        rule: z.string().describe(`Id of the rule in ${RULES_FILE}`),
        severity: z.enum(SEVERITIES),
        line: z.number().int().describe('Line where the problem starts, from 1'),
        column: z.number().int().describe('Column where the problem starts, from 1'),
        message: z.string().describe('What the rule forbids'),
        fix: z.string().describe('How to fix the code'),
      }),
    )
    .describe(
      `Violations by position in the code, the first ${String(MAX_LISTED_VIOLATIONS)} at most`,
    ),
  note: z.string().describe('Limits of the check, to keep in mind before concluding'),
});

type CheckOutput = z.infer<typeof outputSchema>;

export async function checkCode(
  context: ProjectContext,
  code: string,
  language: Language,
): Promise<CallToolResult> {
  const rules = await loadRules(context);
  if (rules === undefined) {
    return errorResult(
      `No security rule is configured for this project: the context folder has no ${RULES_FILE} file.`,
    );
  }

  const { rulesChecked, violations } = findViolations(code, language, rules);
  // The code is never quoted back: a hardcoded secret it holds would be copied into the answer.
  const output: CheckOutput = {
    language,
    rulesChecked,
    errors: violations.filter((violation) => violation.severity === 'error').length,
    warnings: violations.filter((violation) => violation.severity === 'warning').length,
    violations: violations.slice(0, MAX_LISTED_VIOLATIONS),
    note: LIMITS_NOTE,
  };

  return {
    content: [{ type: 'text', text: formatCheck(output) }],
    structuredContent: output,
  };
}

function formatCheck({
  language,
  rulesChecked,
  errors,
  warnings,
  violations,
  note,
}: CheckOutput): string {
  if (rulesChecked === 0) {
    return `No rule of ${RULES_FILE} applies to ${language} code: nothing was checked.`;
  }

  const checked = `Checked against ${countOf(rulesChecked, 'rule')} of ${RULES_FILE} (${language} code)`;
  const total = errors + warnings;
  if (total === 0) {
    return joinSections(`${checked}: no violation.`, note);
  }

  const summary = `${checked}: ${countOf(total, 'violation')}, ${countOf(errors, 'error')} and ${countOf(warnings, 'warning')}.`;
  const truncation =
    total > violations.length
      ? `Only the first ${String(violations.length)} are listed: fix them, then check the code again.`
      : undefined;
  return joinSections([summary, ...violations.map(formatViolation)].join('\n'), truncation, note);
}

function formatViolation({ rule, severity, line, column, message, fix }: Violation): string {
  return `- Line ${String(line)}, column ${String(column)} — ${severity} ${rule}: ${message}\n  Fix: ${fix}`;
}

export function registerCheckCodeTool(
  server: McpServer,
  { context, logger }: HandlerDependencies,
): void {
  server.registerTool(
    CHECK_CODE_TOOL,
    {
      title: 'Check code against the security rules',
      description:
        `Checks source code against the security rules of this project (${RULES_FILE} in the ` +
        'context folder) and returns every violation with its rule, severity, line, column, ' +
        'explanation and suggested fix. Call it on code you wrote or changed, before proposing ' +
        'it; fix every error, then check again. Accepts up to ' +
        `${String(MAX_CODE_LENGTH)} characters: check a longer file in parts. ` +
        'The code is read as text with regular expressions, never run: a first safety net that ' +
        'can miss a problem or flag harmless code (e.g. a comment), not a proof that the code ' +
        'is secure.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    ({ code, language }) =>
      runTool(CHECK_CODE_TOOL, logger, () => checkCode(context, code, language)),
  );
}
