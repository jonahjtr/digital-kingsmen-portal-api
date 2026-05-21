import { prisma } from '../lib/prisma';
import { AppError, ErrorCodes } from '../lib/errors';
import { fetchLogoImage } from './company-enrichment/fetchLogoImage';
import { MAX_LOGO_BYTES, normalizeLogoImage } from './companyLogoNormalize';
import { getStorageProvider } from '../storage';

const LOGO_MAX_BYTES = MAX_LOGO_BYTES;
const ALLOWED_LOGO_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
]);

async function deleteCompanyLogoFromStorage(logoUrl: string | null | undefined) {
  if (!logoUrl) return;
  const storage = getStorageProvider();
  await storage.delete(logoUrl);
}

export async function saveCompanyLogo(
  companyId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  size: number,
  logoSourceUrl?: string | null,
) {
  let uploadBuffer = buffer;
  let uploadMime = mimeType;
  let uploadFileName = fileName;
  let uploadSize = size;

  const needsNormalize = !ALLOWED_LOGO_MIMES.has(mimeType);
  if (needsNormalize) {
    try {
      const normalized = await normalizeLogoImage(buffer, mimeType);
      uploadBuffer = normalized.buffer;
      uploadMime = normalized.mimeType;
      uploadFileName = normalized.fileName;
      uploadSize = normalized.size;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not process logo image';
      throw new AppError(ErrorCodes.VALIDATION_ERROR, message, 400);
    }
  }

  if (!ALLOWED_LOGO_MIMES.has(uploadMime)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Could not process logo image',
      400,
    );
  }
  if (uploadSize > LOGO_MAX_BYTES) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Logo must be 2MB or smaller', 400);
  }

  const existing = await prisma.company.findUnique({
    where: { id: companyId },
    select: { logoUrl: true },
  });
  if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);

  const storage = getStorageProvider();
  const result = await storage.upload(uploadBuffer, {
    fileName: uploadFileName,
    mimeType: uploadMime,
    size: uploadSize,
  });
  const company = await prisma.company.update({
    where: { id: companyId },
    data: {
      logoUrl: result.key,
      logoMimeType: uploadMime,
      logoSourceUrl: logoSourceUrl ?? null,
    },
  });
  await deleteCompanyLogoFromStorage(existing.logoUrl);
  return company;
}

export async function importLogoForCompany(companyId: string, url: string) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Logo URL is required', 400);
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { website: true, logoUrl: true, logoSourceUrl: true },
  });
  if (!company) throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
  if (!company.website?.trim()) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Company must have a website URL before importing a logo',
      400,
    );
  }

  if (company.logoUrl && company.logoSourceUrl === trimmedUrl) {
    return prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  }

  let fetched;
  try {
    fetched = await fetchLogoImage(trimmedUrl, company.website);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not download logo';
    throw new AppError(ErrorCodes.VALIDATION_ERROR, message, 400);
  }

  return saveCompanyLogo(
    companyId,
    fetched.buffer,
    fetched.mimeType,
    fetched.fileName,
    fetched.size,
    trimmedUrl,
  );
}

export async function deleteStoredCompanyLogo(logoUrl: string | null | undefined) {
  await deleteCompanyLogoFromStorage(logoUrl);
}
