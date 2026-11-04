# DK Team MCP

A private MCP server so DK staff can use Claude, Cursor or Hermes to look up client info, call transcripts and tasks from the portal.

URL: `https://digital-kingsmen-portal-api.auto-cca.workers.dev/mcp`
Auth: `Authorization: Bearer dkm_...`, a personal token issued by Jonah.

## What each person can see

| Tool | What it does | Who |
|---|---|---|
| whoami | Shows your name, role and token scopes | everyone |
| list_clients / get_client | Client list; a full profile with contacts, internal notes, projects and transcript list | your clients (same as the portal) |
| search_transcripts / get_transcript | Search and read Granola call transcripts | your clients |
| list_tasks / list_team | Open tasks; the staff list for assigning | your tasks |
| get_revenue | Per-client price, sales split, contractor costs and net | **admins only** |
| create_task / update_task_status / add_internal_note | Write to the portal (internal only, never client-visible) | tokens with **write** scope |

Salesmen and employees only see the clients they're assigned to, through the same rules the portal UI uses. Tools you can't use are left out of your tool list.

## Security

- **Personal tokens.** Each token is tied to one active staff user. Client accounts can never get one. If someone is deactivated in the portal, their token stops working on the next call.
- **Storage.** Only a SHA-256 hash of each token is stored. The raw token is shown once, at issue time.
- **Expiry.** Tokens expire after 90 days by default (365 max) and can be revoked instantly.
- **Read-only by default.** Write scope has to be granted explicitly.
- **No secrets returned.** No tool returns password hashes, tokens, storage keys or raw logo URLs.
- **Strict input checks.** Arguments are validated against strict schemas. Unknown fields are rejected, and IDs must be UUIDs.
- **No existence leaks.** "Not found" looks the same as "not allowed", so nobody can probe for clients they can't see.
- **Rate limit.** 60 tool calls per minute per token.
- **Audit log.** Every call is recorded with user, tool, arguments (long text trimmed) and result.
- **Token management is separate.** Only an admin logged into the portal can issue or revoke tokens. A leaked MCP token can't mint new ones.
- **Tests.** The guarantees above are covered in `tests/mcp.test.ts`.

## Admin: issuing and revoking (Jonah's Mac)

```
python3 scripts/dk-mcp-token.py issue kristine@digitalkingsmen.com --name "Kristine laptop"
python3 scripts/dk-mcp-token.py issue carl@digitalkingsmen.com --write --days 90
python3 scripts/dk-mcp-token.py list
python3 scripts/dk-mcp-token.py audit <token_id>
python3 scripts/dk-mcp-token.py revoke <token_id>
```

The same actions are available over the API with an admin portal login: `POST/GET /api/mcp-tokens`, `DELETE /api/mcp-tokens/:id` and `GET /api/mcp-tokens/:id/audit`.

Send tokens privately (1Password or Signal), never in Slack or email.

## Team member: connecting

**Claude Desktop / Claude Code**
```
claude mcp add --transport http dk-team https://digital-kingsmen-portal-api.auto-cca.workers.dev/mcp \
  --header "Authorization: Bearer dkm_YOUR_TOKEN"
```

**Cursor** (`~/.cursor/mcp.json`)
```json
{ "mcpServers": { "dk-team": {
  "url": "https://digital-kingsmen-portal-api.auto-cca.workers.dev/mcp",
  "headers": { "Authorization": "Bearer dkm_YOUR_TOKEN" } } } }
```

**Hermes** (`~/.hermes/config.yaml`, with the token in `~/.hermes/.env` as `DK_TEAM_MCP_TOKEN=...`)
```yaml
mcp_servers:
  dk-team:
    url: https://digital-kingsmen-portal-api.auto-cca.workers.dev/mcp
    headers:
      Authorization: Bearer ${DK_TEAM_MCP_TOKEN}
```

Ask the assistant: "use dk-team whoami" to confirm it's connected.

## Rules for the team

The data is confidential to DK. Don't paste client contact info, transcripts or revenue into anything public or client-facing without a person checking it first.
