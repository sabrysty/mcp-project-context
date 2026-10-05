import { describe, expect, it } from 'vitest';

import { ContextNotFoundError } from '../../src/context/errors.js';
import { createLogger } from '../../src/logger.js';
import { runTool, textResult } from '../../src/tools/tool-helpers.js';

function captureLogs() {
  const lines: string[] = [];
  return { lines, logger: createLogger('debug', (line) => lines.push(line)) };
}

describe('runTool', () => {
  it('returns the result of the handler', async () => {
    const { logger } = captureLogs();

    await expect(runTool('demo', logger, () => Promise.resolve(textResult('ok')))).resolves.toEqual(
      textResult('ok'),
    );
  });

  it('turns a context error into an error result the agent can read', async () => {
    const { logger } = captureLogs();

    const result = await runTool('demo', logger, () =>
      Promise.reject(new ContextNotFoundError('Not found: features/x.md')),
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Not found: features/x.md' }],
      isError: true,
    });
  });

  it('hides the details of an unexpected error from the agent, but logs them', async () => {
    const { lines, logger } = captureLogs();
    const systemError = new Error("EACCES: permission denied, open 'D:\\secret\\notes.md'");

    const result = await runTool('demo', logger, () => Promise.reject(systemError));

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'demo failed because of an internal error; details are in the server logs.',
      },
    ]);
    expect(lines.join('\n')).toContain('EACCES');
  });
});
