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
  const src = siteConfig.logo.src;

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
      className={`flex h-full w-full items-end justify-center overflow-hidden border-2 border-[var(--gold)] bg-transparent ${
        inverted ? "text-white" : "text-[var(--navy)]"
      }`}
      style={{
        width: size,
        height: size,
        borderRadius: `${size}px ${size}px ${size * 0.18}px ${size * 0.18}px / ${size}px ${size}px ${size * 0.42}px ${size * 0.42}px`,
      }}
      aria-label={name}
    >
      <span className="mb-[18%] px-1 text-center text-[0.65rem] font-bold leading-tight">{name}</span>
    </span>
  );
}
