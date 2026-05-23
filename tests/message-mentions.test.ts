import { describe, it, expect } from 'vitest';
import { resolveMentionedUserIds } from '../src/services/message-mentions.service';

const members = [
  { userId: 'staff-1', user: { id: 'staff-1', role: 'admin', fullName: 'Admin' } },
  { userId: 'staff-2', user: { id: 'staff-2', role: 'employee', fullName: 'Employee' } },
  { userId: 'client-1', user: { id: 'client-1', role: 'client', fullName: 'Client' } },
];

describe('resolveMentionedUserIds', () => {
  it('returns empty when no ids requested', () => {
    expect(resolveMentionedUserIds(undefined, members, 'staff-1', false)).toEqual([]);
  });

  it('keeps only conversation members and excludes sender', () => {
    expect(
      resolveMentionedUserIds(
        ['staff-2', 'staff-1', 'unknown', 'staff-2'],
        members,
        'staff-1',
        false,
      ),
    ).toEqual(['staff-2']);
  });

  it('drops client mentions on internal-only messages', () => {
    expect(
      resolveMentionedUserIds(['client-1', 'staff-2'], members, 'staff-1', true),
    ).toEqual(['staff-2']);
  });
});
