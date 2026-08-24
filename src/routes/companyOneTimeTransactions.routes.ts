import { Router } from 'express';
import * as oneTimeTransactionsController from '../controllers/oneTimeTransactions.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  companyIdParamSchema,
  createOneTimeTransactionSchema,
} from '../validators/oneTimeTransactions';

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  validate(companyIdParamSchema, 'params'),
  oneTimeTransactionsController.listForCompany,
);
router.post(
  '/',
  validate(companyIdParamSchema, 'params'),
  validate(createOneTimeTransactionSchema),
  oneTimeTransactionsController.createForCompany,
);

export default router;
