import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { assertProductionConfig } from './common/app-config';

async function bootstrap() {
  // Fail fast on a misconfigured production deployment (missing JWT secret /
  // webhook secret) BEFORE the Nest app is created — production must never
  // run with dev fallbacks. Dev/test are unaffected (assertion is a no-op).
  assertProductionConfig();

  // bodyParser: false → register parsers explicitly below with bounded sizes,
  // so an oversized/poisoned JSON body is rejected (413) instead of buffered.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Explicit body parsers with size limits (fail loud on oversized payloads).
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

  // Production: read allowed origins from CORS_ORIGIN env var (comma-separated)
  // Dev: default to localhost origins
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // Global ValidationPipe: whitelist strips unknown properties,
  // forbidNonWhitelisted rejects requests with unexpected fields,
  // transform auto-converts query/path params to typed values.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global exception filter: consistent JSON error shape for all responses.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger UI at /api/docs
  const config = new DocumentBuilder()
    .setTitle('Nearventure API')
    .setDescription('REST API for the Nearventure route-planning platform — POIs, routing, routes, Telegram bot bridge, analytics.')
    .setVersion('1.0')
    .addTag('pois', 'Points of interest catalog')
    .addTag('routing', 'GraphHopper routing and auto-route')
    .addTag('routes', 'Saved routes and GPX export')
    .addTag('telegram', 'Telegram bot webhook and Mini App bridge')
    .addTag('analytics', 'Event tracking and feedback')
    .addTag('auth', 'Admin authentication')
    .addTag('users', 'Admin user management')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Serve frontend static files in production
  // Try multiple paths for local dev and Docker
  const possiblePaths = [
    process.env.FRONTEND_DIST,
    '../frontend/dist',               // local: cwd = apps/backend/dist
    './apps/frontend/dist',           // Docker: cwd = /app
    path.join(process.cwd(), '../frontend/dist'),
  ].filter(Boolean);

  let frontendDist: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p!) && fs.existsSync(path.join(p!, 'index.html'))) {
      frontendDist = p;
      break;
    }
  }

  if (frontendDist) {
    app.useStaticAssets(frontendDist, {
      prefix: '/',
    });
    // SPA fallback — all non-API, non-/tg routes go to index.html.
    // /tg/* is the Mini App (served separately below with its own fallback).
    app.use((req, res, next) => {
      if (
        !req.path.startsWith('/api') &&
        !req.path.startsWith('/tg') &&
        !req.path.includes('.')
      ) {
        res.sendFile(path.resolve(frontendDist!, 'index.html'));
      } else {
        next();
      }
    });
    console.log(`Serving frontend from: ${frontendDist}`);
  } else {
    console.log('No frontend dist found, API mode only.');
  }

  // ── Mini App static (/tg/) — Telegram WebApp served at this slug ────────
  const miniappPossible = [
    process.env.MINIAPP_DIST,
    '../miniapp/dist',
    './apps/miniapp/dist',
    path.join(process.cwd(), '../miniapp/dist'),
  ].filter(Boolean);
  let miniappDist: string | null = null;
  for (const p of miniappPossible) {
    if (fs.existsSync(p!) && fs.existsSync(path.join(p!, 'index.html'))) {
      miniappDist = p;
      break;
    }
  }
  if (miniappDist) {
    // Serve /tg/* static assets (JS/CSS/img) with their real paths.
    app.useStaticAssets(miniappDist, { prefix: '/tg' });
    // Hash-router fallback: /tg and /tg/<anything> (no dot) → /tg/index.html.
    app.use((req, res, next) => {
      if (req.path === '/tg' || req.path === '/tg/') {
        return res.sendFile(path.resolve(miniappDist!, 'index.html'));
      }
      if (req.path.startsWith('/tg/') && !req.path.includes('.')) {
        return res.sendFile(path.resolve(miniappDist!, 'index.html'));
      }
      next();
    });
    console.log(`Serving Mini App at: /tg/ (from ${miniappDist})`);
  } else {
    console.log('No Mini App dist found (/tg/ disabled).');
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
