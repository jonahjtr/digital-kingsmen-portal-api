import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Digital Kingsmen Portal API running on port ${env.PORT}`);
  console.log(`API base: http://localhost:${env.PORT}/api`);
  console.log(`Docs: http://localhost:${env.PORT}/api/docs`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${env.PORT} is already in use. Stop the other process (e.g. lsof -i :${env.PORT}) or set PORT in .env.`,
    );
    process.exit(1);
  }
  throw err;
});
