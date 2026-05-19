import { getServerByName } from 'partyserver';
import { getWorkerBindings } from '../lib/workerBindings';
import type { PartyBroadcastBody } from './types';

const BROADCAST_URL = 'https://party.internal/party/broadcast';

export async function broadcastToParty(
  namespace: DurableObjectNamespace | undefined,
  room: string,
  event: PartyBroadcastBody,
): Promise<void> {
  if (!namespace) return;
  try {
    const stub = await getServerByName(namespace, room);
    await stub.fetch(BROADCAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.error('party broadcast failed', err);
  }
}

export async function broadcastConversation(
  conversationId: string,
  event: PartyBroadcastBody,
): Promise<void> {
  const env = getWorkerBindings();
  if (!env?.CONVERSATION_SERVER) return;
  await broadcastToParty(env.CONVERSATION_SERVER, conversationId, event);
}

export async function broadcastUser(userId: string, event: PartyBroadcastBody): Promise<void> {
  const env = getWorkerBindings();
  if (!env?.USER_SERVER) return;
  await broadcastToParty(env.USER_SERVER, userId, event);
}
