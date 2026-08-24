import { Router } from 'express';
import * as businessFinanceController from '../controllers/businessFinance.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createBusinessRecurringExpenseSchema,
  updateBusinessRecurringExpenseSchema,
} from '../validators/businessFinance';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', businessFinanceController.listRecurringExpenses);
router.post('/', validate(createBusinessRecurringExpenseSchema), businessFinanceController.createRecurringExpense);
router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateBusinessRecurringExpenseSchema),
  businessFinanceController.updateRecurringExpense,
);
router.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  businessFinanceController.removeRecurringExpense,
);

export default router;
