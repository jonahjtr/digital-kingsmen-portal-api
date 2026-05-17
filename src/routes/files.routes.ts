import { Router } from 'express';
import * as filesController from '../controllers/files.controller';
import { authenticate } from '../middleware/authenticate';
import { singleFileUpload } from '../middleware/multipart';
import { validate } from '../middleware/validate';
import { updateFileSchema } from '../validators/misc';
import { idParamSchema } from '../validators/common';

const router = Router();
router.use(authenticate);

router.get('/', filesController.list);
router.get('/:id', validate(idParamSchema, 'params'), filesController.getById);
router.get('/:id/download', validate(idParamSchema, 'params'), filesController.download);
router.post('/upload', singleFileUpload('file'), filesController.upload);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateFileSchema), filesController.update);
router.delete('/:id', validate(idParamSchema, 'params'), filesController.remove);

export default router;
