import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: "../.env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";

const academyName = "Zarabicschool";

const demoSubjects = [
  {
    slug: "demo-quran",
    nameAr: "القرآن الكريم",
    nameEn: "Quran",
    descriptionAr: "تلاوة وتجويد وحفظ بإشراف معلمات متخصصات",
    descriptionEn: "Recitation, tajweed, and memorization with specialized female teachers",
    icon: "book-open",
    sortOrder: 1,
  },
  {
    slug: "demo-arabic",
    nameAr: "اللغة العربية",
    nameEn: "Arabic",
    descriptionAr: "قراءة وكتابة ونحو بأسلوب يناسب مستوى كل طالب",
    descriptionEn: "Reading, writing, and grammar matched to each student's level",
    icon: "languages",
    sortOrder: 2,
  },
  {
    slug: "demo-english",
    nameAr: "اللغة الإنجليزية",
    nameEn: "English",
    descriptionAr: "محادثة وقواعد ومفردات لتتكلم بثقة",
    descriptionEn: "Conversation, grammar, and vocabulary to speak with confidence",
    icon: "message-circle",
    sortOrder: 3,
  },
  {
    slug: "demo-fiqh",
    nameAr: "الفقه",
    nameEn: "Fiqh",
    descriptionAr: "تعلّم أحكام العبادات والمعاملات بأسلوب مبسّط",
    descriptionEn: "Rulings of worship and transactions, explained simply",
    icon: "scale",
    sortOrder: 4,
  },
  {
    slug: "demo-math",
    nameAr: "الرياضيات",
    nameEn: "Math",
    descriptionAr: "شرح مبسّط وتدريب مستمر يبني الفهم قبل الحفظ",
    descriptionEn: "Clear explanation and ongoing practice that builds understanding before memorization",
    icon: "calculator",
    sortOrder: 5,
  },
];

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the demo seed.`);
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

    for (const subject of demoSubjects) {
      await prisma.subject.upsert({
        where: {
          academyId_slug: { academyId: academy.id, slug: subject.slug },
        },
        update: {
          nameAr: subject.nameAr,
          nameEn: subject.nameEn,
          descriptionAr: subject.descriptionAr,
          descriptionEn: subject.descriptionEn,
          icon: subject.icon,
          sortOrder: subject.sortOrder,
          isActive: true,
        },
        create: {
          academyId: academy.id,
          ...subject,
          isActive: true,
        },
      });
    }

    console.log(`Seeded ${demoSubjects.length} demo subjects (slug prefix demo-).`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
