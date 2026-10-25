import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: "../.env" });

import bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";

const academyName = "Zarabicschool";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the base seed.`);
  }
  return value;
}

async function main() {
  const directUrl = required("DIRECT_URL");
  const pool = new Pool({ connectionString: directUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const academy = await prisma.academy.upsert({
      where: { name: academyName },
      update: {},
      create: { name: academyName },
    });

    const username = required("SEED_ADMIN_USERNAME");
    const password = required("SEED_ADMIN_PASSWORD");
    const displayName = required("SEED_ADMIN_NAME");
    const passwordHash = await bcrypt.hash(password, 12);

    const existingAdmin = await prisma.user.findUnique({
      where: { academyId_username: { academyId: academy.id, username } },
      select: { id: true },
    });

    if (existingAdmin) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { displayName, passwordHash, role: "ADMIN", isActive: true },
      });
    } else {
      await prisma.user.create({
        data: {
          academyId: academy.id,
          username,
          displayName,
          passwordHash,
          role: "ADMIN",
          mustChangePassword: true,
        },
      });
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
