import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { Link } from "../../../i18n/navigation";
import GeometricPattern from "./geometric-pattern";

export default async function Hero({ visual }: { visual: ReactNode }) {
  const t = await getTranslations("hero");
  const trust = t.raw("trust") as string[];

  return (
    <section className="relative overflow-hidden bg-[var(--navy)] text-white">
      <GeometricPattern />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:py-24">
        <div>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-white/90 sm:text-lg">{t("subtitle")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#apply" className="cta-primary">
              {t("primaryCta")}
            </a>
            <Link href="/login" className="cta-secondary border-white text-white hover:bg-white/10">
              {t("secondaryCta")}
            </Link>
          </div>
          <ul className="mt-8 flex flex-col gap-2 text-sm text-white/85 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {trust.map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mx-auto flex h-[320px] w-full max-w-[280px] items-end justify-center sm:h-[380px] sm:max-w-[320px]">
          <div
            className="relative flex h-full w-full items-center justify-center border-[3px] border-[var(--gold)] bg-[var(--navy)]"
            style={{
              borderRadius: "160px 160px 28px 28px / 160px 160px 72px 72px",
            }}
          >
            <div className="flex h-28 w-28 items-center justify-center">{visual}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
