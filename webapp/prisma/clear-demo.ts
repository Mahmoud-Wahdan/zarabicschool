import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: "../.env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to clear demo data.`);
  }
  return value;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:clear:demo refuses to run when NODE_ENV=production.");
  }

  const confirm = process.argv.includes("--confirm");
  const directUrl = required("DIRECT_URL");
  const pool = new Pool({ connectionString: directUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const count = await prisma.subject.count({
      where: { slug: { startsWith: "demo-" } },
    });
    console.log(`Demo subjects matching slug prefix demo-: ${count}`);

    if (!confirm) {
      console.log("Pass --confirm to delete those rows.");
      return;
    }

    const result = await prisma.subject.deleteMany({
      where: { slug: { startsWith: "demo-" } },
    });
    console.log(`Deleted ${result.count} demo subjects.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
