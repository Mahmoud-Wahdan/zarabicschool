import FaqAccordion from "../_components/landing/faq-accordion";
import MobileNavigation from "../_components/landing/mobile-navigation";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "../../i18n/navigation";
import { getPublicWhatsAppLink } from "../../lib/messaging/contact-number";
import { getPublicBusinessContact, getPublicPlanPrices } from "../../lib/public-academy";
import { buildPublicMetadata, getSiteOrigin } from "../../lib/seo";
import Icon, { type IconName } from "../_components/ui/icon";
import ThemeSwitch from "../_components/theme-switch";
import "./minimal-landing.css";

type Card = { title: string; body: string; badge?: string };
type FaqItem = { q: string; a: string };
const icons: IconName[] = ["menu_book", "mic", "auto_stories", "group", "description", "schedule", "verified_user"];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "minimalLanding" });
  const isAr = locale === "ar";
  return buildPublicMetadata({
    locale,
    path: "/",
    title: isAr
      ? "Zarabicschool — أكاديمية تعليم اللغة العربية والقرآن الكريم مباشرة أونلاين"
      : "Zarabicschool — Live Online Arabic, Quran & Tajweed Academy",
    description: t("intro"),
  });
}

function Brand({ hero = false, footer = false }: { hero?: boolean; footer?: boolean }) {
  return <span className={hero ? "ml-art" : "ml-brand"} aria-label="Zarabicschool">
    {(["light", "dark"] as const).map(theme => <Image key={theme} className={theme} src={`/Brand/minimal-${theme}-${hero ? "hero" : footer ? "footer" : "header"}.png`} width={hero ? 480 : 204} height={hero ? 450 : 76} alt="Zarabicschool" unoptimized />)}
  </span>;
}

export default async function Home() {
  const [t, common, faqT, locale, whatsapp] = await Promise.all([
    getTranslations("minimalLanding"),
    getTranslations("common"),
    getTranslations("faq"),
    getLocale(),
    getPublicWhatsAppLink(),
  ]);
  const publicPages = await getTranslations("legal");
  const prices = getPublicPlanPrices(locale);
  const contact = getPublicBusinessContact(locale, whatsapp);
  const origin = getSiteOrigin();
  const cards = t.raw("cards") as Card[];
  const faqItems = faqT.raw("items") as FaqItem[];
  const planCards = cards.slice(11, 13);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        url: origin,
        name: "Zarabicschool",
        inLanguage: ["ar", "en"],
        publisher: { "@id": `${origin}/#academy` },
      },
      {
        "@type": "EducationalOrganization",
        "@id": `${origin}/#academy`,
        name: "Zarabicschool",
        alternateName: "المدرسة العربية",
        url: origin,
        logo: `${origin}/Brand/minimal-light-hero.png`,
        description: t("intro"),
        email: contact.email,
        ...(contact.phone ? { telephone: contact.phone } : {}),
        address: {
          "@type": "PostalAddress",
          addressLocality: "Quesna",
          addressRegion: "Menoufia",
          addressCountry: "EG",
        },
        ...(whatsapp ? { sameAs: [whatsapp] } : {}),
        makesOffer: planCards.flatMap((plan, index) => {
          const price = prices[index];
          const entries = [];
          if (price?.egpAmount) {
            entries.push({
              "@type": "Offer",
              name: plan.title,
              description: plan.body,
              price: price.egpAmount,
              priceCurrency: "EGP",
              url: `${origin}/${locale}/apply`,
            });
          }
          if (price?.usdAmount) {
            entries.push({
              "@type": "Offer",
              name: plan.title,
              description: plan.body,
              price: price.usdAmount,
              priceCurrency: "USD",
              url: `${origin}/${locale}/apply`,
            });
          }
          return entries;
        }),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.a,
          },
        })),
      },
    ],
  };
  const links = [["home", "#top"], ["navPrograms", "#curriculum-section"], ["navPlans", "#pricing-plans"], ["faq", "#faq"]] as const;
  const nav = [
    ...links.map(([key, href]) => <a key={key} href={href}>{t(key)}</a>),
    <Link key="contact" href="/contact">{publicPages("contact.title")}</Link>,
  ];
  const apply = <Link className="ml-button" href="/apply">{t("apply")}</Link>;
  const sections = [
    {id:"curriculum-section", title:"programs", sub:"programSub", start:0,end:3},
    {id:"how-to-start", title:"steps", sub:"stepSub", start:3,end:7},
    {id:"about-academy", title:"benefits", sub:"benefitSub", start:7,end:11},
    {id:"pricing-plans", title:"plans", sub:"planSub", start:11,end:13},
  ] as const;
  return <div className="minimal-landing" id="top">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <a href="#main" className="skip-link">{common("skipToContent")}</a>
    <header><div className="ml-wrap ml-bar"><a href="#top"><Brand /></a><nav>{nav}</nav><div className="ml-controls"><ThemeSwitch /><Link href="/" locale={locale === "ar" ? "en" : "ar"}>{locale === "ar" ? "EN" : "ع"}</Link><Link className="ml-login" href="/login">{t("login")}</Link>{apply}</div>
    <MobileNavigation>{nav}<Link href="/login">{t("login")}</Link>{apply}</MobileNavigation></div></header>
    <main id="main"><section className="ml-hero"><div className="ml-wrap"><div><small>{t("badge")}</small><h1>{t("headline")}<em>{t("accent")}</em></h1><p>{t("intro")}</p><div className="ml-actions">{apply}{whatsapp && <a className="ml-outline" href={whatsapp}>{t("whatsapp")}</a>}</div><ul>{t("facts").split(" · ").map(f=><li key={f}>{f}</li>)}</ul></div><Brand hero /></div></section>
    {sections.map(s=><section className={`ml-section ml-${s.title}`} id={s.id} key={s.id}><div className="ml-wrap"><h2>{t(s.title)}</h2><p className="ml-sub">{t(s.sub)}</p><div className="ml-grid">{cards.slice(s.start,s.end).map((c,i)=><article key={c.title}>
    {s.title==="steps" ? <b className="ml-icon">{i+1}</b> : s.title==="plans" ? <small>{c.badge}</small> : <b className="ml-icon"><Icon name={icons[s.title==="programs"?i:i+3]} size={24}/></b>}
    <h3>{c.title}</h3><p>{c.body}</p>{s.title==="plans" && <><p className="ml-price"><strong>{prices[i]?.egp ?? t("price")}</strong>{prices[i]?.egp && <> {t(i === 0 ? "perMonth" : "perLesson")}</>}{prices[i]?.usd && <span className="ml-price-usd">{prices[i].usd} {t(i === 0 ? "perMonth" : "perLesson")}</span>}</p><Link className="ml-outline" href="/apply">{t("details")}</Link></>}</article>)}</div></div></section>)}
    <FaqAccordion />
    <section id="admissions-form" className="ml-banner"><h2>{t("banner")}</h2><p>{t("bannerSub")}</p>{apply}</section></main>
    <footer id="contact"><div className="ml-wrap"><div className="ml-footer"><div><Brand footer/><p>{t("headline")}… {t("accent")}</p></div><div><h3>{t("quick")}</h3>{nav.slice(0,4)}<Link href="/about">{publicPages("about.title")}</Link><Link href="/terms">{t("termsLink")}</Link><Link href="/privacy">{t("privacyLink")}</Link><Link href="/refund-policy">{t("refundLink")}</Link></div><div><h3>{t("contact")}</h3><Link href="/contact">{publicPages("contact.title")}</Link><Link href="/service-delivery">{publicPages("delivery.title")}</Link>{whatsapp && <a href={whatsapp}>{t("whatsapp")}</a>}<Link href="/login">{t("login")}</Link></div></div><p className="ml-rights">© {new Date().getFullYear()} Zarabicschool · {t("rights")}</p></div></footer>
  </div>;
}