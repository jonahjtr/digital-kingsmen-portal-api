import { Router } from 'express';
import * as companiesController from '../controllers/companies.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createCompanySchema,
  updateCompanySchema,
  enrichPreviewSchema,
  importLogoFromUrlSchema,
} from '../validators/companies';
import { idParamSchema } from '../validators/common';
import { singleFileUpload } from '../middleware/multipart';
import companyStaffAssignmentsRoutes from './companyStaffAssignments.routes';

const router = Router();
router.use(authenticate);

router.get('/', companiesController.list);
router.use('/:companyId/staff-assignments', companyStaffAssignmentsRoutes);
router.post('/enrich-preview', validate(enrichPreviewSchema), companiesController.enrichPreview);
router.get('/:id/logo', validate(idParamSchema, 'params'), companiesController.getLogo);
router.post(
  '/:id/logo',
  validate(idParamSchema, 'params'),
  singleFileUpload('file'),
  companiesController.uploadLogo,
);
router.post(
  '/:id/logo/import-from-url',
  validate(idParamSchema, 'params'),
  validate(importLogoFromUrlSchema),
  companiesController.importLogoFromUrl,
);
router.delete('/:id/logo', validate(idParamSchema, 'params'), companiesController.removeLogo);
router.get('/:id', validate(idParamSchema, 'params'), companiesController.getById);
router.post('/', validate(createCompanySchema), companiesController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateCompanySchema), companiesController.update);
router.delete('/:id', validate(idParamSchema, 'params'), companiesController.remove);

export default router;
