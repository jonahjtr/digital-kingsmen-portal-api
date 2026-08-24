import { prisma } from '../lib/prisma';
import { AppError, ErrorCodes } from '../lib/errors';

export interface TaskAnchorInput {
  company_id?: string | null;
  project_id?: string | null;
  project_service_id?: string | null;
  client_visible?: boolean;
}

export interface ResolvedTaskAnchors {
  companyId: string | null;
  projectId: string | null;
  projectServiceId: string | null;
}

function nullish(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

export async function resolveTaskAnchors(input: TaskAnchorInput): Promise<ResolvedTaskAnchors> {
  const companyId = nullish(input.company_id);
  let projectId = nullish(input.project_id);
  let projectServiceId = nullish(input.project_service_id);

  if (projectServiceId && !projectId) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'project_service_id requires project_id',
      400,
    );
  }

  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, companyId: true },
    });
    if (!project) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Project not found', 404);
    }

    if (companyId && companyId !== project.companyId) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        'company_id does not match the project company',
        400,
      );
    }

    if (projectServiceId) {
      const service = await prisma.projectService.findFirst({
        where: { id: projectServiceId, projectId },
        select: { id: true },
      });
      if (!service) {
        throw new AppError(ErrorCodes.NOT_FOUND, 'Project service not found for this project', 404);
      }
    }

    return {
      companyId: project.companyId,
      projectId,
      projectServiceId,
    };
  }

  if (projectServiceId) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'project_service_id requires project_id',
      400,
    );
  }

  if (companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new AppError(ErrorCodes.NOT_FOUND, 'Company not found', 404);
    }
  }

  if (input.client_visible && !companyId) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'client_visible tasks require a company',
      400,
    );
  }

  return {
    companyId,
    projectId: null,
    projectServiceId: null,
  };
}
