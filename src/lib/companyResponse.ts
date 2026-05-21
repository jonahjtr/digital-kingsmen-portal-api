/** Strip storage key from API payloads; expose hasLogo for UI. */
export function mapCompanyLogoFields<T extends { logoUrl?: string | null; notes?: string | null }>(
  company: T,
  stripNotes?: boolean,
) {
  const { logoUrl, notes, ...rest } = company;
  const base = stripNotes ? rest : { ...rest, notes };
  return { ...base, hasLogo: !!logoUrl };
}

export function mapNestedCompanyLogo<T extends { logoUrl?: string | null } | null | undefined>(
  company: T,
): T extends { logoUrl?: string | null } ? Omit<T, 'logoUrl'> & { hasLogo: boolean } : T {
  if (!company) return company as never;
  const { logoUrl, ...rest } = company;
  return { ...rest, hasLogo: !!logoUrl } as never;
}
