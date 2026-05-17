import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { bootstrap } from './bootstrap';

await bootstrap({
  DB: env.DB,
  R2: (env as { R2?: R2Bucket }).R2,
});

const { createApp } = await import('./app');

const PORT = Number(process.env.PORT) || 8787;
const app = createApp();
app.listen(PORT);

export default httpServerHandler({ port: PORT });
