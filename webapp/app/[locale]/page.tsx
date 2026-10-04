import { BookOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";

import ApplyRoles from "../_components/landing/apply-roles";
import ClosingCta from "../_components/landing/closing-cta";
import FaqAccordion from "../_components/landing/faq-accordion";
import FeaturesStrip from "../_components/landing/features-strip";
import Hero from "../_components/landing/hero";
import HowToStart from "../_components/landing/how-to-start";
import SiteFooter from "../_components/landing/site-footer";
import SiteHeader from "../_components/landing/site-header";
import SubjectsSection from "../_components/landing/subjects-section";
import WhyUs from "../_components/landing/why-us";
import LogoPlaceholder from "../_components/logo-placeholder";

export default async function Home() {
  const t = await getTranslations("common");

  return (
    <div id="top" className="min-h-screen">
      <a href="#main" className="skip-link">
        {t("skipToContent")}
      </a>
      <SiteHeader logo={<LogoPlaceholder />} />
      <main id="main">
        <Hero
          visual={
            <BookOpen aria-hidden className="h-14 w-14 text-[var(--gold)]" strokeWidth={1.5} />
          }
        />
        <FeaturesStrip />
        <SubjectsSection />
        <WhyUs />
        <HowToStart />
        <ApplyRoles />
        <FaqAccordion />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
