import { Router } from 'express';
import * as tasksController from '../controllers/tasks.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createTaskSchema, updateTaskSchema, createTaskCommentSchema } from '../validators/tasks';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', tasksController.list);
router.get('/:id', validate(idParamSchema, 'params'), tasksController.getById);
router.post('/', validate(createTaskSchema), tasksController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateTaskSchema), tasksController.update);
router.delete('/:id', validate(idParamSchema, 'params'), tasksController.remove);
router.get('/:id/comments', validate(idParamSchema, 'params'), tasksController.listComments);
router.post('/:id/comments', validate(idParamSchema, 'params'), validate(createTaskCommentSchema), tasksController.addComment);

export default router;
