import { Router } from 'express';
import * as reportsController from '../controllers/reports.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createReportSchema, updateReportSchema } from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', reportsController.list);
router.get('/:id', validate(idParamSchema, 'params'), reportsController.getById);
router.post('/', validate(createReportSchema), reportsController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateReportSchema), reportsController.update);
router.delete('/:id', validate(idParamSchema, 'params'), reportsController.remove);

export default router;
