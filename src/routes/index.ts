import { Router } from 'express';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import companiesRoutes from './companies.routes';
import projectsRoutes, {
  projectServiceRoutes,
  projectServiceStepRoutes,
  serviceStepRoutes,
  projectUpdateRoutes,
} from './projects.routes';
import tasksRoutes from './tasks.routes';
import conversationsRoutes, { messageRoutes } from './conversations.routes';
import filesRoutes from './files.routes';
import approvalsRoutes from './approvals.routes';
import clientRequestsRoutes from './clientRequests.routes';
import reportsRoutes from './reports.routes';
import notificationsRoutes from './notifications.routes';
import announcementsRoutes from './announcements.routes';
import dashboardRoutes from './dashboard.routes';
import invitesRoutes from './invites.routes';
import internalNotesRoutes from './internalNotes.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/companies', companiesRoutes);
router.use('/projects', projectsRoutes);
router.use('/project-services', projectServiceRoutes);
router.use('/project-services', projectServiceStepRoutes);
router.use('/service-steps', serviceStepRoutes);
router.use('/project-updates', projectUpdateRoutes);
router.use('/tasks', tasksRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/messages', messageRoutes);
router.use('/files', filesRoutes);
router.use('/approvals', approvalsRoutes);
router.use('/client-requests', clientRequestsRoutes);
router.use('/reports', reportsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/announcements', announcementsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/invites', invitesRoutes);
router.use('/internal-notes', internalNotesRoutes);

export default router;
