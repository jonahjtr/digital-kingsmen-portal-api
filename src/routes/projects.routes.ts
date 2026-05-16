import { Router } from 'express';
import * as projectsController from '../controllers/projects.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createProjectSchema,
  updateProjectSchema,
  createProjectServiceSchema,
  updateProjectServiceSchema,
  createServiceStepSchema,
  updateServiceStepSchema,
  createProjectUpdateSchema,
  updateProjectUpdateSchema,
} from '../validators/projects';
import { idParamSchema, projectIdParamSchema, serviceIdParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', projectsController.list);
router.get('/:id', validate(idParamSchema, 'params'), projectsController.getById);
router.post('/', validate(createProjectSchema), projectsController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateProjectSchema), projectsController.update);
router.delete('/:id', validate(idParamSchema, 'params'), projectsController.remove);
router.get('/:id/dashboard', validate(idParamSchema, 'params'), projectsController.dashboard);
router.get('/:id/progress', validate(idParamSchema, 'params'), projectsController.progress);
router.post('/:id/nudge', validate(idParamSchema, 'params'), projectsController.nudge);

router.get('/:projectId/services', validate(projectIdParamSchema, 'params'), projectsController.listServices);
router.post('/:projectId/services', validate(projectIdParamSchema, 'params'), validate(createProjectServiceSchema), projectsController.createService);

router.get('/:projectId/updates', validate(projectIdParamSchema, 'params'), projectsController.listUpdates);
router.post('/:projectId/updates', validate(projectIdParamSchema, 'params'), validate(createProjectUpdateSchema), projectsController.createUpdate);

export default router;

// Standalone handlers exported for mounting at /api level
export const projectServiceRoutes = Router();
projectServiceRoutes.use(authenticate);
projectServiceRoutes.patch('/:id', validate(idParamSchema, 'params'), validate(updateProjectServiceSchema), projectsController.updateService);
projectServiceRoutes.delete('/:id', validate(idParamSchema, 'params'), projectsController.deleteService);

export const projectServiceStepRoutes = Router();
projectServiceStepRoutes.use(authenticate);
projectServiceStepRoutes.get('/:serviceId/steps', validate(serviceIdParamSchema, 'params'), projectsController.listSteps);
projectServiceStepRoutes.post('/:serviceId/steps', validate(serviceIdParamSchema, 'params'), validate(createServiceStepSchema), projectsController.createStep);

export const serviceStepRoutes = Router();
serviceStepRoutes.use(authenticate);
serviceStepRoutes.patch('/:id', validate(idParamSchema, 'params'), validate(updateServiceStepSchema), projectsController.updateStep);
serviceStepRoutes.delete('/:id', validate(idParamSchema, 'params'), projectsController.deleteStep);

export const projectUpdateRoutes = Router();
projectUpdateRoutes.use(authenticate);
projectUpdateRoutes.patch('/:id', validate(idParamSchema, 'params'), validate(updateProjectUpdateSchema), projectsController.updateProjectUpdate);
projectUpdateRoutes.delete('/:id', validate(idParamSchema, 'params'), projectsController.deleteProjectUpdate);
