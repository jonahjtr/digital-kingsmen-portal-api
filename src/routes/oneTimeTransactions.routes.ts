import { Router } from 'express';
import * as oneTimeTransactionsController from '../controllers/oneTimeTransactions.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  listOneTimeTransactionsQuerySchema,
  transactionIdParamSchema,
  updateOneTimeTransactionSchema,
} from '../validators/oneTimeTransactions';
import {
  createOneTimeTransactionExpenseSchema,
  transactionExpenseIdParamSchema,
  updateOneTimeTransactionExpenseSchema,
} from '../validators/oneTimeTransactionExpenses';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate(listOneTimeTransactionsQuerySchema, 'query'),
  oneTimeTransactionsController.listAll,
);
router.get(
  '/:id/expenses',
  validate(transactionIdParamSchema, 'params'),
  oneTimeTransactionsController.listExpenses,
);
router.post(
  '/:id/expenses',
  validate(transactionIdParamSchema, 'params'),
  validate(createOneTimeTransactionExpenseSchema),
  oneTimeTransactionsController.createExpense,
);
router.patch(
  '/:id/expenses/:expenseId',
  validate(transactionExpenseIdParamSchema, 'params'),
  validate(updateOneTimeTransactionExpenseSchema),
  oneTimeTransactionsController.updateExpense,
);
router.delete(
  '/:id/expenses/:expenseId',
  validate(transactionExpenseIdParamSchema, 'params'),
  oneTimeTransactionsController.removeExpense,
);
router.patch(
  '/:id',
  validate(transactionIdParamSchema, 'params'),
  validate(updateOneTimeTransactionSchema),
  oneTimeTransactionsController.update,
);
router.delete(
  '/:id',
  validate(transactionIdParamSchema, 'params'),
  oneTimeTransactionsController.remove,
);

export default router;
