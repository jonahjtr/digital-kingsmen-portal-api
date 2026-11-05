import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { companyWhereForUser, projectWhereForUser, taskWhereForUser, activeTaskWhere } from '../permissions/filters';
import type { McpPrincipal, McpScope } from './auth';
import * as ticketSvc from '../tickets/service';
import { CATEGORY_KEYS, PRIORITY_KEYS, STATUS_KEYS } from '../tickets/config';

/**
 * DK internal-team MCP tools.
 *
 * Security model (every tool):
 *  - Caller is an active non-client staff user resolved from a personal token.
 *  - Row access reuses the portal's own role filters (companyWhereForUser etc.),
 *    so an employee/salesman sees exactly what they see in the portal UI, no more.
 *  - Money (revenue, payouts, contractor costs) is admin-only.
 *  - Write tools require the token's `write` scope.
 *  - Never returned: password hashes, tokens, R2 storage keys, raw logo URLs.
 */

export class ToolError extends Error {}

type Tool = {
  name: string;
  description: string;
  scope: McpScope;
  adminOnly?: boolean;
  input: z.ZodTypeAny;
  inputSchema: Record<string, unknown>;
  run: (p: McpPrincipal, args: any) => Promise<unknown>;
};

const id = z.string().uuid();
const str = (max: number) => z.string().trim().min(1).max(max);
const limit = z.number().int().min(1).max(50).default(20);

const companyPublicSelect = {
  id: true,
  name: true,
  status: true,
  industry: true,
  website: true,
  mainContactName: true,
  mainContactEmail: true,
  mainContactPhone: true,
  city: true,
  state: true,
  formattedAddress: true,
  notes: true,
  assignedSalesman: { select: { fullName: true } },
  assignedProjectManager: { select: { fullName: true } },
} satisfies Prisma.CompanySelect;

async function companyScoped(p: McpPrincipal, companyId: string) {
  const c = await prisma.company.findFirst({
    where: { AND: [{ id: companyId }, await companyWhereForUser(p.user)] },
    select: companyPublicSelect,
  });
  // Same message for missing and forbidden: no existence oracle.
  if (!c) throw new ToolError('Company not found');
  return c;
}

const dollars = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);

export const tools: Tool[] = [
  {
    name: 'whoami',
    description: 'Show who this token belongs to, the role, and which scopes it has.',
    scope: 'read',
    input: z.object({}).strict(),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (p) => ({
      name: p.user.fullName,
      email: p.user.email,
      role: p.user.role,
      scopes: [...p.scopes],
    }),
  },
  {
    name: 'list_clients',
    description:
      'List DK client companies you have access to. Optional name search and status filter (active, inactive, prospect).',
    scope: 'read',
    input: z.object({ search: str(100).optional(), status: z.enum(['active', 'inactive', 'prospect']).optional() }).strict(),
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Part of the company name' },
        status: { type: 'string', enum: ['active', 'inactive', 'prospect'] },
      },
      additionalProperties: false,
    },
    run: async (p, a) => {
      const rows = await prisma.company.findMany({
        where: {
          AND: [
            await companyWhereForUser(p.user),
            a.search ? { name: { contains: a.search } } : {},
            a.status ? { status: a.status } : {},
          ],
        },
        select: { id: true, name: true, status: true, industry: true, website: true, city: true, state: true },
        orderBy: { name: 'asc' },
        take: 200,
      });
      return rows;
    },
  },
  {
    name: 'get_client',
    description:
      'Full client profile: contact info, address, internal notes/profile, assigned salesman + PM, active projects, and the list of call transcripts (titles + dates).',
    scope: 'read',
    input: z.object({ company_id: id }).strict(),
    inputSchema: {
      type: 'object',
      properties: { company_id: { type: 'string', format: 'uuid' } },
      required: ['company_id'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      const company = await companyScoped(p, a.company_id);
      const [projects, transcripts, services] = await Promise.all([
        prisma.project.findMany({
          where: { AND: [{ companyId: a.company_id }, await projectWhereForUser(p.user)] },
          select: { id: true, name: true, status: true, priority: true, dueDate: true },
          orderBy: { updatedAt: 'desc' },
          take: 25,
        }),
        prisma.callTranscription.findMany({
          where: { companyId: a.company_id },
          select: { id: true, title: true, callDate: true },
          orderBy: [{ callDate: 'desc' }, { createdAt: 'desc' }],
          take: 50,
        }),
        prisma.companyMonthlyService.findMany({
          where: { companyId: a.company_id, status: { not: 'cancelled' } },
          select: { serviceCategory: true, label: true, status: true },
        }),
      ]);
      return { ...company, services, projects, transcripts };
    },
  },
  {
    name: 'search_transcripts',
    description:
      'Search call transcripts (Granola meetings) by keyword across the clients you can access. Returns matching calls with a short snippet around the first hit.',
    scope: 'read',
    input: z.object({ query: str(100), company_id: id.optional(), limit }).strict(),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Word or phrase to find' },
        company_id: { type: 'string', format: 'uuid', description: 'Limit to one client' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      const rows = await prisma.callTranscription.findMany({
        where: {
          AND: [
            { company: await companyWhereForUser(p.user) },
            a.company_id ? { companyId: a.company_id } : {},
            { OR: [{ title: { contains: a.query } }, { transcript: { contains: a.query } }] },
          ],
        },
        select: { id: true, title: true, callDate: true, transcript: true, company: { select: { id: true, name: true } } },
        orderBy: { callDate: 'desc' },
        take: a.limit,
      });
      const q = a.query.toLowerCase();
      return rows.map(({ transcript, ...r }) => {
        const i = transcript.toLowerCase().indexOf(q);
        const snippet = i < 0 ? transcript.slice(0, 240) : transcript.slice(Math.max(0, i - 160), i + 240);
        return { ...r, snippet: snippet.replace(/\s+/g, ' ').trim() };
      });
    },
  },
  {
    name: 'get_transcript',
    description:
      'Read one call transcript. Long transcripts are paged: pass offset (characters) to continue where the last page ended.',
    scope: 'read',
    input: z.object({ transcript_id: id, offset: z.number().int().min(0).default(0) }).strict(),
    inputSchema: {
      type: 'object',
      properties: {
        transcript_id: { type: 'string', format: 'uuid' },
        offset: { type: 'integer', minimum: 0, default: 0 },
      },
      required: ['transcript_id'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      const t = await prisma.callTranscription.findFirst({
        where: { AND: [{ id: a.transcript_id }, { company: await companyWhereForUser(p.user) }] },
        select: { id: true, title: true, callDate: true, transcript: true, company: { select: { id: true, name: true } } },
      });
      if (!t) throw new ToolError('Transcript not found');
      const PAGE = 40_000;
      const text = t.transcript.slice(a.offset, a.offset + PAGE);
      const next = a.offset + PAGE < t.transcript.length ? a.offset + PAGE : null;
      return { id: t.id, title: t.title, callDate: t.callDate, company: t.company, totalChars: t.transcript.length, offset: a.offset, nextOffset: next, text };
    },
  },
  {
    name: 'list_tasks',
    description:
      'List open portal tasks you can access. Filter by client, by assignee ("me" for your own), or status. Archived and complete tasks are excluded unless include_complete is true.',
    scope: 'read',
    input: z
      .object({
        company_id: id.optional(),
        assignee: z.union([z.literal('me'), id]).optional(),
        status: z.enum(['backlog', 'todo', 'in_progress', 'waiting_on_client', 'internal_review', 'client_review', 'complete']).optional(),
        include_complete: z.boolean().default(false),
        limit,
      })
      .strict(),
    inputSchema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', format: 'uuid' },
        assignee: { type: 'string', description: '"me" or a user id' },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'waiting_on_client', 'internal_review', 'client_review', 'complete'] },
        include_complete: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      additionalProperties: false,
    },
    run: async (p, a) => {
      const assignee = a.assignee === 'me' ? p.user.id : a.assignee;
      return prisma.task.findMany({
        where: {
          AND: [
            await taskWhereForUser(p.user),
            activeTaskWhere,
            a.company_id ? { companyId: a.company_id } : {},
            assignee ? { assignedTo: assignee } : {},
            a.status ? { status: a.status } : a.include_complete ? {} : { status: { not: 'complete' } },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          clientVisible: true,
          company: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, fullName: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
        take: a.limit,
      });
    },
  },
  {
    name: 'list_team',
    description: 'List active DK staff (name, email, role) so tasks can be assigned to the right person.',
    scope: 'read',
    input: z.object({}).strict(),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () =>
      prisma.user.findMany({
        where: { isActive: true, role: { not: 'client' } },
        select: { id: true, fullName: true, email: true, role: true },
        orderBy: { fullName: 'asc' },
      }),
  },
  {
    name: 'get_revenue',
    description:
      'ADMIN ONLY. Monthly recurring revenue by client: each active/paused service with client price, salesman payout, and contractor costs, plus totals and net.',
    scope: 'read',
    adminOnly: true,
    input: z.object({ company_id: id.optional() }).strict(),
    inputSchema: {
      type: 'object',
      properties: { company_id: { type: 'string', format: 'uuid' } },
      additionalProperties: false,
    },
    run: async (_p, a) => {
      const rows = await prisma.companyMonthlyService.findMany({
        where: { status: { not: 'cancelled' }, ...(a.company_id ? { companyId: a.company_id } : {}) },
        select: {
          serviceCategory: true,
          label: true,
          status: true,
          monthlyAmountCents: true,
          salesmanPayoutCents: true,
          company: { select: { id: true, name: true } },
          expenses: { select: { vendor: true, name: true, amountCents: true } },
        },
        orderBy: { company: { name: 'asc' } },
      });
      let income = 0, payouts = 0, contractors = 0;
      const services = rows.map((r) => {
        const exp = r.expenses.reduce((s, e) => s + e.amountCents, 0);
        if (r.status === 'active') {
          income += r.monthlyAmountCents;
          payouts += r.salesmanPayoutCents ?? 0;
          contractors += exp;
        }
        return {
          client: r.company.name,
          service: r.label || r.serviceCategory,
          status: r.status,
          price: dollars(r.monthlyAmountCents),
          salesSplit: dollars(r.salesmanPayoutCents),
          contractors: r.expenses.map((e) => ({ vendor: e.vendor || e.name, amount: dollars(e.amountCents) })),
        };
      });
      return {
        totalsActive: {
          income: dollars(income),
          salesSplit: dollars(payouts),
          contractorExpenses: dollars(contractors),
          fullExpense: dollars(payouts + contractors),
          netProfit: dollars(income - payouts - contractors),
        },
        services,
      };
    },
  },

  // ---------------------------------------------------------------- write
  {
    name: 'list_tickets',
    description:
      'List client support tickets you can see. Filter by status ("active", "closed" or a status key), assignee ("me"/"none"/user id), priority, category, breached SLA, or search text / "#1042".',
    scope: 'read',
    input: z
      .object({
        status: z.string().max(40).optional(),
        assignee: z.string().max(40).optional(),
        priority: z.enum(PRIORITY_KEYS).optional(),
        category: z.enum(CATEGORY_KEYS).optional(),
        breached: z.boolean().optional(),
        q: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      })
      .strict(),
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '"active" (default view), "closed", or new/open/in_progress/waiting_on_client/resolved/closed' },
        assignee: { type: 'string', description: '"me", "none", or a user id' },
        priority: { type: 'string', enum: [...PRIORITY_KEYS] },
        category: { type: 'string', enum: [...CATEGORY_KEYS] },
        breached: { type: 'boolean', description: 'Only tickets past their SLA' },
        q: { type: 'string' },
        limit: { type: 'integer', default: 25, maximum: 100 },
      },
      additionalProperties: false,
    },
    run: async (p, a) => {
      const { rows, total } = await ticketSvc.listTickets(p.user, {
        status: a.status ?? 'active',
        assigneeId: a.assignee,
        priority: a.priority,
        category: a.category,
        breached: a.breached,
        q: a.q,
        page: 1,
        limit: a.limit,
      });
      return { total, tickets: rows };
    },
  },
  {
    name: 'get_ticket',
    description: 'Full ticket with its timeline (replies, internal notes, status changes). Accepts id or number.',
    scope: 'read',
    input: z.object({ ticket: z.string().max(40) }).strict(),
    inputSchema: {
      type: 'object',
      properties: { ticket: { type: 'string', description: 'Ticket id or number (e.g. 1042)' } },
      required: ['ticket'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      const t = await ticketSvc.getTicketForUser(p.user, a.ticket.replace('#', ''));
      return { ticket: ticketSvc.presentTicket(t, p.user), timeline: await ticketSvc.listEvents(p.user, t.id) };
    },
  },
  {
    name: 'reply_to_ticket',
    description:
      'Reply to a ticket. internal=true adds a team-only note (client never sees it). The client is notified of public replies. Optionally set the status at the same time.',
    scope: 'write',
    input: z
      .object({
        ticket: z.string().max(40),
        body: z.string().min(1).max(20000),
        internal: z.boolean().default(false),
        status: z.enum(STATUS_KEYS).optional(),
      })
      .strict(),
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string' },
        body: { type: 'string', maxLength: 20000 },
        internal: { type: 'boolean', default: false, description: 'Team-only note' },
        status: { type: 'string', enum: [...STATUS_KEYS] },
      },
      required: ['ticket', 'body'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      const t = await ticketSvc.getTicketForUser(p.user, a.ticket.replace('#', ''));
      await ticketSvc.addComment(p.user, t.id, { body: a.body, internal: a.internal, status: a.status });
      return { ok: true, number: t.number };
    },
  },
  {
    name: 'update_ticket',
    description: 'Change a ticket\'s status, priority, category or assignee (user id from list_team, or null to unassign).',
    scope: 'write',
    input: z
      .object({
        ticket: z.string().max(40),
        status: z.enum(STATUS_KEYS).optional(),
        priority: z.enum(PRIORITY_KEYS).optional(),
        category: z.enum(CATEGORY_KEYS).optional(),
        assignee_id: id.nullable().optional(),
      })
      .strict(),
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string' },
        status: { type: 'string', enum: [...STATUS_KEYS] },
        priority: { type: 'string', enum: [...PRIORITY_KEYS] },
        category: { type: 'string', enum: [...CATEGORY_KEYS] },
        assignee_id: { type: ['string', 'null'], format: 'uuid' },
      },
      required: ['ticket'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      const t = await ticketSvc.getTicketForUser(p.user, a.ticket.replace('#', ''));
      const u = await ticketSvc.updateTicket(p.user, t.id, {
        status: a.status,
        priority: a.priority,
        category: a.category,
        assigneeId: a.assignee_id,
      });
      return ticketSvc.presentTicket(u, p.user);
    },
  },
  {
    name: 'create_task',
    description:
      'Create an internal portal task (never client-visible from MCP). Optionally attach to a client and assign to a teammate.',
    scope: 'write',
    input: z
      .object({
        title: str(200),
        description: z.string().max(5000).optional(),
        company_id: id.optional(),
        assigned_to: id.optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .strict(),
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        description: { type: 'string', maxLength: 5000 },
        company_id: { type: 'string', format: 'uuid' },
        assigned_to: { type: 'string', format: 'uuid', description: 'User id from list_team' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      if (a.company_id) await companyScoped(p, a.company_id);
      if (a.assigned_to) {
        const u = await prisma.user.findFirst({ where: { id: a.assigned_to, isActive: true, role: { not: 'client' } } });
        if (!u) throw new ToolError('Assignee must be an active DK staff user');
      }
      const t = await prisma.task.create({
        data: {
          title: a.title,
          description: a.description,
          companyId: a.company_id ?? null,
          assignedTo: a.assigned_to ?? null,
          priority: a.priority,
          status: 'todo',
          dueDate: a.due_date ? new Date(`${a.due_date}T12:00:00.000Z`) : undefined,
          clientVisible: false,
          createdBy: p.user.id,
        },
        select: { id: true, title: true, status: true, priority: true, dueDate: true },
      });
      return t;
    },
  },
  {
    name: 'update_task_status',
    description: 'Move a task you can access to a new status.',
    scope: 'write',
    input: z
      .object({
        task_id: id,
        status: z.enum(['backlog', 'todo', 'in_progress', 'waiting_on_client', 'internal_review', 'client_review', 'complete']),
      })
      .strict(),
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'waiting_on_client', 'internal_review', 'client_review', 'complete'] },
      },
      required: ['task_id', 'status'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      const t = await prisma.task.findFirst({ where: { AND: [{ id: a.task_id }, await taskWhereForUser(p.user)] }, select: { id: true } });
      if (!t) throw new ToolError('Task not found');
      return prisma.task.update({ where: { id: a.task_id }, data: { status: a.status }, select: { id: true, title: true, status: true } });
    },
  },
  {
    name: 'add_internal_note',
    description: 'Add an internal (staff-only, never client-visible) note to a client.',
    scope: 'write',
    input: z.object({ company_id: id, note: str(5000) }).strict(),
    inputSchema: {
      type: 'object',
      properties: { company_id: { type: 'string', format: 'uuid' }, note: { type: 'string', maxLength: 5000 } },
      required: ['company_id', 'note'],
      additionalProperties: false,
    },
    run: async (p, a) => {
      await companyScoped(p, a.company_id);
      return prisma.internalNote.create({
        data: { companyId: a.company_id, note: a.note, createdBy: p.user.id },
        select: { id: true, createdAt: true },
      });
    },
  },
];

/** Tools this principal may see/call. Hidden tools are simply absent (not listed). */
export function toolsFor(p: McpPrincipal): Tool[] {
  return tools.filter((t) => p.scopes.has(t.scope) && (!t.adminOnly || p.user.role === 'admin'));
}
