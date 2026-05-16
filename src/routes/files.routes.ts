import { Router } from 'express';
import multer from 'multer';
import * as filesController from '../controllers/files.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { updateFileSchema } from '../validators/misc';
import { idParamSchema } from '../validators/common';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

router.get('/', filesController.list);
router.get('/:id', validate(idParamSchema, 'params'), filesController.getById);
router.get('/:id/download', validate(idParamSchema, 'params'), filesController.download);
router.post('/upload', upload.single('file'), filesController.upload);
router.patch('/:id', validate(idParamSchema, 'params'), validate(updateFileSchema), filesController.update);
router.delete('/:id', validate(idParamSchema, 'params'), filesController.remove);

export default router;
