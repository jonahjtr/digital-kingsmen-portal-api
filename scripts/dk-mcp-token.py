#!/usr/bin/env python3
"""Issue / list / revoke DK team MCP tokens (admin tool, runs on Jonah's Mac).

  dk-mcp-token.py issue <email> [--write] [--days 90] [--name "Laptop"]
  dk-mcp-token.py list
  dk-mcp-token.py revoke <token_id>
  dk-mcp-token.py audit <token_id>

Writes straight to D1 with wrangler (already authed here), using the same scheme as
the API: raw token `dkm_<43 base64url>` is printed ONCE; only its SHA-256 is stored.
"""
import base64, datetime, hashlib, json, os, secrets, subprocess, sys, uuid

API = os.path.expanduser("~/Business/developer/digital-kingsmen/digital-kingsmen-portal-api")
JONAH = "fc21ceeb-db1f-4204-b522-e5c1898cb0e8"


def d1(sql, as_json=True):
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID="cca5a114f4b3baf1459a9b2697cad2e1")
    env.pop("PYTHONPATH", None)
    args = ["npx", "wrangler", "d1", "execute", "portal-db", "--remote", "--command", sql] + (["--json"] if as_json else [])
    r = subprocess.run(args, cwd=API, env=env, capture_output=True, text=True, timeout=120)
    if r.returncode:
        sys.exit(r.stderr[-400:])
    return json.loads(r.stdout, strict=False)[0]["results"] if as_json else None


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def now(days=0):
    return (datetime.datetime.utcnow() + datetime.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def issue(argv):
    email = argv[0]
    days = int(argv[argv.index("--days") + 1]) if "--days" in argv else 90
    name = argv[argv.index("--name") + 1] if "--name" in argv else "MCP"
    scopes = "read,write" if "--write" in argv else "read"
    if not 1 <= days <= 365:
        sys.exit("--days must be 1-365")
    u = d1(f"SELECT id, full_name, role, is_active FROM users WHERE lower(email)=lower({q(email)})")
    if not u or not u[0]["is_active"] or u[0]["role"] == "client":
        sys.exit(f"{email}: not an active DK staff user (clients can never get MCP tokens)")
    raw = "dkm_" + base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    tid = str(uuid.uuid4())
    d1(
        "INSERT INTO mcp_tokens (id,user_id,name,token_hash,prefix,scopes,expires_at,created_by,created_at) VALUES "
        f"({q(tid)},{q(u[0]['id'])},{q(name)},{q(hashlib.sha256(raw.encode()).hexdigest())},{q(raw[:10])},"
        f"{q(scopes)},{q(now(days))},{q(JONAH)},{q(now())})",
        as_json=False,
    )
    print(f"Issued for {u[0]['full_name']} ({u[0]['role']}), scopes={scopes}, expires in {days} days")
    print(f"token id: {tid}")
    print(f"\nTOKEN (shown once, send privately):\n{raw}\n")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, argv = sys.argv[1], sys.argv[2:]
    if cmd == "issue" and argv:
        issue(argv)
    elif cmd == "list":
        for r in d1("SELECT t.id, u.full_name, u.role, t.name, t.prefix, t.scopes, substr(t.expires_at,1,10) exp, "
                    "substr(t.last_used_at,1,16) last_used, t.revoked_at FROM mcp_tokens t JOIN users u ON u.id=t.user_id "
                    "ORDER BY t.created_at DESC"):
            state = "REVOKED" if r["revoked_at"] else ("expired" if r["exp"] < now()[:10] else "active")
            print(f"{r['id']}  {state:8} {r['full_name']:<18} {r['role']:<9} {r['scopes']:<11} exp {r['exp']}  last {r['last_used'] or '-'}  {r['prefix']}…  {r['name']}")
    elif cmd == "revoke" and argv:
        d1(f"UPDATE mcp_tokens SET revoked_at={q(now())} WHERE id={q(argv[0])} AND revoked_at IS NULL", as_json=False)
        print("revoked (takes effect on the next call)")
    elif cmd == "audit" and argv:
        for r in d1(f"SELECT substr(created_at,1,19) t, tool, ok, error, args FROM mcp_audit_log WHERE token_id={q(argv[0])} ORDER BY created_at DESC LIMIT 50"):
            print(f"{r['t']}  {'ok ' if r['ok'] else 'ERR'} {r['tool']:<20} {r['error'] or ''} {r['args'] or ''}"[:200])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
