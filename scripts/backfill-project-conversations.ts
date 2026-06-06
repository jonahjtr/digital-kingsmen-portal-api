/**
 * Ensures every project has one unified client_project conversation with full membership.
 * Run: npx tsx scripts/backfill-project-conversations.ts
 */
import { initPrisma, getPrisma } from '../src/lib/prisma';
import { backfillAllProjectConversations } from '../src/services/conversation-members.service';

initPrisma();

async function main() {
  const result = await backfillAllProjectConversations();
  console.log(`Backfilled ${result.projects} project conversation(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => getPrisma().$disconnect());
