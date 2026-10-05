#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const server = createServer({ config, logger });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`, {
    contextDir: config.contextDir,
  });

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  const logger = createLogger();
  if (error instanceof ConfigError) {
    logger.error(`Invalid configuration: ${error.message}`);
  } else {
    logger.error('Fatal error', { error: error instanceof Error ? error.stack : String(error) });
  }
  process.exit(1);
});
