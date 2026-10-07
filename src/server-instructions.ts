import { EXPLAIN_FEATURE_PROMPT } from './prompts/explain-feature.js';
import { REVIEW_WITH_CONVENTIONS_PROMPT } from './prompts/review-with-conventions.js';
import { CHECK_CODE_TOOL } from './tools/check-code.js';
import { GET_CONVENTIONS_TOOL } from './tools/get-conventions.js';
import { GET_FEATURE_DOC_TOOL } from './tools/get-feature-doc.js';
import { GET_PROJECT_CONTEXT_TOOL } from './tools/get-project-context.js';
import { LIST_FEATURES_TOOL } from './tools/list-features.js';
import { SEARCH_DOCS_TOOL } from './tools/search-docs.js';

/**
 * Sent to the client at initialization. Some clients, such as Claude Code with tool search,
 * only show the agent the tool names and these instructions until it looks a tool up: they
 * tell it when to reach for this server. Claude Code cuts them at 2,048 characters.
 */
export const SERVER_INSTRUCTIONS = [
  'Context of the software project you are working on, written by its team: overview, ' +
    'features, coding conventions and security rules. Rely on it rather than on general habits.',
  `- Before writing or changing code: ${GET_PROJECT_CONTEXT_TOOL}, then ${GET_CONVENTIONS_TOOL} ` +
    'for each topic the change touches.',
  `- Before changing a feature: ${LIST_FEATURES_TOOL}, then ${GET_FEATURE_DOC_TOOL}.`,
  `- To find where a topic is documented: ${SEARCH_DOCS_TOOL}.`,
  `- Before proposing code: ${CHECK_CODE_TOOL}, then fix every error it reports. A clean ` +
    'result does not prove that the code is secure.',
  'Every tool is read-only. The documents are also resources (context://<path without .md>), ' +
    `and two prompts help people: ${REVIEW_WITH_CONVENTIONS_PROMPT} and ${EXPLAIN_FEATURE_PROMPT}.`,
].join('\n');
