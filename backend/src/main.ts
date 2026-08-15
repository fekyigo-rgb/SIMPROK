import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import {
  assertPermanentRuntimeTarget,
  describePermanentRuntimeTarget,
  isPermanentRuntimeDeclared,
  parsePermanentTargetFromUrl,
  assertLivePermanentRuntimeTarget,
} from './runtime/permanent-runtime-target';

async function bootstrap() {
  // A runtime that declares itself PERMANENT is held to the canonical target
  // BEFORE the application is created, because creating it connects Prisma —
  // a wrong DSN must never reach the database it was not allowed to touch.
  // A runtime that makes no such claim is not bound by this and is untouched.
  const permanent = isPermanentRuntimeDeclared(process.env);
  if (permanent) {
    assertPermanentRuntimeTarget(
      parsePermanentTargetFromUrl(process.env.DATABASE_URL),
    );
  }

  const app = await NestFactory.create(AppModule);

  if (permanent) {
    // The DSN was right; prove the SOCKET agrees before serving a request.
    const prisma = app.get(PrismaService);
    const live = await assertLivePermanentRuntimeTarget({
      query: async (sql) => prisma.$queryRawUnsafe(sql),
    });
    console.log(describePermanentRuntimeTarget(live));
  }

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
