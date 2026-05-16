import { User, UserRole } from '@prisma/client';

export type AuthUser = Pick<User, 'id' | 'email' | 'fullName' | 'phone' | 'role' | 'avatarUrl' | 'isActive' | 'createdAt' | 'updatedAt'>;

export function sanitizeUser(user: User): AuthUser {
  const { passwordHash: _, ...safe } = user;
  return safe;
}

export function stripInternalProjectFields<T extends Record<string, unknown>>(
  project: T,
  role: UserRole,
): T {
  if (role === 'client') {
    const { internalNotes, ...rest } = project;
    return rest as T;
  }
  return project;
}
