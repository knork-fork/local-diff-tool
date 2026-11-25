import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const port = Number(process.env.APP_PORT || 22222);
const host = process.env.APP_HOST || '0.0.0.0'; // host exposure is restricted to 127.0.0.1 by docker-compose
const webDir = process.env.WEB_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

buildApp({ webDir }).listen({ port, host }).catch((e) => {
  console.error(e);
  process.exit(1);
});
