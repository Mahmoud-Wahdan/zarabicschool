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
import Icon from "../_components/ui/icon";
import { getPublicWhatsAppLink } from "../../lib/messaging/contact-number";

export default async function Home() {
  const t = await getTranslations("common");
  const tFooter = await getTranslations("landing.footer");
  // Site WhatsApp contact (AcademySettings `site.whatsapp_number`, Admin-editable).
  const whatsappHref = await getPublicWhatsAppLink();

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
      <SiteFooter whatsappHref={whatsappHref} />
      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={tFooter("whatsappCta")}
          className="fixed bottom-4 end-4 z-40 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-3 text-label-md font-semibold text-on-secondary shadow-lg hover:opacity-90"
        >
          <Icon name="chat" size={20} />
          <span className="hidden sm:inline">{tFooter("whatsappCta")}</span>
        </a>
      ) : null}
    </div>
  );
}
