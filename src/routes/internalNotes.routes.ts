import { Router } from 'express';
import * as internalNotesController from '../controllers/internalNotes.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createInternalNoteSchema } from '../validators/misc';

const router = Router();
router.use(authenticate);

router.get('/', internalNotesController.list);
router.post('/', validate(createInternalNoteSchema), internalNotesController.create);

export default router;
