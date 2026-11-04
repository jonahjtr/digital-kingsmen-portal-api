import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { applyCorsHeaders } from '../lib/cors';
import { resolveMcpToken, isRateLimited, audit } from './auth';
import { toolsFor, ToolError } from './tools';

/**
 * DK team MCP server: stateless MCP "Streamable HTTP" transport, JSON responses only.
 * POST /mcp with `Authorization: Bearer dkm_...` (personal token, see /api/mcp-tokens).
 *
 * ponytail: hand-rolled JSON-RPC (initialize, tools/list, tools/call, ping) instead of
 * @modelcontextprotocol/sdk — the SDK's transport needs Node streams/sessions that fight
 * the Workers runtime. Ceiling: no server→client notifications/SSE; add the SDK if a
 * tool ever needs streaming or sampling.
 */

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY_CHARS = 64_000;

type RpcId = string | number | null;
const rpc = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id: RpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

const router = Router();

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(rpcErr(null, -32000, 'Use POST'));
  }

  const principal = await resolveMcpToken(req.headers.authorization).catch(() => null);
  if (!principal) {
    applyCorsHeaders(req, res);
    res.setHeader('WWW-Authenticate', 'Bearer realm="dk-team-mcp"');
    return res.status(401).json(rpcErr(null, -32001, 'Invalid or missing token'));
  }

  const msg = req.body;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return res.status(400).json(rpcErr(null, -32600, 'Invalid request (batches are not supported)'));
  }
  const rid: RpcId = msg.id ?? null;
  const isNotification = msg.id === undefined;

  try {
    if (JSON.stringify(msg).length > MAX_BODY_CHARS) {
      return res.status(413).json(rpcErr(rid, -32600, 'Request too large'));
    }

    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        return res.json(
          rpc(rid, {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'dk-team', version: '1.0.0' },
            instructions:
              'Digital Kingsmen internal team tools. Data is confidential to DK staff: never paste client contact info, transcripts, or revenue into public places or client-facing messages without a human checking it.',
          }),
        );
      }
      case 'ping':
        return res.json(rpc(rid, {}));
      case 'tools/list':
        return res.json(
          rpc(rid, {
            tools: toolsFor(principal).map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: { readOnlyHint: t.scope === 'read' },
            })),
          }),
        );
      case 'tools/call': {
        const name = msg.params?.name;
        const tool = toolsFor(principal).find((t) => t.name === name);
        if (!tool) {
          await audit(principal, String(name).slice(0, 60), msg.params?.arguments, false, 'unknown or not permitted');
          return res.json(rpcErr(rid, -32602, 'Unknown tool'));
        }
        if (await isRateLimited(principal.tokenId)) {
          return res.status(429).json(rpcErr(rid, -32000, 'Rate limit: 60 calls per minute'));
        }
        try {
          const args = tool.input.parse(msg.params?.arguments ?? {});
          const out = await tool.run(principal, args);
          await audit(principal, tool.name, args, true);
          return res.json(rpc(rid, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }));
        } catch (e) {
          const message =
            e instanceof ZodError
              ? 'Invalid arguments: ' + e.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')
              : e instanceof ToolError
                ? e.message
                : 'Tool failed';
          if (!(e instanceof ZodError) && !(e instanceof ToolError)) console.error('mcp tool error', tool.name, e);
          await audit(principal, tool.name, msg.params?.arguments, false, message);
          return res.json(rpc(rid, { isError: true, content: [{ type: 'text', text: message }] }));
        }
      }
      default:
        if (isNotification) return res.status(202).end();
        return res.json(rpcErr(rid, -32601, 'Method not found'));
    }
  } catch (e) {
    console.error('mcp error', e);
    return res.status(500).json(rpcErr(rid, -32603, 'Internal error'));
  }
});

export default router;
