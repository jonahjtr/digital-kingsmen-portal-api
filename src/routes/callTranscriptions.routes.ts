import { Router } from 'express';
import * as callTranscriptionsController from '../controllers/callTranscriptions.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createCallTranscriptionSchema,
  listCallTranscriptionsQuerySchema,
} from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate(listCallTranscriptionsQuerySchema, 'query'),
  callTranscriptionsController.list,
);
router.get('/:id', validate(idParamSchema, 'params'), callTranscriptionsController.getById);
router.post('/', validate(createCallTranscriptionSchema), callTranscriptionsController.create);
router.delete('/:id', validate(idParamSchema, 'params'), callTranscriptionsController.remove);

export default router;
