import { Router } from 'express';
import * as clientRequestsController from '../controllers/clientRequests.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createClientRequestSchema, updateClientRequestSchema } from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', clientRequestsController.list);
router.get('/:id', validate(idParamSchema, 'params'), clientRequestsController.getById);
router.post('/', validate(createClientRequestSchema), clientRequestsController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateClientRequestSchema), clientRequestsController.update);
router.post('/:id/convert-to-task', validate(idParamSchema, 'params'), clientRequestsController.convertToTask);

export default router;
