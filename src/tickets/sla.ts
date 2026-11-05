import type { Ticket } from '@prisma/client';
import { statusKind } from './config';

export type SlaState = 'ok' | 'due_soon' | 'breached' | 'paused' | 'met' | 'none';

const SOON_MS = 2 * 3_600_000;

function stateFor(due: Date | null, doneAt: Date | null, now: Date): SlaState {
  if (!due) return 'none';
  if (doneAt) return doneAt <= due ? 'met' : 'breached';
  if (now > due) return 'breached';
  return due.getTime() - now.getTime() < SOON_MS ? 'due_soon' : 'ok';
}

/** Derived SLA status. Pure function — no DB — so it's trivially testable and reusable. */
export function computeSla(t: Pick<Ticket, 'status' | 'firstResponseDueAt' | 'firstResponseAt' | 'resolutionDueAt' | 'resolvedAt'>, now = new Date()) {
  const kind = statusKind(t.status);
  return {
    firstResponse: stateFor(t.firstResponseDueAt, t.firstResponseAt, now),
    resolution: kind === 'pending' ? ('paused' as const) : stateFor(t.resolutionDueAt, t.resolvedAt, now),
  };
}
