import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import {
  replaceCompanyStaffAssignments,
  STAFF_ASSIGNMENT_INCLUDE,
  type AssignmentInput,
} from './companyStaffAssignments';
import { importLogoForCompany } from './companyLogo';

const companyWithRelationsInclude = {
  assignedSalesman: { select: { id: true, fullName: true, email: true } },
  assignedProjectManager: { select: { id: true, fullName: true, email: true } },
  staffAssignments: {
    include: STAFF_ASSIGNMENT_INCLUDE,
    orderBy: [{ staffTag: { sortOrder: 'asc' as const } }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.CompanyInclude;

export type CreateCompanyWithRelationsInput = {
  companyData: Prisma.CompanyCreateInput;
  staffAssignments?: AssignmentInput[];
  importLogoFromUrl?: string;
};

export async function createCompanyWithRelations(input: CreateCompanyWithRelationsInput) {
  const company = await prisma.company.create({ data: input.companyData });

  try {
    if (input.staffAssignments && input.staffAssignments.length > 0) {
      await replaceCompanyStaffAssignments(company.id, input.staffAssignments);
    }
    if (input.importLogoFromUrl?.trim()) {
      await importLogoForCompany(company.id, input.importLogoFromUrl.trim());
    }

    return prisma.company.findUniqueOrThrow({
      where: { id: company.id },
      include: companyWithRelationsInclude,
    });
  } catch (err) {
    await prisma.company.delete({ where: { id: company.id } }).catch(() => undefined);
    throw err;
  }
}
