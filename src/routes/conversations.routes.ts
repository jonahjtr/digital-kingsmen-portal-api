import { Router } from 'express';
import * as conversationsController from '../controllers/conversations.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createMessageSchema, editMessageSchema, reactionSchema } from '../validators/misc';
import { createConversationSchema, markConversationReadSchema } from '../validators/conversations';
import { idParamSchema, projectIdParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', conversationsController.list);
router.get(
  '/by-project/:projectId',
  validate(projectIdParamSchema, 'params'),
  conversationsController.getForProject,
);
router.get('/:id', validate(idParamSchema, 'params'), conversationsController.getById);
router.post('/', validate(createConversationSchema), conversationsController.create);
router.get('/:id/messages', validate(idParamSchema, 'params'), conversationsController.listMessages);
router.post('/:id/messages', validate(idParamSchema, 'params'), validate(createMessageSchema), conversationsController.sendMessage);
router.patch(
  '/:id/read',
  validate(idParamSchema, 'params'),
  validate(markConversationReadSchema),
  conversationsController.markConversationRead,
);

router.post('/:id/typing', validate(idParamSchema, 'params'), conversationsController.typing);

export const messageRoutes = Router();
messageRoutes.use(authenticate);
messageRoutes.patch('/:id/read', validate(idParamSchema, 'params'), conversationsController.markMessageRead);
messageRoutes.patch('/:id', validate(idParamSchema, 'params'), validate(editMessageSchema), conversationsController.editMessage);
messageRoutes.get('/:id/attachment', validate(idParamSchema, 'params'), conversationsController.messageAttachment);
messageRoutes.delete('/:id', validate(idParamSchema, 'params'), conversationsController.deleteMessage);
messageRoutes.post('/:id/reactions', validate(idParamSchema, 'params'), validate(reactionSchema), conversationsController.toggleReaction);

export default router;
