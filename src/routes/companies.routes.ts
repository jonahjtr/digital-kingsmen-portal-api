import { Router } from 'express';
import * as companiesController from '../controllers/companies.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createCompanySchema, updateCompanySchema } from '../validators/companies';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', companiesController.list);
router.get('/:id', validate(idParamSchema, 'params'), companiesController.getById);
router.post('/', validate(createCompanySchema), companiesController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateCompanySchema), companiesController.update);
router.delete('/:id', validate(idParamSchema, 'params'), companiesController.remove);

export default router;
