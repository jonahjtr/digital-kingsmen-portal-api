/**
 * Local Node dev (SQLite file). For Cloudflare-native dev use: npm run dev (wrangler).
 */
import { bootstrap } from './bootstrap';

async function main() {
  await bootstrap();
  const { createApp } = await import('./app');
  const { env } = await import('./config/env');

  const app = createApp();
  if (process.env.ENABLE_SWAGGER === 'true') {
    const { mountDocs } = await import('./routes/docs.routes');
    await mountDocs(app);
  }
  app.listen(env.PORT, () => {
    console.log(`Digital Kingsmen Portal API running on port ${env.PORT}`);
    console.log(`API base: http://localhost:${env.PORT}/api`);
    console.log(`Docs: http://localhost:${env.PORT}/api/docs`);
    console.log('Tip: use `npm run dev` for Wrangler + D1 + R2 (Cloudflare-native)');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
