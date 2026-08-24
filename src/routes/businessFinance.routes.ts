import { Router } from 'express';
import * as businessFinanceController from '../controllers/businessFinance.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { businessFinanceSummaryQuerySchema } from '../validators/businessFinance';

const router = Router();
router.use(authenticate);

router.get(
  '/summary',
  validate(businessFinanceSummaryQuerySchema, 'query'),
  businessFinanceController.getSummary,
);

export default router;
