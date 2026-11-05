/**
 * Ticket configuration — the ONE place to add categories, statuses, priorities or SLA rules.
 * Values are stored as plain strings, so adding/renaming here needs no DB migration.
 * The frontend reads this via GET /api/tickets/config, so it updates automatically too.
 */

export type StatusKind = 'open' | 'pending' | 'closed';

export const TICKET_STATUSES = [
  { key: 'new', label: 'New', kind: 'open' },
  { key: 'open', label: 'Open', kind: 'open' },
  { key: 'in_progress', label: 'In progress', kind: 'open' },
  // "pending" statuses pause the resolution SLA clock (we're waiting on someone else).
  { key: 'waiting_on_client', label: 'Waiting on you', kind: 'pending', staffLabel: 'Waiting on client' },
  { key: 'resolved', label: 'Resolved', kind: 'closed' },
  { key: 'closed', label: 'Closed', kind: 'closed' },
] as const satisfies ReadonlyArray<{ key: string; label: string; kind: StatusKind; staffLabel?: string }>;

export const TICKET_PRIORITIES = [
  // SLA targets in business-agnostic hours (calendar hours; ponytail: no business-hours calendar yet —
  // add one in sla.ts if clients start counting weekends against us).
  { key: 'urgent', label: 'Urgent', firstResponseHours: 2, resolutionHours: 24, rank: 0 },
  { key: 'high', label: 'High', firstResponseHours: 4, resolutionHours: 48, rank: 1 },
  { key: 'normal', label: 'Normal', firstResponseHours: 24, resolutionHours: 120, rank: 2 },
  { key: 'low', label: 'Low', firstResponseHours: 48, resolutionHours: 240, rank: 3 },
] as const;

export const TICKET_CATEGORIES = [
  { key: 'website_change', label: 'Website change', defaultPriority: 'normal', hint: 'Text, photos, pages, menus' },
  { key: 'website_bug', label: 'Website problem', defaultPriority: 'high', hint: 'Something is broken or down' },
  { key: 'ads', label: 'Google / Facebook ads', defaultPriority: 'normal', hint: 'Campaigns, budget, leads' },
  { key: 'seo', label: 'SEO & Google listing', defaultPriority: 'normal', hint: 'Rankings, Google Business Profile, reviews' },
  { key: 'social', label: 'Social media', defaultPriority: 'normal', hint: 'Posts, content, accounts' },
  { key: 'crm', label: 'CRM, forms & automations', defaultPriority: 'normal', hint: 'Leads not coming in, texts, emails' },
  { key: 'billing', label: 'Billing', defaultPriority: 'normal', hint: 'Invoices, payments' },
  { key: 'other', label: 'Something else', defaultPriority: 'normal', hint: '' },
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number]['key'];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]['key'];
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]['key'];

export const STATUS_KEYS = TICKET_STATUSES.map((s) => s.key) as [TicketStatus, ...TicketStatus[]];
export const PRIORITY_KEYS = TICKET_PRIORITIES.map((p) => p.key) as [TicketPriority, ...TicketPriority[]];
export const CATEGORY_KEYS = TICKET_CATEGORIES.map((c) => c.key) as [TicketCategory, ...TicketCategory[]];

export const statusKind = (s: string): StatusKind =>
  TICKET_STATUSES.find((x) => x.key === s)?.kind ?? 'open';
export const priorityOf = (p: string) => TICKET_PRIORITIES.find((x) => x.key === p) ?? TICKET_PRIORITIES[2];

/** Clients may only move a ticket to these (reopen / mark solved). Staff can set anything. */
export const CLIENT_SETTABLE_STATUSES: TicketStatus[] = ['open', 'resolved'];

/** Days after "resolved" with no activity before auto-close (run by the scheduled job). */
export const AUTO_CLOSE_DAYS = 7;

export function publicConfig(isStaff: boolean) {
  return {
    statuses: TICKET_STATUSES.map((s) => ({
      key: s.key,
      label: isStaff && 'staffLabel' in s ? s.staffLabel : s.label,
      kind: s.kind,
    })),
    priorities: TICKET_PRIORITIES.map(({ key, label, firstResponseHours, resolutionHours }) => ({
      key,
      label,
      ...(isStaff ? { firstResponseHours, resolutionHours } : {}),
    })),
    categories: TICKET_CATEGORIES,
    clientSettableStatuses: CLIENT_SETTABLE_STATUSES,
  };
}
