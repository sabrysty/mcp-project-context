import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import {
  ContextNotFoundError,
  InvalidFrontMatterError,
  PathTraversalError,
  UnsupportedFileTypeError,
} from '../src/context/errors.js';
import { runRequest } from '../src/handler-helpers.js';
import { createLogger } from '../src/logger.js';

function captureLogs() {
  const lines: string[] = [];
  return { lines, logger: createLogger('debug', (line) => lines.push(line)) };
}

async function errorFrom(error: Error, logger = captureLogs().logger): Promise<ProtocolError> {
  try {
    await runRequest('Reading context://notes', logger, () => Promise.reject(error));
  } catch (thrown) {
    if (thrown instanceof ProtocolError) return thrown;
    throw thrown;
  }
  throw new Error('runRequest did not fail');
}

describe('runRequest', () => {
  it('returns the result of the handler', async () => {
    const { logger } = captureLogs();

    await expect(runRequest('demo', logger, () => Promise.resolve(42))).resolves.toBe(42);
  });

  it('keeps a protocol error thrown on purpose', async () => {
    const error = new ProtocolError(ProtocolErrorCode.InvalidParams, 'Bad argument');

    await expect(errorFrom(error)).resolves.toBe(error);
  });

  it.each([
    new PathTraversalError('Invalid path "../x.md"'),
    new UnsupportedFileTypeError('Not a Markdown document: project/.md'),
  ])('reports $name as an invalid request, with its message', async (error) => {
    await expect(errorFrom(error)).resolves.toMatchObject({
      code: ProtocolErrorCode.InvalidParams,
      message: error.message,
    });
  });

  it.each([
    new InvalidFrontMatterError('Invalid front-matter in features/x.md'),
    new ContextNotFoundError('Not found: features/x.md'),
  ])('reports $name as an internal error, with its message', async (error) => {
    await expect(errorFrom(error)).resolves.toMatchObject({
      code: ProtocolErrorCode.InternalError,
      message: error.message,
    });
  });

  it('hides the details of an unexpected error from the client, but logs them', async () => {
    const { lines, logger } = captureLogs();
    const systemError = new Error("EACCES: permission denied, open 'D:\\secret\\notes.md'");

    const error = await errorFrom(systemError, logger);

    expect(error.code).toBe(ProtocolErrorCode.InternalError);
    expect(error.message).toBe(
      'Reading context://notes failed because of an internal error; details are in the server logs.',
    );
    expect(JSON.stringify(error.data ?? null)).not.toContain('secret');
    expect(lines.join('\n')).toContain('EACCES');
  });
});
