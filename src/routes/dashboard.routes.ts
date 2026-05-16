import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

router.get('/admin', dashboardController.admin);
router.get('/client', dashboardController.client);
router.get('/salesman', dashboardController.salesman);
router.get('/employee', dashboardController.employee);

export default router;
