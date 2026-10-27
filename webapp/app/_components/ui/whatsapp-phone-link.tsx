import { toWaMeLink } from "../../../lib/messaging/phone";
import Icon from "./icon";

/**
 * Phone number + WhatsApp icon for staff views (S-05 / D17): a plain wa.me link that
 * opens the staff member's OWN WhatsApp (never OpenWA). Numbers are normalized to
 * international digits by the shared helper; an unaddressable number gets no link
 * (a guessed country code would message a stranger). Numbers are never logged.
 */
export default function WhatsAppPhoneLink({ phone, label }: { phone: string | null | undefined; label: string }) {
  if (!phone) return <span className="opacity-50">—</span>;
  const href = toWaMeLink(phone);
  return (
    <span className="inline-flex items-center gap-2">
      <bdi dir="ltr">{phone}</bdi>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          title={label}
          className="inline-flex items-center rounded-full bg-secondary p-1 text-on-secondary hover:opacity-90"
        >
          <Icon name="chat" size={16} />
        </a>
      ) : null}
    </span>
  );
}
