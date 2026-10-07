type SiteConfig = {
  brandName: string;
  tagline: { ar: string; en: string };
  logo: {
    alt: string;
    variations: {
      horizontal: string | null;
      vertical: string | null;
      mark: string | null;
      navy: string | null;
      reversed: string | null;
    };
  };
  contact: { whatsapp: string | null; email: string | null; address: string | null };
};

// Logo files stay null until the owner provides the exports from the brand PDF.
// Do not recreate the mark in code. Tagline comes from CONTEXT.md §3.
export const siteConfig: SiteConfig = {
  brandName: "Zarabicschool",
  tagline: {
    ar: "تعلّم العربية والقرآن ... بنيَة تضيء قلبك",
    en: "Learn Arabic & Quran... with a foundation that lights your heart",
  },
  logo: {
    alt: "Zarabicschool",
    variations: {
      horizontal: null,
      vertical: null,
      mark: null,
      navy: null,
      reversed: null,
    },
  },
  contact: {
    whatsapp: null,
    email: null,
    address: null,
  },
};
