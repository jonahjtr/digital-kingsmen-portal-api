import { Router } from 'express';
import * as gbpPostsController from '../controllers/gbpPosts.controller';
import { authenticateJwtOrMcp } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../validators/common';
import {
  createGbpPostSchema,
  listGbpPostsQuerySchema,
  updateGbpLocationSchema,
  updateGbpPostSchema,
  gbpLocationIdParamSchema,
} from '../validators/gbpPosts';

const router = Router();
router.use(authenticateJwtOrMcp);

router.get('/seo-clients', gbpPostsController.listSeoClients);
router.get('/', validate(listGbpPostsQuerySchema, 'query'), gbpPostsController.listPosts);
router.get('/:id', validate(idParamSchema, 'params'), gbpPostsController.getPost);
router.post('/', validate(createGbpPostSchema), gbpPostsController.createPost);
router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateGbpPostSchema),
  gbpPostsController.updatePost,
);
router.post(
  '/:id/mark-posted',
  validate(idParamSchema, 'params'),
  gbpPostsController.markPosted,
);

export const gbpLocationRoutes = Router();
gbpLocationRoutes.use(authenticateJwtOrMcp);
gbpLocationRoutes.patch(
  '/:id',
  validate(gbpLocationIdParamSchema, 'params'),
  validate(updateGbpLocationSchema),
  gbpPostsController.updateLocation,
);

export default router;
