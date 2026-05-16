import { Router } from 'express';
import * as approvalsController from '../controllers/approvals.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { createApprovalSchema, updateApprovalSchema, approvalCommentSchema } from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', approvalsController.list);
router.get('/:id', validate(idParamSchema, 'params'), approvalsController.getById);
router.post('/', validate(createApprovalSchema), approvalsController.create);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateApprovalSchema), approvalsController.update);
router.post('/:id/approve', validate(idParamSchema, 'params'), approvalsController.approve);
router.post('/:id/request-revision', validate(idParamSchema, 'params'), approvalsController.requestRevision);
router.post('/:id/comments', validate(idParamSchema, 'params'), validate(approvalCommentSchema), approvalsController.addComment);

export default router;
