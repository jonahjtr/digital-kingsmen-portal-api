import { Request, Response, NextFunction } from 'express';
import { GbpPostStatus, GbpPostType, Prisma } from '@prisma/client';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import { assertCanAccessCompany, assertNotClient } from '../permissions/access';
import { companyWhereForUser } from '../permissions/filters';
import { textContains } from '../lib/searchFilter';

const locationSelect = {
  id: true,
  companyId: true,
  name: true,
  googleBusinessUrl: true,
  formattedAddress: true,
  isPrimary: true,
  sortOrder: true,
  externalLocationId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const postInclude = {
  company: { select: { id: true, name: true, status: true } },
  locations: {
    include: {
      location: { select: locationSelect },
    },
  },
  createdBy: { select: { id: true, fullName: true, email: true } },
} as const;

function serializeLocation(row: {
  id: string;
  companyId: string;
  name: string;
  googleBusinessUrl: string | null;
  formattedAddress: string | null;
  isPrimary: boolean;
  sortOrder: number;
  externalLocationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return row;
}

function serializePost(row: {
  id: string;
  companyId: string;
  postCode: string;
  status: GbpPostStatus;
  postType: GbpPostType;
  topic: string | null;
  description: string;
  ctaType: string | null;
  ctaUrl: string | null;
  imageUrl: string | null;
  imageGuidance: string | null;
  linkedContentUrl: string | null;
  notes: string | null;
  postedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  company?: { id: string; name: string; status: string };
  createdBy?: { id: string; fullName: string; email: string } | null;
  locations?: { location: Parameters<typeof serializeLocation>[0] }[];
}) {
  const { locations, ...rest } = row;
  return {
    ...rest,
    locations: (locations ?? []).map((link) => serializeLocation(link.location)),
  };
}

async function getPostIfAccessible(req: Request, id: string) {
  const existing = await prisma.gbpPost.findUnique({
    where: { id },
    include: postInclude,
  });
  if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'GBP post not found', 404);
  await assertCanAccessCompany(req.user!, existing.companyId);
  return existing;
}

async function assertLocationsBelongToCompany(companyId: string, locationIds: string[]) {
  const uniqueIds = [...new Set(locationIds)];
  const count = await prisma.gbpLocation.count({
    where: { companyId, id: { in: uniqueIds } },
  });
  if (count !== uniqueIds.length) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'One or more location_ids do not belong to this company',
      400,
    );
  }
  return uniqueIds;
}

async function replacePostLocations(postId: string, locationIds: string[]) {
  await prisma.gbpPostLocation.deleteMany({ where: { postId } });
  await prisma.gbpPostLocation.createMany({
    data: locationIds.map((locationId) => ({
      id: crypto.randomUUID(),
      postId,
      locationId,
    })),
  });
}

export async function listSeoClients(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyScope = await companyWhereForUser(req.user!);
    const companies = await prisma.company.findMany({
      where: {
        AND: [
          companyScope,
          {
            monthlyServices: {
              some: { serviceCategory: 'seo', status: 'active' },
            },
          },
        ],
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        website: true,
        googleBusinessUrl: true,
        gbpLocations: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: locationSelect,
        },
      },
    });
    return success(
      res,
      companies.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        website: c.website,
        googleBusinessUrl: c.googleBusinessUrl,
        locations: c.gbpLocations.map(serializeLocation),
      })),
    );
  } catch (err) {
    next(err);
  }
}

export async function listLocationsForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyId = getParam(req, 'companyId');
    await assertCanAccessCompany(req.user!, companyId);
    const rows = await prisma.gbpLocation.findMany({
      where: { companyId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return success(res, rows.map(serializeLocation));
  } catch (err) {
    next(err);
  }
}

export async function createLocationForCompany(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyId = getParam(req, 'companyId');
    await assertCanAccessCompany(req.user!, companyId);
    const body = req.body as Record<string, unknown>;
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);

    const isPrimary = body.is_primary === true;
    if (isPrimary) {
      await prisma.gbpLocation.updateMany({
        where: { companyId },
        data: { isPrimary: false },
      });
    }

    const row = await prisma.gbpLocation.create({
      data: {
        companyId,
        name: body.name as string,
        googleBusinessUrl: (body.google_business_url as string | null | undefined) ?? null,
        formattedAddress: (body.formatted_address as string | null | undefined) ?? null,
        isPrimary,
        sortOrder: typeof body.sort_order === 'number' ? body.sort_order : 0,
        externalLocationId: (body.external_location_id as string | null | undefined) ?? null,
      },
    });
    return created(res, serializeLocation(row));
  } catch (err) {
    next(err);
  }
}

export async function updateLocation(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    const existing = await prisma.gbpLocation.findUnique({ where: { id } });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'GBP location not found', 404);
    await assertCanAccessCompany(req.user!, existing.companyId);

    const body = req.body as Record<string, unknown>;
    if (body.is_primary === true) {
      await prisma.gbpLocation.updateMany({
        where: { companyId: existing.companyId, NOT: { id } },
        data: { isPrimary: false },
      });
    }

    const data: Prisma.GbpLocationUpdateInput = {};
    if (body.name !== undefined) data.name = body.name as string;
    if (body.google_business_url !== undefined) {
      data.googleBusinessUrl = body.google_business_url as string | null;
    }
    if (body.formatted_address !== undefined) {
      data.formattedAddress = body.formatted_address as string | null;
    }
    if (body.is_primary !== undefined) data.isPrimary = body.is_primary as boolean;
    if (body.sort_order !== undefined) data.sortOrder = body.sort_order as number;
    if (body.external_location_id !== undefined) {
      data.externalLocationId = body.external_location_id as string | null;
    }

    const row = await prisma.gbpLocation.update({ where: { id }, data });
    return success(res, serializeLocation(row));
  } catch (err) {
    next(err);
  }
}

export async function listPosts(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const companyScope = await companyWhereForUser(req.user!);
    const where: Prisma.GbpPostWhereInput = { company: companyScope };

    const companyId = req.query.company_id as string | undefined;
    const locationId = req.query.location_id as string | undefined;
    const status = req.query.status as GbpPostStatus | undefined;
    const search = req.query.search as string | undefined;

    if (companyId) {
      await assertCanAccessCompany(req.user!, companyId);
      where.companyId = companyId;
    }
    if (status) where.status = status;
    if (locationId) {
      where.locations = { some: { locationId } };
    }
    if (search) {
      where.OR = [
        { postCode: textContains(search) },
        { topic: textContains(search) },
        { description: textContains(search) },
      ];
    }

    const rows = await prisma.gbpPost.findMany({
      where,
      include: postInclude,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
    return success(res, rows.map(serializePost));
  } catch (err) {
    next(err);
  }
}

export async function getPost(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    const row = await getPostIfAccessible(req, id);
    return success(res, serializePost(row));
  } catch (err) {
    next(err);
  }
}

export async function createPost(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const body = req.body as Record<string, unknown>;
    const companyId = body.company_id as string;
    await assertCanAccessCompany(req.user!, companyId);

    const locationIds = await assertLocationsBelongToCompany(
      companyId,
      body.location_ids as string[],
    );

    const postCode = (body.post_code as string).trim();
    const conflict = await prisma.gbpPost.findUnique({
      where: { companyId_postCode: { companyId, postCode } },
    });
    if (conflict) {
      throw new AppError(ErrorCodes.CONFLICT, `Post code ${postCode} already exists for this client`, 409);
    }

    const row = await prisma.gbpPost.create({
      data: {
        companyId,
        postCode,
        status: (body.status as GbpPostStatus | undefined) ?? 'draft',
        postType: (body.post_type as GbpPostType | undefined) ?? 'update',
        topic: (body.topic as string | null | undefined) ?? null,
        description: body.description as string,
        ctaType: (body.cta_type as string | null | undefined) ?? null,
        ctaUrl: (body.cta_url as string | null | undefined) ?? null,
        imageUrl: (body.image_url as string | null | undefined) ?? null,
        imageGuidance: (body.image_guidance as string | null | undefined) ?? null,
        linkedContentUrl: (body.linked_content_url as string | null | undefined) ?? null,
        notes: (body.notes as string | null | undefined) ?? null,
        createdById: req.user!.id,
      },
    });
    await replacePostLocations(row.id, locationIds);
    const full = await prisma.gbpPost.findUniqueOrThrow({
      where: { id: row.id },
      include: postInclude,
    });
    return created(res, serializePost(full));
  } catch (err) {
    next(err);
  }
}

export async function updatePost(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    const existing = await getPostIfAccessible(req, id);
    const body = req.body as Record<string, unknown>;

    if (body.location_ids) {
      await assertLocationsBelongToCompany(existing.companyId, body.location_ids as string[]);
    }

    if (typeof body.post_code === 'string') {
      const postCode = body.post_code.trim();
      if (postCode !== existing.postCode) {
        const conflict = await prisma.gbpPost.findUnique({
          where: {
            companyId_postCode: { companyId: existing.companyId, postCode },
          },
        });
        if (conflict) {
          throw new AppError(
            ErrorCodes.CONFLICT,
            `Post code ${postCode} already exists for this client`,
            409,
          );
        }
      }
    }

    const data: Prisma.GbpPostUpdateInput = {};
    if (body.post_code !== undefined) data.postCode = (body.post_code as string).trim();
    if (body.status !== undefined) data.status = body.status as GbpPostStatus;
    if (body.post_type !== undefined) data.postType = body.post_type as GbpPostType;
    if (body.topic !== undefined) data.topic = body.topic as string | null;
    if (body.description !== undefined) data.description = body.description as string;
    if (body.cta_type !== undefined) data.ctaType = body.cta_type as string | null;
    if (body.cta_url !== undefined) data.ctaUrl = body.cta_url as string | null;
    if (body.image_url !== undefined) data.imageUrl = body.image_url as string | null;
    if (body.image_guidance !== undefined) {
      data.imageGuidance = body.image_guidance as string | null;
    }
    if (body.linked_content_url !== undefined) {
      data.linkedContentUrl = body.linked_content_url as string | null;
    }
    if (body.notes !== undefined) data.notes = body.notes as string | null;

    await prisma.gbpPost.update({ where: { id }, data });
    if (body.location_ids) {
      await replacePostLocations(id, [...new Set(body.location_ids as string[])]);
    }

    const full = await prisma.gbpPost.findUniqueOrThrow({
      where: { id },
      include: postInclude,
    });
    return success(res, serializePost(full));
  } catch (err) {
    next(err);
  }
}

export async function markPosted(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const id = getParam(req, 'id');
    await getPostIfAccessible(req, id);
    const row = await prisma.gbpPost.update({
      where: { id },
      data: { status: 'posted', postedAt: new Date() },
      include: postInclude,
    });
    return success(res, serializePost(row));
  } catch (err) {
    next(err);
  }
}
