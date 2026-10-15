import * as z from 'zod/v4';

import { ContextError, ContextNotFoundError } from '../context/errors.js';
import { RULES_FILE, type ProjectContext } from '../context/project-context.js';

/**
 * Languages check_code accepts. A rule can be restricted to some of them. `php` covers Blade
 * templates too: they are PHP files, and a rule on Blade syntax only matches templates anyway.
 */
export const LANGUAGES = ['ts', 'js', 'tsx', 'jsx', 'php'] as const;
export type Language = (typeof LANGUAGES)[number];

export const SEVERITIES = ['error', 'warning'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const MAX_RULES = 200;
export const MAX_PATTERN_LENGTH = 1000;

/** security/rules.json holds an invalid rule, or a pattern that does not compile. */
export class InvalidRulesError extends ContextError {
  override name = 'InvalidRulesError';
}

/** A rule of security/rules.json, with its pattern compiled. */
export interface SecurityRule {
  id: string;
  severity: Severity;
  /** Compiled with the `g` flag, so that every match is found. */
  regex: RegExp;
  message: string;
  fix: string;
  /** Languages the rule applies to; all of them when absent. */
  languages?: Language[];
}

// Strict: a misspelled key such as "flag" would otherwise be ignored without a word, and
// the rule would silently miss what it was written for.
const ruleSchema = z.strictObject({
  id: z
    .string()
    .max(100)
    .regex(/^[\w.-]+$/, 'Expected letters, digits, "-", "_" or "." (e.g. "no-eval")'),
  severity: z.enum(SEVERITIES),
  pattern: z.string().min(1).max(MAX_PATTERN_LENGTH),
  // "g" and "y" make a RegExp remember where it stopped; the engine adds "g" itself.
  flags: z
    .string()
    .regex(/^[imsu]*$/, 'Only the flags i, m, s and u are allowed')
    .optional(),
  message: z.string().trim().min(1).max(500),
  fix: z.string().trim().min(1).max(500),
  languages: z.array(z.enum(LANGUAGES)).min(1).optional(),
});

type RuleDefinition = z.infer<typeof ruleSchema>;

const rulesFileSchema = z.array(ruleSchema).max(MAX_RULES);

/**
 * Loads the security rules of the context folder, or returns undefined when it has none.
 * Like the documents, the file is read on every call: an edited rule applies at once.
 */
export async function loadRules(context: ProjectContext): Promise<SecurityRule[] | undefined> {
  let text: string;
  try {
    text = await context.readRules();
  } catch (error) {
    if (error instanceof ContextNotFoundError) return undefined;
    throw error;
  }
  return parseRules(text);
}

/** Validates the text of security/rules.json and compiles the pattern of every rule. */
export function parseRules(text: string): SecurityRule[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InvalidRulesError(`${RULES_FILE} is not valid JSON: ${reason}`);
  }

  const result = rulesFileSchema.safeParse(json);
  if (!result.success) {
    throw new InvalidRulesError(`Invalid ${RULES_FILE}: ${z.prettifyError(result.error)}`);
  }
  assertUniqueIds(result.data);
  return result.data.map(compileRule);
}

function assertUniqueIds(rules: readonly RuleDefinition[]): void {
  const ids = new Set<string>();
  for (const { id } of rules) {
    if (ids.has(id)) {
      throw new InvalidRulesError(
        `Invalid ${RULES_FILE}: two rules have the id ${JSON.stringify(id)}`,
      );
    }
    ids.add(id);
  }
}

function compileRule({ pattern, flags = '', ...rule }: RuleDefinition): SecurityRule {
  const invalidRule = `Invalid ${RULES_FILE}: rule ${JSON.stringify(rule.id)}`;

  // Compiled as written first, so that an error message shows the flags of the rule.
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InvalidRulesError(`${invalidRule} has an invalid pattern: ${reason}`);
  }
  // Such a pattern would report a violation at every position of the code.
  if (regex.test('')) {
    throw new InvalidRulesError(`${invalidRule} has a pattern that matches an empty text`);
  }
  return { ...rule, regex: new RegExp(regex, `${flags}g`) };
}
