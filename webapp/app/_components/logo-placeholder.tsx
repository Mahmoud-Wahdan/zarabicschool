import Image from "next/image";

import { siteConfig } from "../../lib/site-config";

export default function LogoPlaceholder({
  size = 56,
  inverted = false,
}: {
  size?: number;
  inverted?: boolean;
}) {
  return (
    <Image
      src={siteConfig.logo.variations.mark}
      alt={siteConfig.logo.alt}
      width={size}
      height={Math.round(size * 282 / 267)}
      className={`h-full w-full object-contain ${inverted ? "" : "rounded-md bg-[#0b1f38] p-1.5"}`}
    />
  );
}
