import { Router } from 'express';
import * as monthlyServicesController from '../controllers/monthlyServices.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  companyIdParamSchema,
  createMonthlyServiceSchema,
} from '../validators/monthlyServices';

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  validate(companyIdParamSchema, 'params'),
  monthlyServicesController.listForCompany,
);
router.post(
  '/',
  validate(companyIdParamSchema, 'params'),
  validate(createMonthlyServiceSchema),
  monthlyServicesController.createForCompany,
);

export default router;
