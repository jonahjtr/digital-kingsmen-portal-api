import { Server, type Connection, type ConnectionContext } from 'partyserver';
import type { PartyBroadcastBody } from './types';

export class ConversationPartyServer extends Server {
  static options = { hibernate: true };

  getConnectionTags(_connection: Connection, ctx: ConnectionContext): string[] {
    const role = ctx.request.headers.get('X-DK-Role');
    return role === 'client' ? ['client'] : ['staff'];
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/party/broadcast')) {
      const body = (await request.json()) as PartyBroadcastBody;
      const data = JSON.stringify({ type: body.type, payload: body.payload });
      if (body.tags?.length) {
        const sent = new Set<string>();
        for (const tag of body.tags) {
          for (const conn of this.getConnections(tag)) {
            if (sent.has(conn.id)) continue;
            sent.add(conn.id);
            conn.send(data);
          }
        }
      } else {
        this.broadcast(data);
      }
      return new Response('ok');
    }
    return new Response('Not found', { status: 404 });
  }
}
