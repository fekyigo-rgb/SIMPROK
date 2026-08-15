import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import {
  assertLivePermanentRuntimeTarget,
  assertPermanentCanonicalBoundary,
  describePermanentRuntimeTarget,
} from './runtime/permanent-runtime-target';

async function bootstrap() {
  // PERMANENT ⇔ CANONICAL, enforced BEFORE the application is created, because
  // creating it connects Prisma. Both halves must be settled while this is
  // still only a string: a wrong target must never reach the database it was
  // not allowed to touch, and an undeclared runtime must never reach the
  // canonical one at all. Any other target belongs to another guard.
  const { permanent } = assertPermanentCanonicalBoundary({
    databaseUrl: process.env.DATABASE_URL,
    env: process.env,
  });

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
