import { StepStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

const COMPLETE_STATUSES: StepStatus[] = ['complete', 'skipped'];

export async function recalculateServiceProgress(projectServiceId: string): Promise<number> {
  const service = await prisma.projectService.findUnique({
    where: { id: projectServiceId },
    include: { steps: true },
  });
  if (!service) return 0;

  if (service.manualProgressOverride) {
    return service.progress;
  }

  const steps = service.steps;
  if (steps.length === 0) return service.progress;

  const completed = steps.filter((s) => COMPLETE_STATUSES.includes(s.status)).length;
  const progress = Math.round((completed / steps.length) * 100);

  await prisma.projectService.update({
    where: { id: projectServiceId },
    data: { progress },
  });

  return progress;
}

export async function recalculateProjectProgress(projectId: string): Promise<number> {
  const services = await prisma.projectService.findMany({
    where: { projectId },
  });

  if (services.length === 0) {
    await prisma.project.update({
      where: { id: projectId },
      data: { overallProgress: 0 },
    });
    return 0;
  }

  const totalProgress = services.reduce((sum, s) => sum + s.progress, 0);
  const overallProgress = Math.round(totalProgress / services.length);

  await prisma.project.update({
    where: { id: projectId },
    data: { overallProgress },
  });

  return overallProgress;
}

export async function recalculateFromStep(stepId: string): Promise<void> {
  const step = await prisma.serviceStep.findUnique({
    where: { id: stepId },
    select: { projectServiceId: true, projectService: { select: { projectId: true } } },
  });
  if (!step) return;
  await recalculateServiceProgress(step.projectServiceId);
  await recalculateProjectProgress(step.projectService.projectId);
}
