import { Router } from 'express';
import * as monthlyServicesController from '../controllers/monthlyServices.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  listMonthlyServicesQuerySchema,
  updateMonthlyServiceSchema,
} from '../validators/monthlyServices';
import {
  createMonthlyServiceExpenseSchema,
  expenseIdParamSchema,
  updateMonthlyServiceExpenseSchema,
} from '../validators/monthlyServiceExpenses';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate(listMonthlyServicesQuerySchema, 'query'),
  monthlyServicesController.listAll,
);
router.get(
  '/:id/expenses',
  validate(idParamSchema, 'params'),
  monthlyServicesController.listExpenses,
);
router.post(
  '/:id/expenses',
  validate(idParamSchema, 'params'),
  validate(createMonthlyServiceExpenseSchema),
  monthlyServicesController.createExpense,
);
router.patch(
  '/:id/expenses/:expenseId',
  validate(expenseIdParamSchema, 'params'),
  validate(updateMonthlyServiceExpenseSchema),
  monthlyServicesController.updateExpense,
);
router.delete(
  '/:id/expenses/:expenseId',
  validate(expenseIdParamSchema, 'params'),
  monthlyServicesController.removeExpense,
);
router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateMonthlyServiceSchema),
  monthlyServicesController.update,
);
router.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  monthlyServicesController.remove,
);

export default router;
