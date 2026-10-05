import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/logger.js';

describe('createLogger', () => {
  it('writes level, message and JSON context', () => {
    const lines: string[] = [];
    const logger = createLogger('debug', (line) => lines.push(line));

    logger.info('hello', { answer: 42 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/INFO hello \{"answer":42\}$/);
  });

  it('drops messages below the minimum level', () => {
    const lines: string[] = [];
    const logger = createLogger('warn', (line) => lines.push(line));

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(lines.map((line) => line.split(' ')[1])).toEqual(['WARN', 'ERROR']);
  });

  it('never writes to stdout by default', () => {
    const stdoutWrites: unknown[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalConsoleError = console.error;
    process.stdout.write = (chunk: unknown) => {
      stdoutWrites.push(chunk);
      return true;
    };
    console.error = () => undefined;

    try {
      createLogger('debug').info('to stderr');
    } finally {
      process.stdout.write = originalWrite;
      console.error = originalConsoleError;
    }

    expect(stdoutWrites).toHaveLength(0);
  });
});
