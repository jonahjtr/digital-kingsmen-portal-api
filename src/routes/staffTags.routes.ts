import { Router } from 'express';
import * as staffTagsController from '../controllers/staffTags.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

router.get('/', staffTagsController.list);

export default router;
