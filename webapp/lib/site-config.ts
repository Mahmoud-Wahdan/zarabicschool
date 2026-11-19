type SiteConfig = {
  brandName: string;
  tagline: { ar: string; en: string };
  logo: {
    alt: string;
    variations: {
      horizontal: string | null;
      vertical: string | null;
      mark: string;
      navy: string | null;
      reversed: string;
    };
  };
  contact: { whatsapp: string | null; email: string | null; address: string | null };
};

// Cropped from the official transparent reversed lockup in the academy's Figma file.
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
      mark: "/Brand/academy-mark.png",
      navy: null,
      reversed: "/Brand/academy-lockup-white.png",
    },
  },
  contact: {
    whatsapp: null,
    email: null,
    address: null,
  },
};
