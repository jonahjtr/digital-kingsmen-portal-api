import { Server } from 'partyserver';
import type { PartyBroadcastBody } from './types';

export class UserPartyServer extends Server {
  static options = { hibernate: true };

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/party/broadcast')) {
      const body = (await request.json()) as PartyBroadcastBody;
      this.broadcast(JSON.stringify({ type: body.type, payload: body.payload }));
      return new Response('ok');
    }
    return new Response('Not found', { status: 404 });
  }
}
