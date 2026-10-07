import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { siteConfig } from "../../lib/site-config";

export default async function LogoPlaceholder({
  size = 56,
  inverted = false,
}: {
  size?: number;
  inverted?: boolean;
}) {
  const t = await getTranslations("brand");
  const name = t("name");
  const src = siteConfig.logo.variations.mark;

  if (src) {
    return (
      <Image
        src={src}
        alt={siteConfig.logo.alt || name}
        width={size}
        height={size}
        priority
        className="h-full w-full object-contain"
      />
    );
  }

  return (
    <span
      className={`flex h-full w-full items-center justify-center rounded-lg border border-dashed border-[var(--line)] px-1 text-center text-[0.6rem] font-semibold leading-tight ${
        inverted ? "text-white/80" : "text-[var(--navy)]/70"
      }`}
      style={{ width: size, height: size }}
      aria-label={name}
    >
      {name}
    </span>
  );
}
