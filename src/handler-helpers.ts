import type { ProjectContext } from './context/project-context.js';
import type { Logger } from './logger.js';

/** What the handlers of the tools, resources and prompts need. */
export interface HandlerDependencies {
  context: ProjectContext;
  logger: Logger;
}
