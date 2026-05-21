import { Router } from 'express';
import * as internalNotesController from '../controllers/internalNotes.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  createInternalNoteSchema,
  listInternalNotesQuerySchema,
  updateInternalNoteSchema,
} from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', validate(listInternalNotesQuerySchema, 'query'), internalNotesController.list);
router.post('/', validate(createInternalNoteSchema), internalNotesController.create);
router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateInternalNoteSchema),
  internalNotesController.update,
);
router.delete('/:id', validate(idParamSchema, 'params'), internalNotesController.remove);

export default router;
