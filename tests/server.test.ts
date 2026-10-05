import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
  type McpServer,
} from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger } from '../src/logger.js';
import { createServer, SERVER_NAME } from '../src/server.js';

/**
 * Minimal JSON-RPC client over an in-memory transport: it exercises the real
 * protocol path (validation, routing, serialization) without spawning a process.
 */
class TestClient {
  private nextId = 1;
  private readonly pending = new Map<number, (message: JSONRPCMessage) => void>();

  constructor(private readonly transport: InMemoryTransport) {
    transport.onmessage = (message) => {
      if ('id' in message && typeof message.id === 'number') {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
    };
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<JSONRPCMessage> {
    const id = this.nextId++;
    const response = new Promise<JSONRPCMessage>((resolve) => this.pending.set(id, resolve));
    await this.transport.send({ jsonrpc: '2.0', id, method, params });
    return response;
  }

  async notify(method: string): Promise<void> {
    await this.transport.send({ jsonrpc: '2.0', method });
  }

  initialize(): Promise<JSONRPCMessage> {
    return this.request('initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
  }
}

async function connectTestClient(server: McpServer): Promise<TestClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  return new TestClient(clientTransport);
}

describe('createServer', () => {
  let server: McpServer;
  let client: TestClient;
  let initializeResponse: JSONRPCMessage;

  beforeEach(async () => {
    server = createServer({
      config: { contextDir: process.cwd(), logLevel: 'error' },
      logger: createLogger('error', () => undefined),
    });
    client = await connectTestClient(server);
    initializeResponse = await client.initialize();
    await client.notify('notifications/initialized');
  });

  afterEach(async () => {
    await server.close();
  });

  it('identifies itself during initialization', () => {
    expect(initializeResponse).toMatchObject({ result: { serverInfo: { name: SERVER_NAME } } });
  });

  it('lists the ping tool as read-only', async () => {
    const response = await client.request('tools/list');

    expect(response).toMatchObject({
      result: { tools: [{ name: 'ping', annotations: { readOnlyHint: true } }] },
    });
  });

  it('answers pong to a ping call', async () => {
    const response = await client.request('tools/call', { name: 'ping', arguments: {} });

    expect(response).toMatchObject({
      result: { content: [{ type: 'text', text: 'pong' }] },
    });
    expect(response).not.toHaveProperty('result.isError', true);
  });
});
