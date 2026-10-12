import { getTranslations } from "next-intl/server";

import ApplyRoles from "../_components/landing/apply-roles";
import FaqAccordion from "../_components/landing/faq-accordion";
import GuardianPreview from "../_components/landing/guardian-preview";
import Hero from "../_components/landing/hero";
import HowToStart from "../_components/landing/how-to-start";
import PricingPlans from "../_components/landing/pricing-plans";
import SiteFooter from "../_components/landing/site-footer";
import SiteHeader from "../_components/landing/site-header";
import SubjectsSection from "../_components/landing/subjects-section";
import TeacherBand from "../_components/landing/teacher-band";
import WhyUs from "../_components/landing/why-us";
import LogoPlaceholder from "../_components/logo-placeholder";

export default async function Home() {
  const t = await getTranslations("common");

  return (
    <div id="top" className="min-h-screen">
      <a href="#main" className="skip-link">
        {t("skipToContent")}
      </a>
      <SiteHeader logo={<LogoPlaceholder size={32} inverted />} />
      <main id="main" className="w-full bg-surface pt-20">
        <div className="flex w-full flex-col">
          <Hero />
          <SubjectsSection />
          <HowToStart />
          <WhyUs />
          <GuardianPreview />
          <TeacherBand />
          <PricingPlans />
          <FaqAccordion />
          <ApplyRoles />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
