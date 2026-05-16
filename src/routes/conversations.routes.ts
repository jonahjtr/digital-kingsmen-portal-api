import { Router } from 'express';
import * as conversationsController from '../controllers/conversations.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createConversationSchema, createMessageSchema } from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', conversationsController.list);
router.get('/:id', validate(idParamSchema, 'params'), conversationsController.getById);
router.post('/', validate(createConversationSchema), conversationsController.create);
router.get('/:id/messages', validate(idParamSchema, 'params'), conversationsController.listMessages);
router.post('/:id/messages', validate(idParamSchema, 'params'), validate(createMessageSchema), conversationsController.sendMessage);

export const messageRoutes = Router();
messageRoutes.use(authenticate);
messageRoutes.patch('/:id/read', validate(idParamSchema, 'params'), conversationsController.markMessageRead);

export default router;
