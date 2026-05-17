import { Router } from 'express';
import * as invitesController from '../controllers/invites.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createInviteSchema } from '../validators/misc';

const router = Router();
router.use(authenticate);

router.get('/email-status', invitesController.emailStatus);
router.get('/registration-tokens', invitesController.registrationTokens);
router.get('/', invitesController.list);
router.post('/', validate(createInviteSchema), invitesController.create);

export default router;
