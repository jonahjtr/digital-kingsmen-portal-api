import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { routePartykitRequest } from 'partyserver';
import { bootstrap } from './bootstrap';
import { setWorkerBindings } from './lib/workerBindings';
import { partyOnBeforeConnect } from './party/auth';
import type { CloudflareBindings } from './types/cloudflare';

export { ConversationPartyServer } from './party/ConversationPartyServer';
export { UserPartyServer } from './party/UserPartyServer';

function initBindings(cfEnv: CloudflareBindings): void {
  bootstrap({ DB: cfEnv.DB, R2: cfEnv.R2 });
  setWorkerBindings(cfEnv);
}

initBindings(env as CloudflareBindings);

const { createApp } = await import('./app');

const PORT = Number(process.env.PORT) || 8787;
const app = createApp();
app.listen(PORT);

const httpHandler = httpServerHandler({ port: PORT });

export default {
  async fetch(request: Request, cfEnv: CloudflareBindings, ctx: ExecutionContext): Promise<Response> {
    initBindings(cfEnv);
    const partyResponse = await routePartykitRequest(request, cfEnv, {
      prefix: 'parties',
      onBeforeConnect: partyOnBeforeConnect,
    });
    if (partyResponse) return partyResponse;
    return httpHandler.fetch(request, cfEnv, ctx);
  },
};
