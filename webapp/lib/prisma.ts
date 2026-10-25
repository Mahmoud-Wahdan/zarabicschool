import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pool?: Pool;
};

function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
