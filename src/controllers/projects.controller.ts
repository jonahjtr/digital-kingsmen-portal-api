import { Request, Response, NextFunction } from 'express';
import { getParam } from '../lib/params';
import { prisma } from '../lib/prisma';
import { success, created, buildMeta, parsePagination } from '../lib/apiResponse';
import { AppError, ErrorCodes } from '../lib/errors';
import {
  assertCanAccessCompany,
  assertCanAccessProject,
  assertNotClient,
  getProjectIfAccessible,
  stripClientForbiddenFields,
} from '../permissions/access';
import { projectWhereForUser, updateVisibilityFilter } from '../permissions/filters';
import { stripInternalProjectFields } from '../lib/sanitize';
import * as nudgeService from '../services/nudge.service';
import * as progressService from '../services/progress.service';

function mapProjectBody(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (body.name) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.status) data.status = body.status;
  if (body.priority) data.priority = body.priority;
  if (body.start_date) data.startDate = new Date(body.start_date as string);
  if (body.due_date) data.dueDate = new Date(body.due_date as string);
  if (body.assigned_salesman_id !== undefined) data.assignedSalesmanId = body.assigned_salesman_id;
  if (body.project_manager_id !== undefined) data.projectManagerId = body.project_manager_id;
  if (body.overall_progress !== undefined) data.overallProgress = body.overall_progress;
  if (body.client_facing_notes !== undefined) data.clientFacingNotes = body.client_facing_notes;
  if (body.internal_notes !== undefined) data.internalNotes = body.internal_notes;
  return data;
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip, search, status, sortBy, sortOrder, companyId } = parsePagination(
      req.query,
    );
    if (companyId) await assertCanAccessCompany(req.user!, companyId);
    const scope = await projectWhereForUser(req.user!);
    const where = {
      ...scope,
      ...(companyId ? { companyId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          company: { select: { id: true, name: true } },
          services: { select: { id: true, serviceName: true, progress: true, status: true } },
        },
      }),
      prisma.project.count({ where }),
    ]);
    const data = projects.map((p) => stripInternalProjectFields(p, req.user!.role));
    return success(res, data, 200, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await getProjectIfAccessible(req.user!, getParam(req, 'id'));
    return success(res, stripInternalProjectFields(project, req.user!.role));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const body = req.body;
    const project = await prisma.project.create({
      data: {
        companyId: body.company_id,
        name: body.name,
        description: body.description,
        status: body.status,
        priority: body.priority,
        startDate: body.start_date ? new Date(body.start_date) : undefined,
        dueDate: body.due_date ? new Date(body.due_date) : undefined,
        assignedSalesmanId: body.assigned_salesman_id,
        projectManagerId: body.project_manager_id,
        clientFacingNotes: body.client_facing_notes,
        internalNotes: body.internal_notes,
      },
    });
    return created(res, project);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessProject(req.user!, getParam(req, 'id'));
    const forbidden = ['internal_notes', 'overall_progress', 'status'];
    const body = stripClientForbiddenFields(req.body, req.user!, forbidden);
    const project = await prisma.project.update({
      where: { id: getParam(req, 'id') },
      data: mapProjectBody(body),
    });
    return success(res, stripInternalProjectFields(project, req.user!.role));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    if (req.user!.role !== 'admin') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Only admins can delete projects', 403);
    }
    await prisma.project.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function dashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await getProjectIfAccessible(req.user!, getParam(req, 'id'));
    const visibility = updateVisibilityFilter(req.user!);
    const [updates, tasks, approvals, files] = await Promise.all([
      prisma.projectUpdate.findMany({
        where: { projectId: project.id, ...visibility },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { poster: { select: { id: true, fullName: true } } },
      }),
      prisma.task.findMany({
        where: {
          projectId: project.id,
          archivedAt: null,
          ...(req.user!.role === 'client' ? { clientVisible: true } : {}),
        },
        orderBy: { dueDate: 'asc' },
        take: 10,
      }),
      prisma.approval.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.file.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
    return success(res, {
      project: stripInternalProjectFields(project, req.user!.role),
      recentUpdates: updates,
      recentTasks: tasks,
      pendingApprovals: approvals.filter((a) => a.status === 'waiting_for_client'),
      recentFiles: files,
    });
  } catch (err) {
    next(err);
  }
}

export async function progress(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await getProjectIfAccessible(req.user!, getParam(req, 'id'));
    const services = await prisma.projectService.findMany({
      where: { projectId: project.id },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    return success(res, {
      overallProgress: project.overallProgress,
      services: services.map((s) => ({
        id: s.id,
        serviceName: s.serviceName,
        progress: s.progress,
        manualProgressOverride: s.manualProgressOverride,
        steps: s.steps,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function nudge(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await nudgeService.sendNudge(req.user!, getParam(req, 'id'));
    return success(res, result);
  } catch (err) {
    next(err);
  }
}

// Project services
export async function listServices(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessProject(req.user!, getParam(req, 'projectId'));
    const services = await prisma.projectService.findMany({
      where: { projectId: getParam(req, 'projectId') },
      include: { steps: { orderBy: { sortOrder: 'asc' } } },
    });
    return success(res, services);
  } catch (err) {
    next(err);
  }
}

export async function createService(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    await assertCanAccessProject(req.user!, getParam(req, 'projectId'));
    const body = req.body;
    const service = await prisma.projectService.create({
      data: {
        projectId: getParam(req, 'projectId'),
        serviceTemplateId: body.service_template_id,
        serviceName: body.service_name,
        description: body.description,
        progress: body.progress ?? 0,
        status: body.status,
        manualProgressOverride: body.manual_progress_override ?? false,
      },
    });
    await progressService.recalculateProjectProgress(getParam(req, 'projectId'));
    return created(res, service);
  } catch (err) {
    next(err);
  }
}

export async function updateService(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === 'client') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Clients cannot edit services', 403);
    }
    const service = await prisma.projectService.findUnique({ where: { id: getParam(req, 'id') } });
    if (!service) throw new AppError(ErrorCodes.NOT_FOUND, 'Service not found', 404);
    await assertCanAccessProject(req.user!, service.projectId);
    const body = req.body;
    const updated = await prisma.projectService.update({
      where: { id: getParam(req, 'id') },
      data: {
        serviceName: body.service_name,
        description: body.description,
        progress: body.progress,
        status: body.status,
        manualProgressOverride: body.manual_progress_override,
      },
    });
    if (body.manual_progress_override) {
      await progressService.recalculateProjectProgress(service.projectId);
    } else {
      await progressService.recalculateServiceProgress(service.id);
      await progressService.recalculateProjectProgress(service.projectId);
    }
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteService(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const service = await prisma.projectService.findUnique({ where: { id: getParam(req, 'id') } });
    if (!service) throw new AppError(ErrorCodes.NOT_FOUND, 'Service not found', 404);
    await assertCanAccessProject(req.user!, service.projectId);
    await prisma.projectService.delete({ where: { id: getParam(req, 'id') } });
    await progressService.recalculateProjectProgress(service.projectId);
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

// Service steps
export async function listSteps(req: Request, res: Response, next: NextFunction) {
  try {
    const service = await prisma.projectService.findUnique({ where: { id: getParam(req, 'serviceId') } });
    if (!service) throw new AppError(ErrorCodes.NOT_FOUND, 'Service not found', 404);
    await assertCanAccessProject(req.user!, service.projectId);
    const steps = await prisma.serviceStep.findMany({
      where: { projectServiceId: getParam(req, 'serviceId') },
      orderBy: { sortOrder: 'asc' },
    });
    return success(res, steps);
  } catch (err) {
    next(err);
  }
}

export async function createStep(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const service = await prisma.projectService.findUnique({ where: { id: getParam(req, 'serviceId') } });
    if (!service) throw new AppError(ErrorCodes.NOT_FOUND, 'Service not found', 404);
    await assertCanAccessProject(req.user!, service.projectId);
    const body = req.body;
    const step = await prisma.serviceStep.create({
      data: {
        projectServiceId: getParam(req, 'serviceId'),
        name: body.name,
        description: body.description,
        status: body.status,
        sortOrder: body.sort_order ?? 0,
        dueDate: body.due_date ? new Date(body.due_date) : undefined,
        completedAt: body.status === 'complete' ? new Date() : undefined,
      },
    });
    await progressService.recalculateFromStep(step.id);
    return created(res, step);
  } catch (err) {
    next(err);
  }
}

export async function updateStep(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const step = await prisma.serviceStep.findUnique({
      where: { id: getParam(req, 'id') },
      include: { projectService: true },
    });
    if (!step) throw new AppError(ErrorCodes.NOT_FOUND, 'Step not found', 404);
    await assertCanAccessProject(req.user!, step.projectService.projectId);
    const body = req.body;
    const updated = await prisma.serviceStep.update({
      where: { id: getParam(req, 'id') },
      data: {
        name: body.name,
        description: body.description,
        status: body.status,
        sortOrder: body.sort_order,
        dueDate: body.due_date ? new Date(body.due_date) : undefined,
        completedAt:
          body.status === 'complete' || body.status === 'skipped'
            ? new Date()
            : body.status
              ? null
              : undefined,
      },
    });
    await progressService.recalculateFromStep(updated.id);
    return success(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteStep(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const step = await prisma.serviceStep.findUnique({
      where: { id: getParam(req, 'id') },
      include: { projectService: true },
    });
    if (!step) throw new AppError(ErrorCodes.NOT_FOUND, 'Step not found', 404);
    const projectId = step.projectService.projectId;
    await assertCanAccessProject(req.user!, projectId);
    await prisma.serviceStep.delete({ where: { id: getParam(req, 'id') } });
    await progressService.recalculateServiceProgress(step.projectServiceId);
    await progressService.recalculateProjectProgress(projectId);
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

// Project updates
export async function listUpdates(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessProject(req.user!, getParam(req, 'projectId'));
    const visibility = updateVisibilityFilter(req.user!);
    const updates = await prisma.projectUpdate.findMany({
      where: { projectId: getParam(req, 'projectId'), ...visibility },
      orderBy: { createdAt: 'desc' },
      include: { poster: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    return success(res, updates);
  } catch (err) {
    next(err);
  }
}

export async function createUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    await assertCanAccessProject(req.user!, getParam(req, 'projectId'));
    const body = req.body;
    let visibility = body.visibility ?? 'client_visible';
    if (req.user!.role === 'client') visibility = 'client_visible';
    const update = await prisma.projectUpdate.create({
      data: {
        projectId: getParam(req, 'projectId'),
        projectServiceId: body.project_service_id,
        title: body.title,
        message: body.message,
        postedBy: req.user!.id,
        visibility,
      },
    });
    return created(res, update);
  } catch (err) {
    next(err);
  }
}

export async function updateProjectUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.projectUpdate.findUnique({ where: { id: getParam(req, 'id') } });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Update not found', 404);
    await assertCanAccessProject(req.user!, existing.projectId);
    if (req.user!.role === 'client' && existing.visibility === 'internal_only') {
      throw new AppError(ErrorCodes.FORBIDDEN, 'Access denied', 403);
    }
    const body = req.body;
    const update = await prisma.projectUpdate.update({
      where: { id: getParam(req, 'id') },
      data: {
        title: body.title,
        message: body.message,
        visibility: req.user!.role === 'client' ? undefined : body.visibility,
      },
    });
    return success(res, update);
  } catch (err) {
    next(err);
  }
}

export async function deleteProjectUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    assertNotClient(req.user!);
    const existing = await prisma.projectUpdate.findUnique({ where: { id: getParam(req, 'id') } });
    if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Update not found', 404);
    await assertCanAccessProject(req.user!, existing.projectId);
    await prisma.projectUpdate.delete({ where: { id: getParam(req, 'id') } });
    return success(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
