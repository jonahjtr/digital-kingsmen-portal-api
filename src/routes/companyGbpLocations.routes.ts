import { Router } from 'express';
import * as gbpPostsController from '../controllers/gbpPosts.controller';
import { authenticateJwtOrMcp } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { companyIdParamSchema, createGbpLocationSchema } from '../validators/gbpPosts';

const router = Router({ mergeParams: true });
router.use(authenticateJwtOrMcp);

router.get(
  '/',
  validate(companyIdParamSchema, 'params'),
  gbpPostsController.listLocationsForCompany,
);
router.post(
  '/',
  validate(companyIdParamSchema, 'params'),
  validate(createGbpLocationSchema),
  gbpPostsController.createLocationForCompany,
);

export default router;
