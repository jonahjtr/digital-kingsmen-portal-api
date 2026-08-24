/**
 * One-time import of Obsidian vault GMB posts into the portal DB.
 *
 * Local D1:  npm run import:gmb-posts
 * Remote D1: npm run import:gmb-posts:remote
 *
 * VAULT_GMB_ROOT can override the default SEO Content Creator path.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { bootstrap } from '../src/bootstrap';
import { getPrisma } from '../src/lib/prisma';
import type { GbpPostStatus, GbpPostType } from '@prisma/client';

const DEFAULT_VAULT =
  process.env.VAULT_GMB_ROOT ||
  path.join(
    process.env.HOME || '',
    'Business/digital-kingsmen-resources/SEO-Content-MVP/SEO Content Creator/01-Clients',
  );

const CLIENT_FOLDER_TO_COMPANY: Record<string, string[]> = {
  'Digital Kingsmen': ['Digital Kingsmen'],
  'Pure Heating & Air': ['Pure Heating & Air', 'Pure Heating and Air'],
  'Four Seasons Pest Solutions': [
    'Four Seasons Pest Solutions',
    'Four Seasons Pest',
    'FSPS',
  ],
  'Lexington Electrical & HVAC': [
    'Lexington Electrical & HVAC',
    'Lexington Electrical and HVAC',
  ],
};

const FSPS_LOCATIONS = [
  { name: 'Eubank (Main)', aliases: ['Eubank', 'Eubank (Main)', 'Main'], sortOrder: 0, isPrimary: true },
  { name: 'Middlesboro', aliases: ['Middlesboro'], sortOrder: 1, isPrimary: false },
  {
    name: 'Service Area (FSPS II)',
    aliases: ['FSPS II', 'Service Area', 'Service Area (FSPS II)', 'Service-area'],
    sortOrder: 2,
    isPrimary: false,
  },
];

type ParsedFrontmatter = Record<string, unknown>;

function parseFrontmatter(raw: string): { data: ParsedFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const yaml = match[1];
  const body = match[2];
  const data: ParsedFrontmatter = {};
  let currentKey: string | null = null;
  for (const line of yaml.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && currentKey) {
      const arr = Array.isArray(data[currentKey]) ? (data[currentKey] as string[]) : [];
      arr.push(listItem[1].trim().replace(/^["']|["']$/g, ''));
      data[currentKey] = arr;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    currentKey = kv[1];
    const value = kv[2].trim();
    if (value === '' || value === 'null' || value === '~') {
      data[currentKey] = null;
    } else if (value === 'true' || value === 'false') {
      data[currentKey] = value === 'true';
    } else {
      data[currentKey] = value.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body };
}

function extractSection(markdown: string, heading: string): string {
  const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
  const match = markdown.match(re);
  return match ? match[1].trim() : '';
}

function extractTopic(markdown: string): string | null {
  const match = markdown.match(/^#\s+GMB Post:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function normalizeStatus(value: unknown): GbpPostStatus {
  const v = String(value ?? 'draft').toLowerCase();
  if (v === 'approved' || v === 'ready' || v === 'posted' || v === 'expired') return v;
  return 'draft';
}

function normalizeType(value: unknown): GbpPostType {
  const v = String(value ?? 'update').toLowerCase();
  if (v === 'offer' || v === 'event') return v;
  return 'update';
}

async function initDatabase(): Promise<(() => Promise<void>) | undefined> {
  if (process.env.CF_REMOTE === '1' || process.env.CF_SEED === '1') {
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy({
      configPath: './wrangler.toml',
      environment: process.env.WRANGLER_ENV,
      remoteBindings: process.env.CF_REMOTE === '1',
    });
    bootstrap({ DB: proxy.env.DB as D1Database });
    return proxy.dispose;
  }
  bootstrap();
  return undefined;
}

async function findCompany(prisma: ReturnType<typeof getPrisma>, folderName: string) {
  const candidates = CLIENT_FOLDER_TO_COMPANY[folderName] ?? [folderName];
  for (const name of candidates) {
    const exact = await prisma.company.findFirst({ where: { name } });
    if (exact) return exact;
  }
  for (const name of candidates) {
    const fuzzy = await prisma.company.findFirst({
      where: { name: { contains: name } },
    });
    if (fuzzy) return fuzzy;
  }
  // ponytail: folder-name word match — catches "Lexington Electrical" vs "Lexington Electrical & HVAC"
  const words = folderName.split(/\s+/).filter((w) => w.length > 3);
  if (words.length >= 2) {
    const prefix = words.slice(0, 2).join(' ');
    const loose = await prisma.company.findFirst({
      where: { name: { contains: prefix } },
    });
    if (loose) return loose;
  }
  return null;
}

async function ensureLocations(
  prisma: ReturnType<typeof getPrisma>,
  company: { id: string; name: string; googleBusinessUrl: string | null; formattedAddress: string | null },
) {
  const existing = await prisma.gbpLocation.findMany({
    where: { companyId: company.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  if (existing.length > 0) return existing;

  const isFsps = /four seasons/i.test(company.name);
  if (isFsps) {
    const created = [];
    for (const loc of FSPS_LOCATIONS) {
      created.push(
        await prisma.gbpLocation.create({
          data: {
            companyId: company.id,
            name: loc.name,
            googleBusinessUrl: company.googleBusinessUrl,
            formattedAddress: company.formattedAddress,
            isPrimary: loc.isPrimary,
            sortOrder: loc.sortOrder,
          },
        }),
      );
    }
    return created;
  }

  const row = await prisma.gbpLocation.create({
    data: {
      companyId: company.id,
      name: 'Primary',
      googleBusinessUrl: company.googleBusinessUrl,
      formattedAddress: company.formattedAddress,
      isPrimary: true,
      sortOrder: 0,
    },
  });
  return [row];
}

function resolveTargetLocations(
  locations: { id: string; name: string }[],
  targets: string[],
): string[] {
  if (targets.length === 0 || targets.some((t) => /^all$/i.test(t))) {
    return locations.map((l) => l.id);
  }
  const ids: string[] = [];
  for (const target of targets) {
    const lower = target.toLowerCase();
    const match = locations.find((loc) => {
      if (loc.name.toLowerCase().includes(lower)) return true;
      const seed = FSPS_LOCATIONS.find((s) =>
        s.aliases.some((a) => a.toLowerCase() === lower || loc.name.toLowerCase().includes(a.toLowerCase())),
      );
      return seed
        ? seed.aliases.some((a) => a.toLowerCase() === lower) &&
            seed.aliases.some((a) => loc.name.toLowerCase().includes(a.toLowerCase()))
        : false;
    });
    if (match) ids.push(match.id);
  }
  return ids.length > 0 ? [...new Set(ids)] : locations.map((l) => l.id);
}

async function importClientFolder(
  prisma: ReturnType<typeof getPrisma>,
  folderName: string,
  folderPath: string,
) {
  const company = await findCompany(prisma, folderName);
  if (!company) {
    console.warn(`Skip ${folderName}: no matching Company in portal`);
    return { imported: 0, skipped: 0 };
  }

  const gmbDir = path.join(folderPath, 'Content', 'GMB');
  try {
    await stat(gmbDir);
  } catch {
    console.warn(`Skip ${folderName}: no Content/GMB folder`);
    return { imported: 0, skipped: 0 };
  }

  const locations = await ensureLocations(prisma, company);
  const files = (await readdir(gmbDir)).filter((f) => f.endsWith('.md'));
  let imported = 0;
  let skipped = 0;

  for (const file of files) {
    const raw = await readFile(path.join(gmbDir, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const postCode = String(data.post_id ?? path.basename(file, '.md')).trim();
    if (!postCode) {
      skipped += 1;
      continue;
    }

    const existing = await prisma.gbpPost.findUnique({
      where: { companyId_postCode: { companyId: company.id, postCode } },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const description = extractSection(body, 'Post Body') || body.trim();
    if (!description) {
      console.warn(`Skip ${postCode}: empty description`);
      skipped += 1;
      continue;
    }
    if (description.length > 1500) {
      console.warn(`Warn ${postCode}: description ${description.length} chars (GBP max 1500)`);
    }

    const targetsRaw = data.target_gbp_profiles;
    const targets = Array.isArray(targetsRaw)
      ? targetsRaw.map(String)
      : typeof targetsRaw === 'string'
        ? [targetsRaw]
        : ['All'];
    const locationIds = resolveTargetLocations(locations, targets);

    const post = await prisma.gbpPost.create({
      data: {
        companyId: company.id,
        postCode,
        status: normalizeStatus(data.status),
        postType: normalizeType(data.post_type),
        topic: extractTopic(body),
        description: description.slice(0, 1500),
        ctaType: data.cta_type ? String(data.cta_type) : null,
        ctaUrl: data.cta_url ? String(data.cta_url) : null,
        linkedContentUrl: data.linked_content_url ? String(data.linked_content_url) : null,
        imageGuidance: extractSection(body, 'Image Guidance') || null,
        notes: extractSection(body, 'Publishing Notes') || null,
      },
    });

    await prisma.gbpPostLocation.createMany({
      data: locationIds.map((locationId) => ({
        id: crypto.randomUUID(),
        postId: post.id,
        locationId,
      })),
    });

    imported += 1;
    console.log(`Imported ${company.name} / ${postCode} → ${locationIds.length} location(s)`);
  }

  return { imported, skipped };
}

async function main() {
  const dispose = await initDatabase();
  const prisma = getPrisma();
  try {
    const root = DEFAULT_VAULT;
    console.log(`Vault root: ${root}`);
    const entries = await readdir(root, { withFileTypes: true });
    let totalImported = 0;
    let totalSkipped = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!(entry.name in CLIENT_FOLDER_TO_COMPANY)) continue;
      const result = await importClientFolder(prisma, entry.name, path.join(root, entry.name));
      totalImported += result.imported;
      totalSkipped += result.skipped;
    }
    console.log(`Done. Imported ${totalImported}, skipped ${totalSkipped}.`);
  } finally {
    await prisma.$disconnect();
    if (dispose) await dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
