import { fileURLToPath } from 'node:url';

import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
  type McpServer,
} from '@modelcontextprotocol/server';

import { createLogger } from '../../src/logger.js';
import { createServer } from '../../src/server.js';

export const DEMO_CONTEXT_DIR = fileURLToPath(
  new URL('../../examples/taskflow-context', import.meta.url),
);

export interface ToolCallResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Minimal JSON-RPC client over an in-memory transport: it exercises the real protocol path
 * (validation, routing, serialization) without spawning a process.
 */
export class TestClient {
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

  async listTools(): Promise<ListedTool[]> {
    const result = resultOf(await this.request('tools/list'));
    return (result as { tools: ListedTool[] }).tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    return resultOf(await this.request('tools/call', { name, arguments: args })) as ToolCallResult;
  }
}

function resultOf(response: JSONRPCMessage): unknown {
  if (!('result' in response)) {
    throw new Error(`Unexpected JSON-RPC response: ${JSON.stringify(response)}`);
  }
  return response.result;
}

/** The text blocks of a tool result, joined. */
export function textOf(result: ToolCallResult): string {
  return result.content.map((block) => block.text ?? '').join('\n');
}

export interface TestServer {
  server: McpServer;
  client: TestClient;
  initializeResponse: JSONRPCMessage;
}

/** Starts a server reading `contextDir` and returns a client that has completed initialization. */
export async function startTestServer(contextDir: string): Promise<TestServer> {
  const server = createServer({
    config: { contextDir, logLevel: 'error' },
    logger: createLogger('error', () => undefined),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();

  const client = new TestClient(clientTransport);
  const initializeResponse = await client.initialize();
  await client.notify('notifications/initialized');
  return { server, client, initializeResponse };
}
