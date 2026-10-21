import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { RULES_FILE, type ProjectContext } from '../context/project-context.js';
import { findViolations, MAX_CODE_LENGTH, type Violation } from '../security/checker.js';
import {
  CODE_EXTENSIONS,
  MAX_PATHS,
  MAX_PROJECT_PATH_LENGTH,
  ProjectFileError,
  readProjectFile,
  type ProjectFile,
} from '../security/project-files.js';
import {
  LANGUAGES,
  loadRules,
  SEVERITIES,
  type Language,
  type SecurityRule,
} from '../security/rules.js';
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

const NO_RULES_MESSAGE = `No security rule is configured for this project: the context folder has no ${RULES_FILE} file.`;

const inputSchema = z.object({
  paths: z
    .array(z.string().min(1).max(MAX_PROJECT_PATH_LENGTH))
    .min(1)
    .max(MAX_PATHS)
    .optional()
    .describe(
      'Files to check, relative to the project folder, with "/" separators (e.g. ' +
        `"src/app/page.tsx"), up to ${String(MAX_PATHS)}. The server reads them: their code ` +
        'does not need to be copied. The language comes from the extension.',
    ),
  code: z
    .string()
    .min(1)
    .max(
      MAX_CODE_LENGTH,
      `Code is too long (max ${String(MAX_CODE_LENGTH)} characters): check it in smaller parts`,
    )
    .optional()
    .describe(
      'Source code to check, with its language, instead of paths: for code that is not in a ' +
        'file of the project yet. Read as text, never run.',
    ),
  language: z
    .enum(LANGUAGES)
    .optional()
    .describe(
      'Language of the code given in code; php for PHP files and Blade templates (.blade.php)',
    ),
});

const violationSchema = z.object({
  rule: z.string().describe(`Id of the rule in ${RULES_FILE}`),
  severity: z.enum(SEVERITIES),
  line: z.number().int().describe('Line where the problem starts, from 1'),
  column: z.number().int().describe('Column where the problem starts, from 1'),
  message: z.string().describe('What the rule forbids'),
  fix: z.string().describe('How to fix the code'),
});

const fileResultSchema = z.object({
  path: z.string().describe('The path as it was given'),
  language: z
    .enum(LANGUAGES)
    .optional()
    .describe('Language deduced from the extension; absent when the file was not checked'),
  rulesChecked: z
    .number()
    .int()
    .optional()
    .describe(`Rules of ${RULES_FILE} that apply to this language`),
  errors: z.number().int().describe('Violations of severity "error" in this file'),
  warnings: z.number().int().describe('Violations of severity "warning" in this file'),
  violations: z.array(violationSchema).describe('Listed violations of this file, by position'),
  problem: z
    .string()
    .optional()
    .describe('Why the file was not checked: path refused, not found, not code or too long'),
});

const outputSchema = z.object({
  language: z.enum(LANGUAGES).optional().describe('With code: its language'),
  rulesChecked: z
    .number()
    .int()
    .optional()
    .describe(`With code: rules of ${RULES_FILE} that apply to its language`),
  errors: z.number().int().describe('Violations of severity "error", listed or not'),
  warnings: z.number().int().describe('Violations of severity "warning", listed or not'),
  violations: z
    .array(violationSchema)
    .optional()
    .describe(
      `With code: violations by position, the first ${String(MAX_LISTED_VIOLATIONS)} at most`,
    ),
  files: z
    .array(fileResultSchema)
    .optional()
    .describe(
      'With paths: one result per file, in the order given; the first ' +
        `${String(MAX_LISTED_VIOLATIONS)} violations at most are listed, all files together`,
    ),
  note: z.string().describe('Limits of the check, to keep in mind before concluding'),
});

type CheckOutput = z.infer<typeof outputSchema>;
type FileResult = z.infer<typeof fileResultSchema>;

export async function checkCode(
  context: ProjectContext,
  code: string,
  language: Language,
): Promise<CallToolResult> {
  const rules = await loadRules(context);
  if (rules === undefined) return errorResult(NO_RULES_MESSAGE);

  const { rulesChecked, violations } = findViolations(code, language, rules);
  // The code is never quoted back: a hardcoded secret it holds would be copied into the answer.
  const output: CheckOutput = {
    language,
    rulesChecked,
    ...countBySeverity(violations),
    violations: violations.slice(0, MAX_LISTED_VIOLATIONS),
    note: LIMITS_NOTE,
  };

  return {
    content: [{ type: 'text', text: formatCheck(output) }],
    structuredContent: output,
  };
}

/**
 * Checks files of the project, read from `projectDir`. A file that cannot be checked (path
 * refused, not found, not code, too long) is reported in its own result: the others are
 * checked all the same.
 */
export async function checkFiles(
  context: ProjectContext,
  projectDir: string,
  paths: readonly string[],
): Promise<CallToolResult> {
  const rules = await loadRules(context);
  if (rules === undefined) return errorResult(NO_RULES_MESSAGE);

  const unique = [...new Set(paths)];
  const outcomes = await Promise.all(unique.map((path) => readOrProblem(projectDir, path)));

  let listed = 0;
  const files = outcomes.map((outcome): FileResult => {
    if ('problem' in outcome) {
      return {
        path: outcome.path,
        errors: 0,
        warnings: 0,
        violations: [],
        problem: outcome.problem,
      };
    }
    const result = checkFile(outcome, rules, MAX_LISTED_VIOLATIONS - listed);
    listed += result.violations.length;
    return result;
  });

  const output: CheckOutput = {
    errors: sum(files, 'errors'),
    warnings: sum(files, 'warnings'),
    files,
    note: LIMITS_NOTE,
  };
  return {
    content: [{ type: 'text', text: formatFiles(output, files) }],
    structuredContent: output,
  };
}

/** A file read, or why it could not be. */
type ReadOutcome = ProjectFile | { path: string; problem: string };

async function readOrProblem(projectDir: string, path: string): Promise<ReadOutcome> {
  try {
    return await readProjectFile(projectDir, path);
  } catch (error) {
    if (error instanceof ProjectFileError) return { path, problem: error.message };
    throw error;
  }
}

function checkFile(file: ProjectFile, rules: readonly SecurityRule[], room: number): FileResult {
  const { rulesChecked, violations } = findViolations(file.code, file.language, rules);
  return {
    path: file.path,
    language: file.language,
    rulesChecked,
    ...countBySeverity(violations),
    violations: violations.slice(0, Math.max(0, room)),
  };
}

function countBySeverity(violations: readonly Violation[]): { errors: number; warnings: number } {
  return {
    errors: violations.filter((violation) => violation.severity === 'error').length,
    warnings: violations.filter((violation) => violation.severity === 'warning').length,
  };
}

function sum(files: readonly FileResult[], key: 'errors' | 'warnings'): number {
  return files.reduce((total, file) => total + file[key], 0);
}

function formatCheck({
  language,
  rulesChecked = 0,
  errors,
  warnings,
  violations = [],
  note,
}: CheckOutput): string {
  if (rulesChecked === 0) {
    return `No rule of ${RULES_FILE} applies to ${String(language)} code: nothing was checked.`;
  }

  const checked = `Checked against ${countOf(rulesChecked, 'rule')} of ${RULES_FILE} (${String(language)} code)`;
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

function formatFiles(
  { errors, warnings, note }: CheckOutput,
  files: readonly FileResult[],
): string {
  const notChecked = files.filter((file) => file.problem !== undefined).length;
  const total = errors + warnings;
  const found =
    total === 0
      ? 'no violation'
      : `${countOf(total, 'violation')}, ${countOf(errors, 'error')} and ${countOf(warnings, 'warning')}`;
  const summary =
    `Checked ${countOf(files.length - notChecked, 'file')} against ${RULES_FILE}: ${found}.` +
    (notChecked > 0 ? ` ${countOf(notChecked, 'file')} could not be checked.` : '');

  const listed = files.reduce((count, file) => count + file.violations.length, 0);
  const truncation =
    total > listed
      ? `Only the first ${String(listed)} violations are listed: fix them, then check the files again.`
      : undefined;
  return joinSections(summary, files.map(formatFileResult).join('\n'), truncation, note);
}

function formatFileResult({
  path,
  language,
  rulesChecked = 0,
  errors,
  warnings,
  violations,
  problem,
}: FileResult): string {
  if (problem !== undefined) return `${path}: not checked. ${problem}`;
  if (rulesChecked === 0) {
    return `${path}: no rule of ${RULES_FILE} applies to ${String(language)} code, nothing was checked.`;
  }

  const total = errors + warnings;
  const head = `${path} (${String(language)} code, ${countOf(rulesChecked, 'rule')})`;
  if (total === 0) return `${head}: no violation.`;
  return [
    `${head}: ${countOf(total, 'violation')}, ${countOf(errors, 'error')} and ${countOf(warnings, 'warning')}.`,
    ...violations.map(formatViolation),
  ].join('\n');
}

function formatViolation({ rule, severity, line, column, message, fix }: Violation): string {
  return `- Line ${String(line)}, column ${String(column)} — ${severity} ${rule}: ${message}\n  Fix: ${fix}`;
}

/** What check_code needs on top of the other tools: the folder that paths start from. */
export interface CheckCodeDependencies extends HandlerDependencies {
  projectDir: string;
}

export function registerCheckCodeTool(
  server: McpServer,
  { context, logger, projectDir }: CheckCodeDependencies,
): void {
  server.registerTool(
    CHECK_CODE_TOOL,
    {
      title: 'Check code against the security rules',
      description:
        `Checks source code against the security rules of this project (${RULES_FILE} in the ` +
        'context folder) and returns every violation with its rule, severity, line, column, ' +
        'explanation and suggested fix. Call it on the files you wrote or changed, before ' +
        `proposing them: give their paths, up to ${String(MAX_PATHS)} in one call ` +
        `(${CODE_EXTENSIONS.join(', ')}), or give the code itself with its language. Fix every ` +
        `error, then check again. A file or code accepts up to ${String(MAX_CODE_LENGTH)} ` +
        'characters. The code is read as text with regular expressions, never run: a first ' +
        'safety net that can miss a problem or flag harmless code (e.g. a comment), not a ' +
        'proof that the code is secure.',
      inputSchema,
      outputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    ({ paths, code, language }) =>
      runTool(CHECK_CODE_TOOL, logger, () => {
        if (paths !== undefined) {
          if (code !== undefined || language !== undefined) {
            return Promise.resolve(
              errorResult(
                'Give either paths, or code with its language, not both: with paths, the ' +
                  'language comes from the extension of each file.',
              ),
            );
          }
          return checkFiles(context, projectDir, paths);
        }
        if (code === undefined || language === undefined) {
          return Promise.resolve(
            errorResult(
              'Give the paths of the files to check, relative to the project folder, or the ' +
                'code itself with its language.',
            ),
          );
        }
        return checkCode(context, code, language);
      }),
  );
}
