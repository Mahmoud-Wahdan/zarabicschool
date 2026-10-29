import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pool?: Pool;
};

function createPrismaClient() {
  // C1: pg's 10 s default idle timeout forced a reconnect (DNS + TLS, ~280 ms, and
  // multi-second stalls during DNS trouble) on most requests. 60 s stays below the
  // pooler's own idle limit (not verified for Supabase — conservative choice).
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  const adapter = new PrismaPg(pool);
  return {
    client: new PrismaClient({ adapter }),
    pool,
  };
}

const database = globalForPrisma.prisma
  ? { client: globalForPrisma.prisma, pool: globalForPrisma.pool }
  : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = database.client;
  globalForPrisma.pool = database.pool;
}

export const prisma = database.client;

export async function disconnectPrisma() {
  await database.client.$disconnect();
  await database.pool?.end();
}
