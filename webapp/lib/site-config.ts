type SiteConfig = {
  brandName: string;
  tagline: { ar: string; en: string };
  logo: { src: string | null; alt: string };
  contact: { whatsapp: string | null; email: string | null; address: string | null };
};

// PLACEHOLDERS (owner decision 2026-10-03): the logo is still being made and contact info
// comes later. Every placeholder below stays null until the owner provides the real value.
// Invent nothing — no claims, no prices. Tagline comes from CONTEXT.md §3 (confirmed).
export const siteConfig: SiteConfig = {
  brandName: "Zarabicschool",
  tagline: {
    ar: "تعلّم العربية والقرآن ... بنيَة تضيء قلبك",
    en: "Learn Arabic & Quran... with a foundation that lights your heart",
  },
  logo: {
    src: null,
    alt: "Zarabicschool",
  },
  contact: {
    whatsapp: null,
    email: null,
    address: null,
  },
};
