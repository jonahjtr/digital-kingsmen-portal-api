/**
 * Tiny in-process event bus for tickets. The core never knows about email, Slack, Plane, etc. —
 * integrations subscribe here (see subscribers.ts). Add a feature = add a subscriber.
 *
 * Handlers run after the DB write; a failing handler is logged and never breaks the request.
 */
import type { Ticket } from '@prisma/client';

export type TicketEventKind =
  | 'created'
  | 'reply'
  | 'note'
  | 'status_changed'
  | 'priority_changed'
  | 'assigned'
  | 'category_changed'
  | 'edited';

export type TicketBusEvent = {
  kind: TicketEventKind;
  ticket: Ticket;
  actor: { id: string; role: string; fullName: string } | null;
  /** The stored TicketEvent row id. */
  eventId: string;
  internal: boolean;
  body?: string;
  data?: Record<string, unknown>;
};

type Handler = (e: TicketBusEvent) => Promise<void> | void;
const handlers: Array<{ name: string; fn: Handler }> = [];

export function onTicketEvent(name: string, fn: Handler) {
  if (!handlers.some((h) => h.name === name)) handlers.push({ name, fn });
}

export async function emitTicketEvent(e: TicketBusEvent) {
  await Promise.all(
    handlers.map(async (h) => {
      try {
        await h.fn(e);
      } catch (err) {
        console.error(`[tickets] subscriber "${h.name}" failed for ${e.kind}`, err);
      }
    }),
  );
}
