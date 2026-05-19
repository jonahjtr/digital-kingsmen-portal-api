import { prisma } from '../lib/prisma';
import { verifyToken } from '../lib/jwt';

function extractToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const url = new URL(request.url);
  const q = url.searchParams.get('token');
  return q || null;
}

function partySlug(party: string): string {
  return party.toLowerCase().replace(/_/g, '-');
}

export async function partyOnBeforeConnect(
  request: Request,
  { party, name }: { party: string; name: string },
): Promise<Response | Request | void> {
  const token = extractToken(request);
  if (!token) return new Response('Unauthorized', { status: 401 });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) return new Response('Unauthorized', { status: 401 });

  const slug = partySlug(party);

  if (slug === 'conversation-server') {
    const member = await prisma.conversationMember.findFirst({
      where: { conversationId: name, userId: user.id },
    });
    if (!member) return new Response('Forbidden', { status: 403 });
  } else if (slug === 'user-server') {
    if (name !== user.id) return new Response('Forbidden', { status: 403 });
  } else {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers(request.headers);
  headers.set('X-DK-User-Id', user.id);
  headers.set('X-DK-Role', user.role);
  return new Request(request.url, { headers, method: request.method });
}
