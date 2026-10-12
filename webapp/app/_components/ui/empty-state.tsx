import Icon from "./icon";

export default function EmptyState({
  icon = "inbox",
  title,
  description,
}: {
  icon?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="rounded-xl bg-surface-container-low p-3 text-on-surface-variant">
        <Icon name={icon} size={28} />
      </span>
      <p className="text-title-md text-on-surface">{title}</p>
      {description ? <p className="max-w-md text-body-sm text-on-surface-variant">{description}</p> : null}
    </div>
  );
}
