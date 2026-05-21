import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertNotClient, stripClientForbiddenFields } from '../permissions/access';
import { companyWhereForUser } from '../permissions/filters';
import { textContains } from '../lib/searchFilter';
import { enrichCompanyFromWebsite } from '../services/company-enrichment';
import { previewToSnapshot } from '../services/company-enrichment/enrichmentSnapshot';
import { normalizeWebsiteUrl } from '../services/company-enrichment/normalizeUrl';
import { getStorageProvider } from '../storage';
import { mapCompanyLogoFields } from '../lib/companyResponse';
import type { CompanyEnrichmentPreview } from '../services/company-enrichment/types';
import { STAFF_ASSIGNMENT_INCLUDE } from '../services/companyStaffAssignments';
import { createCompanyWithRelations } from '../services/companyCreate';
import {
  deleteStoredCompanyLogo,
  importLogoForCompany,
  saveCompanyLogo,
} from '../services/companyLogo';
import type { AssignmentInput } from '../services/companyStaffAssignments';

function mapCompanyBody(body: Record<string, unknown>) {
  const enrichmentApplied = Boolean(body.enrichment_applied);
  const data: Record<string, unknown> = {
    name: body.name as string,
    website: body.website as string | undefined,
    googleBusinessUrl: body.google_business_url as string | undefined,
    industry: body.industry as string | undefined,
    mainContactName: body.main_contact_name as string | undefined,
    mainContactEmail: (body.main_contact_email as string) || undefined,
    mainContactPhone: body.main_contact_phone as string | undefined,
    addressLine1: body.address_line1 as string | undefined,
    addressLine2: body.address_line2 as string | undefined,
    city: body.city as string | undefined,
    state: body.state as string | undefined,
    postalCode: body.postal_code as string | undefined,
    country: body.country as string | undefined,
    formattedAddress: body.formatted_address as string | undefined,
    assignedSalesmanId: body.assigned_salesman_id as string | undefined,
    assignedProjectManagerId: body.assigned_project_manager_id as string | undefined,
    status: body.status as 'active' | 'inactive' | 'prospect' | undefined,
    notes: body.notes as string | undefined,
  };
  if (enrichmentApplied) {
    data.enrichmentSource = (body.enrichment_source as string) || 'website';
    data.enrichedAt = new Date();
    if (typeof body.website === 'string' && body.website.trim()) {
      try {
        data.lastEnrichmentWebsite = normalizeWebsiteUrl(body.website);
      } catch {
        /* keep existing last enrichment website on invalid URL */
      }
    }
    const snapshot = body.enrichment_snapshot;
    if (typeof snapshot === 'string' && snapshot.trim()) {
      data.enrichmentSnapshot = snapshot;
    } else if (snapshot && typeof snapshot === 'object') {
      data.enrichmentSnapshot = previewToSnapshot(snapshot as CompanyEnrichmentPreview);
    }
  }
  return data;
}

function assertEnrichRole(user: { role: string }) {
  if (user.role === 'client' || user.role === 'salesman') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Not allowed to enrich companies', 403);
  }
}

function assertCanMutateCompanyLogo(user: { role: string }) {
  if (user.role !== 'admin' && user.role !== 'employee') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Not allowed to change company logo', 403);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, search, status, sortBy, sortOrder } = parsePagination(req.query);
    const scope = await companyWhereForUser(req.user!);
    const where = {
      ...scope,
      ...(status ? { status: status as 'active' | 'inactive' | 'prospect' } : {}),
      ...(search ? { name: textContains(search) } : {}),
    };
    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          assignedSalesman: { select: { id: true, fullName: true, email: true } },
          assignedProjectManager: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.company.count({ where }),
    ]);
    const data = companies.map((c) =>
      mapCompanyLogoFields(c, req.user!.role === 'client'),
    );
    return success(res, data, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessCompany(req.user!, getParam(req, 'id'));
    const company = await prisma.company.findUnique({
      where: { id: getParam(req, 'id') },
      include: {
        assignedSalesman: { select: { id: true, fullName: true, email: true } },
        assignedProjectManager: { select: { id: true, fullName: true, email: true } },
        staffAssignments: {
          include: STAFF_ASSIGNMENT_INCLUDE,
          orderBy: [{ staffTag: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
        },
        projects: { select: { id: true, name: true, status: true, overallProgress: true } },
      },
    });
    if (!company) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    return success(res, mapCompanyLogoFields(company, req.user!.role === 'client'));
  } catch (err) {
    next(err);
  }
}

export async function enrichPreview(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    assertEnrichRole(req.user!);
    const companyId = req.body.company_id as string | undefined;
    if (companyId) {
      await assertCanAccessCompany(req.user!, companyId);
    }
    const preview = await enrichCompanyFromWebsite(req.user!.id, {
      website: req.body.website as string,
      google_business_url: req.body.google_business_url as string | undefined,
      company_id: companyId,
      force: Boolean(req.body.force),
      persist: req.body.persist !== false,
    });
    return success(res, preview);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Too many enrichment')) {
      return next(new AppError(ErrorCodes.NUDGE_RATE_LIMITED, err.message, 429));
    }
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    if (req.user!.role === 'salesman') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Salesmen cannot create companies', 403);
    }
    const body = req.body as Record<string, unknown>;
    const staffAssignments = body.staff_assignments as AssignmentInput[] | undefined;
    const importLogoFromUrl = body.import_logo_from_url as string | undefined;
    const company = await createCompanyWithRelations({
      companyData: mapCompanyBody(body) as Parameters<typeof prisma.company.create>[0]['data'],
      staffAssignments,
      importLogoFromUrl,
    });
    return created(res, mapCompanyLogoFields(company));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessCompany(req.user!, getParam(req, 'id'));
    assertNotClient(req.user!);
    const body = stripClientForbiddenFields(req.body, req.user!, ['notes']);
    const company = await prisma.company.update({
      where: { id: getParam(req, 'id') },
      data: mapCompanyBody(body) as Parameters<typeof prisma.company.update>[0]['data'],
    });
    return success(res, mapCompanyLogoFields(company));
  } catch (err) {
    next(err);
  }
}

export async function getLogo(req: Request, res: Response, next: NextFunction) {
  try {
    const id = getParam(req, 'id');
    await assertCanAccessCompany(req.user!, id);
    const company = await prisma.company.findUnique({
      where: { id },
      select: { logoUrl: true, logoMimeType: true },
    });
    if (!company?.logoUrl) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Logo not found', 404);
    }
    const storage = getStorageProvider();
    if (!storage.get) {
      throw new AppError(ErrorCodes.INTERNAL_ERROR, 'Storage provider does not support downloads', 500);
    }
    const object = await storage.get(company.logoUrl);
    if (!object) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Logo not found', 404);
    }
    res.setHeader('Content-Type', company.logoMimeType || object.mimeType || 'image/png');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(Buffer.from(object.body));
  } catch (err) {
    next(err);
  }
}

export async function uploadLogo(req: Request, res: Response, next: NextFunction) {
  try {
    const id = getParam(req, 'id');
    await assertCanAccessCompany(req.user!, id);
    assertNotClient(req.user!);
    assertCanMutateCompanyLogo(req.user!);

    const multerFile = req.file;
    if (!multerFile) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No file uploaded', 400);
    }
    const company = await saveCompanyLogo(
      id,
      multerFile.buffer,
      multerFile.mimetype,
      multerFile.originalname,
      multerFile.size,
      null,
    );
    return success(res, mapCompanyLogoFields(company));
  } catch (err) {
    next(err);
  }
}

export async function importLogoFromUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const id = getParam(req, 'id');
    await assertCanAccessCompany(req.user!, id);
    assertNotClient(req.user!);
    assertCanMutateCompanyLogo(req.user!);

    const url = req.body.url as string;
    const updated = await importLogoForCompany(id, url);
    return success(res, mapCompanyLogoFields(updated));
  } catch (err) {
    next(err);
  }
}

export async function removeLogo(req: Request, res: Response, next: NextFunction) {
  try {
    const id = getParam(req, 'id');
    await assertCanAccessCompany(req.user!, id);
    assertNotClient(req.user!);
    assertCanMutateCompanyLogo(req.user!);

    const existing = await prisma.company.findUnique({
      where: { id },
      select: { logoUrl: true },
    });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    if (!existing.logoUrl) {
      return success(res, { hasLogo: false });
    }

    await deleteStoredCompanyLogo(existing.logoUrl);
    const company = await prisma.company.update({
      where: { id },
      data: { logoUrl: null, logoMimeType: null, logoSourceUrl: null },
    });

    return success(res, mapCompanyLogoFields(company));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    if (req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Only admins can delete companies', 403);
    }
    await prisma.company.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
