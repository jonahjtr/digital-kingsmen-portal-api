/**
 * Ticket business rules. Routes are thin wrappers around these functions, and the MCP server /
 * future email-in / cron jobs call the same functions — one code path for every entry point.
 */
import type { Prisma, Ticket, User } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, ErrorCodes } from '../lib/errors';
import { companyWhereForUser } from '../permissions/filters';
import { assertCanAccessCompany, assertCanAccessProject } from '../permissions/access';
import {
  AUTO_CLOSE_DAYS,
  CLIENT_SETTABLE_STATUSES,
  TICKET_CATEGORIES,
  priorityOf,
  statusKind,
} from './config';
import { emitTicketEvent, type TicketEventKind } from './events';
import { computeSla } from './sla';

type Actor = Pick<User, 'id' | 'role' | 'fullName'>;
const isStaff = (u: Actor) => u.role !== 'client';

const HOUR = 3_600_000;

// ------------------------------------------------------------------ visibility

/** Every ticket query goes through this. Clients: their companies. Staff: companies they can see. */
export async function ticketWhereForUser(user: User): Promise<Prisma.TicketWhereInput> {
  return { company: await companyWhereForUser(user) };
}

export async function getTicketForUser(user: User, idOrNumber: string) {
  const asNumber = /^\d+$/.test(idOrNumber) ? Number(idOrNumber) : undefined;
  const ticket = await prisma.ticket.findFirst({
    where: {
      AND: [await ticketWhereForUser(user), asNumber ? { number: asNumber } : { id: idOrNumber }],
    },
    include: ticketInclude,
  });
  // Not found and not allowed look identical — never confirm a ticket exists.
  if (!ticket) throw new AppError(ErrorCodes.NOT_FOUND, 'Ticket not found', 404);
  return ticket;
}

const assignedTo = (id: string): Prisma.TicketWhereInput => ({ OR: [{ assigneeId: id }, { assignees: { some: { userId: id } } }] });
const unassignedWhere: Prisma.TicketWhereInput = { assigneeId: null, assignees: { none: {} } };

export const ticketInclude = {
  company: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  requester: { select: { id: true, fullName: true } },
  assignee: { select: { id: true, fullName: true } },
  assignees: { orderBy: { createdAt: 'asc' }, select: { user: { select: { id: true, fullName: true, email: true } } } },
} as const;

type TicketWithRefs = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

/** Shape sent to clients/staff. Internal-only fields are dropped for clients. */
export function presentTicket(t: TicketWithRefs, viewer: Actor) {
  const sla = computeSla(t);
  const base = {
    id: t.id,
    number: t.number,
    title: t.title,
    category: t.category,
    priority: t.priority,
    status: t.status,
    statusKind: statusKind(t.status),
    company: t.company,
    project: t.project,
    requester: t.requester,
    assignee: t.assignee,
    assignees: t.assignees.map((a) => a.user),
    source: t.source,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastActivityAt: t.lastActivityAt,
    resolvedAt: t.resolvedAt,
  };
  if (!isStaff(viewer)) return base;
  return {
    ...base,
    customFields: safeJson(t.customFields),
    firstResponseAt: t.firstResponseAt,
    firstResponseDueAt: t.firstResponseDueAt,
    resolutionDueAt: t.resolutionDueAt,
    sla,
  };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ list

export type TicketListFilters = {
  status?: string; // a status key, or "active" (open+pending) / "closed"
  priority?: string;
  category?: string;
  assigneeId?: string | 'me' | 'none';
  companyId?: string;
  q?: string;
  breached?: boolean;
  page: number;
  limit: number;
};

export async function listTickets(user: User, f: TicketListFilters) {
  const and: Prisma.TicketWhereInput[] = [await ticketWhereForUser(user)];
  if (f.status === 'active') and.push({ status: { notIn: closedStatuses() } });
  else if (f.status === 'closed') and.push({ status: { in: closedStatuses() } });
  else if (f.status) and.push({ status: f.status });
  if (f.priority) and.push({ priority: f.priority });
  if (f.category) and.push({ category: f.category });
  if (f.companyId) and.push({ companyId: f.companyId });
  if (isStaff(user) && f.assigneeId) {
    and.push(f.assigneeId === 'none' ? unassignedWhere : assignedTo(f.assigneeId === 'me' ? user.id : f.assigneeId));
  }
  if (f.q) {
    const q = f.q.trim();
    and.push(
      /^#?\d+$/.test(q)
        ? { number: Number(q.replace('#', '')) }
        : { OR: [{ title: { contains: q } }, { company: { name: { contains: q } } }] },
    );
  }
  if (isStaff(user) && f.breached) {
    const now = new Date();
    and.push({
      status: { notIn: [...closedStatuses(), ...pendingStatuses()] },
      OR: [
        { firstResponseAt: null, firstResponseDueAt: { lt: now } },
        { resolutionDueAt: { lt: now } },
      ],
    });
  }
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: ticketInclude,
      orderBy: [{ lastActivityAt: 'desc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    prisma.ticket.count({ where }),
  ]);
  return { rows: rows.map((t) => presentTicket(t, user)), total };
}

const closedStatuses = () => ['resolved', 'closed'];
const pendingStatuses = () => ['waiting_on_client'];

/** Counts for the sidebar badge / inbox tabs. */
export async function ticketCounts(user: User) {
  const scope = await ticketWhereForUser(user);
  const active = { AND: [scope, { status: { notIn: closedStatuses() } }] };
  if (!isStaff(user)) {
    const waitingOnYou = await prisma.ticket.count({ where: { AND: [scope, { status: 'waiting_on_client' }] } });
    return { active: await prisma.ticket.count({ where: active }), waitingOnYou };
  }
  const now = new Date();
  const [all, mine, unassigned, breached] = await Promise.all([
    prisma.ticket.count({ where: active }),
    prisma.ticket.count({ where: { AND: [active, assignedTo(user.id)] } }),
    prisma.ticket.count({ where: { AND: [active, unassignedWhere] } }),
    prisma.ticket.count({
      where: {
        AND: [
          scope,
          { status: { notIn: [...closedStatuses(), ...pendingStatuses()] } },
          { OR: [{ firstResponseAt: null, firstResponseDueAt: { lt: now } }, { resolutionDueAt: { lt: now } }] },
        ],
      },
    }),
  ]);
  return { active: all, mine, unassigned, breached };
}

// ------------------------------------------------------------------ create

export async function createTicket(
  user: User,
  input: {
    companyId?: string;
    projectId?: string;
    category: string;
    priority?: string;
    title: string;
    body: string;
    attachmentFileId?: string;
    source?: string;
    customFields?: Record<string, unknown>;
    assigneeId?: string;
  },
) {
  // Clients with one company don't have to pick; with several they must.
  let companyId = input.companyId;
  if (!companyId) {
    const companies = await prisma.company.findMany({
      where: await companyWhereForUser(user),
      select: { id: true },
      take: 2,
    });
    if (companies.length !== 1) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Choose a company', 400);
    companyId = companies[0].id;
  }
  await assertCanAccessCompany(user, companyId);
  if (input.projectId) {
    await assertCanAccessProject(user, input.projectId);
    const p = await prisma.project.findUnique({ where: { id: input.projectId }, select: { companyId: true } });
    if (p?.companyId !== companyId) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Project is not for this company', 400);
  }
  const category = TICKET_CATEGORIES.find((c) => c.key === input.category)!;
  // Clients choose a category; staff decide priority. A client saying "urgent" goes to triage, not the SLA.
  const priority = isStaff(user) && input.priority ? input.priority : category.defaultPriority;
  const attachmentFileId = await claimAttachment(user, input.attachmentFileId);
  const assigneeId = isStaff(user) && input.assigneeId ? await assertAssignable(input.assigneeId) : await defaultAssignee(companyId);

  const now = new Date();
  const p = priorityOf(priority);

  // ponytail: number = max+1 retried on unique-collision. Fine at our volume; swap for a counter row if
  // tickets ever get created concurrently in bulk (email-in storms).
  let ticket: Ticket | null = null;
  for (let attempt = 0; attempt < 5 && !ticket; attempt++) {
    const max = await prisma.ticket.aggregate({ _max: { number: true } });
    try {
      ticket = await prisma.ticket.create({
        data: {
          number: (max._max.number ?? 1000) + 1,
          companyId,
          projectId: input.projectId,
          requesterId: user.id,
          assigneeId,
          category: category.key,
          priority,
          status: 'new',
          title: input.title.trim(),
          source: input.source ?? 'portal',
          customFields: JSON.stringify(input.customFields ?? {}),
          firstResponseDueAt: new Date(now.getTime() + p.firstResponseHours * HOUR),
          resolutionDueAt: new Date(now.getTime() + p.resolutionHours * HOUR),
          lastActivityAt: now,
        },
      });
    } catch (e) {
      if (!String((e as Error).message).includes('Unique')) throw e;
    }
  }
  if (!ticket) throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Could not number ticket', 500);
  if (assigneeId) await prisma.ticketAssignee.create({ data: { ticketId: ticket.id, userId: assigneeId } });

  const ev = await prisma.ticketEvent.create({
    data: { ticketId: ticket.id, actorId: user.id, kind: 'created', body: input.body.trim(), attachmentFileId },
  });
  await emitTicketEvent({ kind: 'created', ticket, actor: user, eventId: ev.id, internal: false, body: input.body });
  return getTicketForUser(user, ticket.id);
}

async function defaultAssignee(companyId: string) {
  // Route new tickets to the client's project manager if they have one; otherwise unassigned (triage).
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { assignedProjectManagerId: true } });
  return c?.assignedProjectManagerId ?? null;
}

async function assertAssignable(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!u || !u.isActive || u.role === 'client') throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid assignee', 400);
  return userId;
}

async function claimAttachment(user: Actor, fileId?: string) {
  if (!fileId) return undefined;
  const f = await prisma.file.findFirst({
    where: { id: fileId, uploadedBy: user.id, messages: { none: {} }, ticketEvents: { none: {} } },
    select: { id: true },
  });
  if (!f) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Attachment not found', 400);
  return f.id;
}

// ------------------------------------------------------------------ timeline

export async function listEvents(user: User, ticketId: string) {
  const t = await getTicketForUser(user, ticketId);
  const events = await prisma.ticketEvent.findMany({
    where: { ticketId: t.id, ...(isStaff(user) ? {} : { internal: false }) },
    orderBy: { createdAt: 'asc' },
    include: {
      actor: { select: { id: true, fullName: true, role: true } },
      attachment: { select: { id: true, fileName: true, fileType: true, fileSize: true } },
    },
  });
  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    body: e.body,
    data: safeJson(e.data),
    internal: e.internal,
    createdAt: e.createdAt,
    // Clients see "Digital Kingsmen" team members by name but never their role/email.
    actor: e.actor ? { id: e.actor.id, fullName: e.actor.fullName, isStaff: e.actor.role !== 'client' } : null,
    attachment: e.attachment,
  }));
}

/** Reply (public) or internal note (staff only). */
export async function addComment(
  user: User,
  ticketId: string,
  input: { body: string; internal?: boolean; attachmentFileId?: string; status?: string },
) {
  const t = await getTicketForUser(user, ticketId);
  const internal = isStaff(user) && !!input.internal;
  const body = input.body.trim();
  const attachmentFileId = await claimAttachment(user, input.attachmentFileId);
  if (!body && !attachmentFileId) throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Reply is empty', 400);

  const now = new Date();
  const kind: TicketEventKind = internal ? 'note' : 'reply';
  const ev = await prisma.ticketEvent.create({
    data: { ticketId: t.id, actorId: user.id, kind, body, internal, attachmentFileId },
  });

  const patch: Prisma.TicketUpdateInput = { lastActivityAt: now };
  if (!internal) {
    if (isStaff(user)) {
      if (!t.firstResponseAt) patch.firstResponseAt = now;
      // Staff replied on a new ticket → it's being worked.
      if (t.status === 'new') patch.status = 'open';
    } else if (statusKind(t.status) !== 'open') {
      // Client replied while we were waiting on them, or after it was resolved → reopen.
      patch.status = 'open';
      patch.resolvedAt = null;
      if (statusKind(t.status) === 'pending') patch.resolutionDueAt = await resumedDueAt(t, now);
    }
  }
  let updated = await prisma.ticket.update({ where: { id: t.id }, data: patch });
  await emitTicketEvent({ kind, ticket: updated, actor: user, eventId: ev.id, internal, body });
  if (patch.status && patch.status !== t.status) {
    await recordChange(user, updated, 'status_changed', { from: t.status, to: patch.status }, true);
  }
  // "Reply and set status" in one action (e.g. reply + Waiting on client / Resolved).
  if (input.status && input.status !== updated.status) {
    await updateTicket(user, t.id, { status: input.status });
    updated = (await prisma.ticket.findUnique({ where: { id: t.id } }))!;
  }
  return ev.id;
}

// ------------------------------------------------------------------ updates

export async function updateTicket(
  user: User,
  ticketId: string,
  input: { status?: string; priority?: string; assigneeId?: string | null; assigneeIds?: string[]; category?: string; title?: string; customFields?: Record<string, unknown> },
) {
  const t = await getTicketForUser(user, ticketId);
  if (!isStaff(user)) {
    // Clients can only reopen or mark solved — nothing else.
    const keys = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
    if (keys.some((k) => k !== 'status') || !input.status || !(CLIENT_SETTABLE_STATUSES as string[]).includes(input.status)) {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Not allowed', 403);
    }
  }
  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = {};
  const changes: Array<[TicketEventKind, Record<string, unknown>]> = [];

  if (input.status && input.status !== t.status) {
    data.status = input.status;
    const toKind = statusKind(input.status);
    const fromKind = statusKind(t.status);
    if (toKind === 'closed' && fromKind !== 'closed') data.resolvedAt = now;
    if (toKind !== 'closed' && fromKind === 'closed') data.resolvedAt = null;
    // Leaving a pending status: extend the resolution deadline by the time spent waiting (SLA pause).
    if (fromKind === 'pending' && toKind !== 'pending') data.resolutionDueAt = await resumedDueAt(t, now);
    changes.push(['status_changed', { from: t.status, to: input.status }]);
  }
  if (input.priority && input.priority !== t.priority) {
    data.priority = input.priority;
    // Re-base SLA targets from creation time on the new priority.
    const p = priorityOf(input.priority);
    data.firstResponseDueAt = new Date(t.createdAt.getTime() + p.firstResponseHours * HOUR);
    data.resolutionDueAt = new Date(t.createdAt.getTime() + p.resolutionHours * HOUR);
    changes.push(['priority_changed', { from: t.priority, to: input.priority }]);
  }
  // assigneeIds = full list (first = lead). Legacy assigneeId = "just this one person" (or null = nobody).
  const nextIds =
    input.assigneeIds !== undefined ? [...new Set(input.assigneeIds)] : input.assigneeId !== undefined ? (input.assigneeId ? [input.assigneeId] : []) : null;
  let assigneesChanged = false;
  if (nextIds) {
    const prev = t.assignees.map((a) => a.user.id);
    const added = nextIds.filter((id) => !prev.includes(id));
    const removed = prev.filter((id) => !nextIds.includes(id));
    if (added.length || removed.length || (nextIds[0] ?? null) !== t.assigneeId) {
      for (const id of added) await assertAssignable(id);
      await prisma.ticketAssignee.deleteMany({ where: { ticketId: t.id, userId: { in: removed } } });
      for (const id of added) await prisma.ticketAssignee.create({ data: { ticketId: t.id, userId: id } });
      data.assigneeId = nextIds[0] ?? null;
      assigneesChanged = true;
      changes.push(['assigned', { from: t.assigneeId, to: nextIds[0] ?? null, added, removed }]);
    }
  }
  if (input.category && input.category !== t.category) {
    data.category = input.category;
    changes.push(['category_changed', { from: t.category, to: input.category }]);
  }
  if (input.title && input.title.trim() !== t.title) data.title = input.title.trim();
  if (input.customFields) data.customFields = JSON.stringify({ ...safeJson(t.customFields), ...input.customFields });
  if (!Object.keys(data).length && !assigneesChanged) return t;

  data.lastActivityAt = now;
  const updated = await prisma.ticket.update({ where: { id: t.id }, data });
  for (const [kind, d] of changes) {
    // Assignment / priority changes are staff housekeeping; status changes are visible to the client.
    await recordChange(user, updated, kind, d, kind !== 'status_changed');
  }
  return getTicketForUser(user, t.id);
}

/** Leaving a pending status: push the resolution deadline out by the time spent waiting (SLA pause). */
async function resumedDueAt(t: Ticket, now: Date) {
  if (!t.resolutionDueAt) return t.resolutionDueAt;
  const pausedSince = await lastStatusChangeAt(t.id, t.status);
  return pausedSince ? new Date(t.resolutionDueAt.getTime() + (now.getTime() - pausedSince.getTime())) : t.resolutionDueAt;
}

async function lastStatusChangeAt(ticketId: string, into: string) {
  const e = await prisma.ticketEvent.findFirst({
    where: { ticketId, kind: 'status_changed', data: { contains: `"to":"${into}"` } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return e?.createdAt;
}

async function recordChange(user: Actor, ticket: Ticket, kind: TicketEventKind, data: Record<string, unknown>, internal: boolean) {
  const ev = await prisma.ticketEvent.create({
    data: { ticketId: ticket.id, actorId: user.id, kind, data: JSON.stringify(data), internal },
  });
  await emitTicketEvent({ kind, ticket, actor: user, eventId: ev.id, internal, data });
}

// ------------------------------------------------------------------ attachments

export async function getEventAttachment(user: User, eventId: string) {
  const ev = await prisma.ticketEvent.findUnique({
    where: { id: eventId },
    select: { ticketId: true, internal: true, attachment: true },
  });
  if (!ev?.attachment || (ev.internal && !isStaff(user))) throw new AppError(ErrorCodes.NOT_FOUND, 'Not found', 404);
  await getTicketForUser(user, ev.ticketId); // visibility check
  return ev.attachment;
}

/** Tick/untick the Nth "- [ ]" line of a reply/note/description. Anyone who can see the event can tick it. */
export const CHECK_RE = /^(\s*[-*]\s+\[)([ xX])(\]\s)/;
export function toggleChecklistLine(body: string, line: number, checked: boolean) {
  let n = -1;
  return body
    .split('\n')
    .map((l) => (CHECK_RE.test(l) && ++n === line ? l.replace(CHECK_RE, `$1${checked ? 'x' : ' '}$3`) : l))
    .join('\n');
}

export async function toggleChecklist(user: User, eventId: string, line: number, checked: boolean) {
  const ev = await prisma.ticketEvent.findUnique({ where: { id: eventId }, select: { ticketId: true, internal: true, body: true } });
  if (!ev?.body || (ev.internal && !isStaff(user))) throw new AppError(ErrorCodes.NOT_FOUND, 'Not found', 404);
  await getTicketForUser(user, ev.ticketId); // visibility check
  const body = toggleChecklistLine(ev.body, line, checked);
  if (body !== ev.body) {
    await prisma.ticketEvent.update({ where: { id: eventId }, data: { body } });
    await prisma.ticket.update({ where: { id: ev.ticketId }, data: { lastActivityAt: new Date() } });
  }
  return { body };
}

// ------------------------------------------------------------------ housekeeping

/** Close tickets that have sat in "resolved" for AUTO_CLOSE_DAYS. Called by the scheduled worker. */
export async function autoCloseResolved(now = new Date()) {
  const cutoff = new Date(now.getTime() - AUTO_CLOSE_DAYS * 24 * HOUR);
  const stale = await prisma.ticket.findMany({ where: { status: 'resolved', lastActivityAt: { lt: cutoff } } });
  for (const t of stale) {
    const updated = await prisma.ticket.update({ where: { id: t.id }, data: { status: 'closed' } });
    const ev = await prisma.ticketEvent.create({
      data: { ticketId: t.id, kind: 'status_changed', data: JSON.stringify({ from: 'resolved', to: 'closed', auto: true }) },
    });
    await emitTicketEvent({ kind: 'status_changed', ticket: updated, actor: null, eventId: ev.id, internal: false, data: { from: 'resolved', to: 'closed' } });
  }
  return stale.length;
}
