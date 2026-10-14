import {
  completable,
  ProtocolError,
  ProtocolErrorCode,
  type GetPromptResult,
  type McpServer,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { ContextNotFoundError, PathTraversalError } from '../context/errors.js';
import type { ContextDocument } from '../context/loader.js';
import type { ProjectContext } from '../context/project-context.js';
import { runRequest, type HandlerDependencies } from '../handler-helpers.js';
import { formatNotFound } from '../tools/format.js';
import { MAX_NAME_LENGTH } from '../tools/tool-helpers.js';
import { documentBlock, loadIfPresent, userPrompt } from './prompt-helpers.js';

export const EXPLAIN_FEATURE_PROMPT = 'explain-feature';

function explainInstructions(feature: ContextDocument): string {
  return [
    `Explain the feature ${JSON.stringify(feature.title)} (${feature.path}) to a developer ` +
      'who has just joined the project, from <documentation>.',
    '',
    'Cover:',
    '1. what the feature is for, for the users and for the business;',
    '2. how it works: the main flows, step by step;',
    '3. where it lives: modules, endpoints, components, data;',
    '4. the points of attention: security, edge cases, known pitfalls;',
    '5. where to start to change it safely.',
    '',
    'Rely on the documentation only: when it does not cover a point, say so instead of ' +
      'guessing. Explain each business term the first time you use it. Write in the language ' +
      'of the documentation.',
  ].join('\n');
}

export async function explainFeature(
  context: ProjectContext,
  name: string,
): Promise<GetPromptResult> {
  const [feature, project] = await Promise.all([
    loadFeature(context, name),
    // The overview gives a newcomer the business and architecture the feature fits in.
    loadIfPresent(context.getProject()),
  ]);
  const documents = [...(project ? [project] : []), feature];

  const text = [
    ['<documentation>', ...documents.map(documentBlock), '</documentation>'].join('\n'),
    explainInstructions(feature),
  ].join('\n\n');
  return userPrompt(`Explanation of the feature "${feature.title}" for a new developer`, text);
}

/** The feature, or an error that tells the client which names exist. */
async function loadFeature(context: ProjectContext, name: string): Promise<ContextDocument> {
  try {
    return await context.getFeature(name);
  } catch (error) {
    if (error instanceof PathTraversalError) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Invalid feature name ${JSON.stringify(name)}: use a name returned by list_features.`,
      );
    }
    if (error instanceof ContextNotFoundError) {
      const { entries } = await context.listFeatures();
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        formatNotFound(
          'Feature',
          name,
          entries.map((entry) => entry.name),
        ),
      );
    }
    throw error;
  }
}

async function completeFeatureNames(context: ProjectContext, prefix: string): Promise<string[]> {
  const { entries } = await context.listFeatures();
  const lowerPrefix = prefix.toLowerCase();
  return entries
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().startsWith(lowerPrefix));
}

export function registerExplainFeaturePrompt(
  server: McpServer,
  { context, logger }: HandlerDependencies,
): void {
  const argsSchema = z.object({
    // completable() marks this very schema object, so it wraps the described schema.
    name: completable(
      z
        .string()
        .trim()
        .min(1)
        .max(MAX_NAME_LENGTH)
        .describe('Name of the feature, as listed by list_features (e.g. "authentication")'),
      (prefix) =>
        runRequest('Completing a feature name', logger, () =>
          completeFeatureNames(context, prefix),
        ),
    ),
  });

  server.registerPrompt(
    EXPLAIN_FEATURE_PROMPT,
    {
      title: 'Explain a feature to a new developer',
      description:
        'Builds a request to explain a feature of this project to a developer who has just ' +
        'joined: its purpose, flows, code locations and points of attention, from its ' +
        'documentation and the project overview only.',
      argsSchema,
    },
    ({ name }) =>
      runRequest(`Building the ${EXPLAIN_FEATURE_PROMPT} prompt`, logger, () =>
        explainFeature(context, name),
      ),
  );
}
