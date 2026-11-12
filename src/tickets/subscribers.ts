/**
 * Built-in reactions to ticket events. To integrate something new (email, Slack, Plane, webhooks),
 * add another onTicketEvent(...) here — the ticket core doesn't change.
 */
import { prisma } from '../lib/prisma';
import { notifyUsers } from '../services/notification.service';
import { broadcastUser } from '../party/broadcast';
import { onTicketEvent } from './events';
import { TICKET_STATUSES } from './config';

const label = (s: unknown) => TICKET_STATUSES.find((x) => x.key === s)?.label ?? String(s);

async function assigneeIds(ticketId: string) {
  return (await prisma.ticketAssignee.findMany({ where: { ticketId }, select: { userId: true } })).map((a) => a.userId);
}

async function staffWatchers(ticket: { id: string; companyId: string; assigneeId: string | null }) {
  const ids = await assigneeIds(ticket.id);
  if (ticket.assigneeId && !ids.includes(ticket.assigneeId)) ids.push(ticket.assigneeId);
  if (ids.length) return ids;
  // Unassigned → admins + the client's PM so nothing falls through the cracks.
  const [admins, company] = await Promise.all([
    prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
    prisma.company.findUnique({ where: { id: ticket.companyId }, select: { assignedProjectManagerId: true } }),
  ]);
  return [...admins.map((a) => a.id), company?.assignedProjectManagerId].filter(Boolean) as string[];
}

async function clientWatchers(ticket: { requesterId: string }) {
  return [ticket.requesterId];
}

export function registerTicketSubscribers() {
  // In-app notifications.
  onTicketEvent('notify', async (e) => {
    const t = e.ticket;
    const tag = `#${t.number}`;
    const actorId = e.actor?.id;
    const fromClient = e.actor?.role === 'client';
    const notifyExcept = (ids: string[], title: string, msg: string) =>
      notifyUsers(ids.filter((id) => id !== actorId), title, msg.slice(0, 200), 'ticket');

    switch (e.kind) {
      case 'created':
        return notifyExcept(await staffWatchers(t), `New ticket ${tag}`, `${e.actor?.fullName ?? 'Client'}: ${t.title}`);
      case 'reply':
        return fromClient
          ? notifyExcept(await staffWatchers(t), `Reply on ${tag}`, `${e.actor?.fullName}: ${e.body ?? ''}`)
          : notifyExcept(await clientWatchers(t), `Digital Kingsmen replied on ${tag}`, e.body ?? t.title);
      case 'note':
        return notifyExcept(await staffWatchers(t), `Note on ${tag}`, `${e.actor?.fullName}: ${e.body ?? ''}`);
      case 'assigned':
        {
          const added = Array.isArray(e.data?.added) ? (e.data.added as string[]) : t.assigneeId ? [t.assigneeId] : [];
          if (added.length) return notifyExcept(added, `Assigned to you: ${tag}`, t.title);
        }
        return;
      case 'status_changed':
        if (e.internal) return;
        return fromClient
          ? notifyExcept(await staffWatchers(t), `${tag} is now ${label(e.data?.to)}`, t.title)
          : notifyExcept(await clientWatchers(t), `${tag} is now ${label(e.data?.to)}`, t.title);
    }
  });

  // Realtime: tell everyone who can see this ticket to refresh it (payload is just ids — clients refetch
  // through the normal permission-checked API, so nothing internal can leak over the socket).
  onTicketEvent('realtime', async (e) => {
    const ids = new Set([...(await staffWatchers(e.ticket)), e.ticket.requesterId]);
    if (e.ticket.assigneeId) ids.add(e.ticket.assigneeId);
    await Promise.all(
      [...ids].map((id) =>
        broadcastUser(id, { type: 'ticket.updated', payload: { ticketId: e.ticket.id, number: e.ticket.number } }),
      ),
    );
  });
}
