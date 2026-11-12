import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { success, created, buildMeta } from '../lib/apiResponse';
import { getParam } from '../lib/params';
import { getStorageProvider } from '../storage';
import { AppError, ErrorCodes } from '../lib/errors';
import { CATEGORY_KEYS, PRIORITY_KEYS, STATUS_KEYS, publicConfig } from './config';
import * as svc from './service';

const router = Router();
router.use(authenticate);

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const uuid = z.string().uuid();
const createSchema = z.object({
  company_id: uuid.optional(),
  project_id: uuid.optional(),
  category: z.enum(CATEGORY_KEYS),
  priority: z.enum(PRIORITY_KEYS).optional(),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20000),
  attachment_file_id: uuid.optional(),
  assignee_id: uuid.optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});
const commentSchema = z
  .object({
    body: z.string().max(20000).default(''),
    internal: z.boolean().optional(),
    attachment_file_id: uuid.optional(),
    status: z.enum(STATUS_KEYS).optional(),
  })
  .refine((b) => b.body.trim() || b.attachment_file_id, 'Reply is empty');
const updateSchema = z.object({
  status: z.enum(STATUS_KEYS).optional(),
  priority: z.enum(PRIORITY_KEYS).optional(),
  category: z.enum(CATEGORY_KEYS).optional(),
  assignee_id: uuid.nullable().optional(),
  assignee_ids: z.array(uuid).max(20).optional(),
  title: z.string().trim().min(3).max(200).optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});
const listSchema = z.object({
  status: z.string().max(40).optional(),
  priority: z.enum(PRIORITY_KEYS).optional(),
  category: z.enum(CATEGORY_KEYS).optional(),
  assignee: z.union([uuid, z.literal('me'), z.literal('none')]).optional(),
  company_id: uuid.optional(),
  q: z.string().max(100).optional(),
  breached: z.enum(['1', 'true']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get('/config', h(async (req, res) => success(res, publicConfig(req.user!.role !== 'client'))));

router.get('/counts', h(async (req, res) => success(res, await svc.ticketCounts(req.user!))));

router.get(
  '/',
  h(async (req, res) => {
    const q = listSchema.parse(req.query);
    const { rows, total } = await svc.listTickets(req.user!, {
      status: q.status,
      priority: q.priority,
      category: q.category,
      assigneeId: q.assignee,
      companyId: q.company_id,
      q: q.q,
      breached: !!q.breached,
      page: q.page,
      limit: q.limit,
    });
    return success(res, rows, 200, buildMeta(q.page, q.limit, total));
  }),
);

router.post(
  '/',
  h(async (req, res) => {
    const b = createSchema.parse(req.body);
    const t = await svc.createTicket(req.user!, {
      companyId: b.company_id,
      projectId: b.project_id,
      category: b.category,
      priority: b.priority,
      title: b.title,
      body: b.body,
      attachmentFileId: b.attachment_file_id,
      assigneeId: b.assignee_id,
      customFields: b.custom_fields,
    });
    return created(res, svc.presentTicket(t, req.user!));
  }),
);

router.get(
  '/:id',
  h(async (req, res) => success(res, svc.presentTicket(await svc.getTicketForUser(req.user!, getParam(req, 'id')), req.user!))),
);

router.patch(
  '/:id',
  h(async (req, res) => {
    const b = updateSchema.parse(req.body);
    const t = await svc.updateTicket(req.user!, getParam(req, 'id'), {
      status: b.status,
      priority: b.priority,
      category: b.category,
      assigneeId: b.assignee_id,
      assigneeIds: b.assignee_ids,
      title: b.title,
      customFields: b.custom_fields,
    });
    return success(res, svc.presentTicket(t, req.user!));
  }),
);

router.get('/:id/events', h(async (req, res) => success(res, await svc.listEvents(req.user!, getParam(req, 'id')))));

router.post(
  '/:id/events',
  h(async (req, res) => {
    const b = commentSchema.parse(req.body);
    await svc.addComment(req.user!, getParam(req, 'id'), {
      body: b.body,
      internal: b.internal,
      attachmentFileId: b.attachment_file_id,
      status: b.status,
    });
    return created(res, await svc.listEvents(req.user!, getParam(req, 'id')));
  }),
);

router.patch(
  '/events/:eventId',
  h(async (req, res) => {
    const b = z.object({ body: z.string().max(20000) }).parse(req.body);
    await svc.editEvent(req.user!, getParam(req, 'eventId'), b.body);
    return success(res, { ok: true });
  }),
);

router.get('/events/:eventId/revisions', h(async (req, res) => success(res, await svc.eventRevisions(req.user!, getParam(req, 'eventId')))));

router.patch(
  '/events/:eventId/checklist',
  h(async (req, res) => {
    const b = z.object({ line: z.number().int().min(0).max(500), checked: z.boolean() }).parse(req.body);
    return success(res, await svc.toggleChecklist(req.user!, getParam(req, 'eventId'), b.line, b.checked));
  }),
);

router.get(
  '/events/:eventId/attachment',
  h(async (req, res) => {
    const file = await svc.getEventAttachment(req.user!, getParam(req, 'eventId'));
    const storage = getStorageProvider();
    const object = storage.get ? await storage.get(file.fileUrl) : null;
    if (!object) throw new AppError(ErrorCodes.NOT_FOUND, 'Not found', 404);
    const type = object.mimeType || file.fileType || 'application/octet-stream';
    const inline = /^image\/(png|jpe?g|gif|webp)$/i.test(type) && req.query.download !== '1';
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Content-Type', inline ? type : 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(Buffer.from(object.body));
  }),
);

export default router;
