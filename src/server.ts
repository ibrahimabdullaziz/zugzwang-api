import { createServer } from 'node:http';
import { Router } from 'express';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';

const app = createApp({
  routes: Router(),
  corsOrigins: config.server.corsOrigins,
});

const server = createServer(app);

server.on('error', (error) => {
  logger.error({ err: error }, 'HTTP server failed');
  process.exitCode = 1;
});

server.listen(config.server.port, () => {
  logger.info({ port: config.server.port }, 'HTTP server listening');
});
