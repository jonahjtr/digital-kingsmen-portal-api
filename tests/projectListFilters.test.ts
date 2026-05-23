import { describe, expect, it } from 'vitest';
import { projectListStatusWhere, resolveProjectSortField } from '../src/lib/projectListFilters';

describe('projectListStatusWhere', () => {
  it('maps completed to complete', () => {
    expect(projectListStatusWhere('completed')).toEqual({ status: 'complete' });
  });

  it('maps active to in-flight statuses', () => {
    expect(projectListStatusWhere('active')).toEqual({
      status: {
        in: [
          'not_started',
          'in_progress',
          'waiting_on_client',
          'internal_review',
          'client_review',
        ],
      },
    });
  });

  it('returns empty set for archived without throwing', () => {
    expect(projectListStatusWhere('archived')).toEqual({ status: { in: [] } });
  });

  it('passes through valid project statuses', () => {
    expect(projectListStatusWhere('paused')).toEqual({ status: 'paused' });
  });

  it('ignores unknown status values', () => {
    expect(projectListStatusWhere('bogus')).toBeUndefined();
  });
});

describe('resolveProjectSortField', () => {
  it('falls back to createdAt for invalid sort fields', () => {
    expect(resolveProjectSortField('archivedAt')).toBe('createdAt');
  });

  it('keeps valid sort fields', () => {
    expect(resolveProjectSortField('dueDate')).toBe('dueDate');
  });
});
