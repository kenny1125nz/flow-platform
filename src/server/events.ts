import type { ServerResponse } from 'node:http';
import type { StreamEvent } from '../api-types.js';

export class EventHub {
  private readonly clients = new Set<ServerResponse>();

  subscribe(response: ServerResponse): void {
    this.clients.add(response);
    response.write(`event: ready\ndata: {}\n\n`);
  }

  unsubscribe(response: ServerResponse): void {
    this.clients.delete(response);
  }

  publish(event: StreamEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(frame);
    }
  }
}
