import { Request, Response, NextFunction } from 'express';

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

declare global {
  namespace Express {
    interface Request {
      file?: UploadedFile;
      rawBody?: Buffer;
    }
  }
}

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function getBoundary(contentType: string): string {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!match) throw new Error('Missing multipart boundary');
  return match[1] || match[2];
}

function parseMultipartBuffer(
  buffer: Buffer,
  contentType: string,
  fileField: string,
): { fields: Record<string, string>; file?: UploadedFile } {
  const boundary = getBoundary(contentType);
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let uploaded: UploadedFile | undefined;

  let offset = 0;
  while (offset < buffer.length) {
    const start = buffer.indexOf(delimiter, offset);
    if (start === -1) break;

    let partStart = start + delimiter.length;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;
    else if (buffer[partStart] === 10) partStart += 1;

    const next = buffer.indexOf(delimiter, partStart);
    if (next === -1) break;

    let partEnd = next;
    if (buffer[partEnd - 2] === 13 && buffer[partEnd - 1] === 10) partEnd -= 2;
    else if (buffer[partEnd - 1] === 10) partEnd -= 1;

    const part = buffer.subarray(partStart, partEnd);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) {
      offset = next;
      continue;
    }

    const headerText = part.subarray(0, headerEnd).toString('utf8');
    const body = part.subarray(headerEnd + 4);

    const disposition = /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(
      headerText,
    );
    if (!disposition) {
      offset = next;
      continue;
    }

    const name = disposition[1];
    const filename = disposition[2];

    if (filename !== undefined) {
      if (name !== fileField) {
        offset = next;
        continue;
      }
      if (body.length > MAX_FILE_SIZE) {
        throw new Error('File too large');
      }
      const mime =
        /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || 'application/octet-stream';
      uploaded = {
        fieldname: name,
        originalname: filename,
        mimetype: mime,
        size: body.length,
        buffer: Buffer.from(body),
      };
    } else {
      fields[name] = body.toString('utf8');
    }

    offset = next;
  }

  return { fields, file: uploaded };
}

async function readRequestBody(req: Request): Promise<Buffer> {
  if (req.rawBody) return req.rawBody;

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve());
    req.on('error', reject);
  });
  return Buffer.concat(chunks);
}

/** Workers-safe multipart parser (no multer / busboy streams). */
export function singleFileUpload(fieldName = 'file') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'];
    if (!contentType?.includes('multipart/form-data')) {
      return next();
    }

    try {
      const buffer = await readRequestBody(req);
      const { fields, file } = parseMultipartBuffer(buffer, contentType, fieldName);
      req.body = fields;
      req.file = file;
      next();
    } catch (err) {
      next(err);
    }
  };
}
