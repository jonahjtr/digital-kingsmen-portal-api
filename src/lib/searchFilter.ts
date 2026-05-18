/** D1/SQLite does not support Prisma `mode: 'insensitive'`. */
export function textContains(value: string) {
  return { contains: value };
}
