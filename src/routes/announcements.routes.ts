import { Router } from 'express';
import * as announcementsController from '../controllers/announcements.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', announcementsController.list);
router.post('/', validate(createAnnouncementSchema), announcementsController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateAnnouncementSchema), announcementsController.update);
router.delete('/:id', validate(idParamSchema, 'params'), announcementsController.remove);

export default router;
