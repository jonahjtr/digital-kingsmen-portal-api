/**
 * Ensures every project has one unified client_project conversation with full membership.
 *
 * Local D1:  npm run backfill:conversations
 * Remote D1:  npm run backfill:conversations:remote
 */
import { bootstrap } from '../src/bootstrap';
import { getPrisma } from '../src/lib/prisma';
import { backfillAllProjectConversations } from '../src/services/conversation-members.service';

async function initDatabase(): Promise<(() => Promise<void>) | undefined> {
  if (process.env.CF_REMOTE === '1' || process.env.CF_SEED === '1') {
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy({
      configPath: './wrangler.toml',
      environment: process.env.WRANGLER_ENV,
      remoteBindings: process.env.CF_REMOTE === '1',
    });
    bootstrap({ DB: proxy.env.DB as D1Database });
    return proxy.dispose;
  }

  bootstrap();
  return undefined;
}

async function main() {
  const dispose = await initDatabase();
  try {
    const result = await backfillAllProjectConversations();
    console.log(`Backfilled ${result.projects} project conversation(s).`);
  } finally {
    await getPrisma().$disconnect();
    if (dispose) await dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
