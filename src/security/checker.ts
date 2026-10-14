import type { Language, SecurityRule, Severity } from './rules.js';

/** Longest code accepted: it bounds the work of the regular expressions of the rules. */
export const MAX_CODE_LENGTH = 50_000;

export class CodeTooLongError extends Error {
  override name = 'CodeTooLongError';
}

export interface Violation {
  /** Id of the rule in security/rules.json. */
  rule: string;
  severity: Severity;
  /** Line where the match starts, from 1. */
  line: number;
  /** Column where the match starts, from 1. */
  column: number;
  message: string;
  fix: string;
}

export interface CheckReport {
  /** Number of rules that apply to the language of the code. */
  rulesChecked: number;
  /** Every violation, by position in the code. */
  violations: Violation[];
}

/**
 * Matches the rules that apply to `language` against `code`, or every rule when the
 * language is unknown. The code is only read as text, never executed. A match that spans
 * several lines is reported where it starts.
 */
export function findViolations(
  code: string,
  language: Language | undefined,
  rules: readonly SecurityRule[],
): CheckReport {
  if (code.length > MAX_CODE_LENGTH) {
    throw new CodeTooLongError(
      `Code is too long (${String(code.length)} characters, max ${String(MAX_CODE_LENGTH)})`,
    );
  }
  const text = code.replace(/\r\n?/g, '\n');
  const lineStarts = findLineStarts(text);
  // Better a possible false positive than a rule skipped on code it was written for.
  const applicable =
    language === undefined
      ? rules
      : rules.filter((rule) => rule.languages?.includes(language) ?? true);

  const violations = applicable.flatMap((rule) =>
    // matchAll works on a copy of the RegExp: the lastIndex of the rule never changes.
    Array.from(text.matchAll(rule.regex), (match) => ({
      rule: rule.id,
      severity: rule.severity,
      ...locate(lineStarts, match.index),
      message: rule.message,
      fix: rule.fix,
    })),
  );
  // A stable sort: violations at the same position keep the order of the rules.
  violations.sort((a, b) => a.line - b.line || a.column - b.column);

  return { rulesChecked: applicable.length, violations };
}

/** Offset of the first character of every line. */
function findLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/** Line and column of `offset`, by a binary search among the line starts. */
function locate(lineStarts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
}
