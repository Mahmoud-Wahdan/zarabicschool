"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, Music, RefreshCw } from "lucide-react";

interface AudioPlayerProps {
  applicationId: string;
  format?: string | null;
}

export default function ApplicationAudioPlayer({
  applicationId,
  format,
}: AudioPlayerProps) {
  const t = useTranslations("adminApplications.detail");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAudio = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${encodeURIComponent(applicationId)}/media`);
      if (!res.ok) {
        throw new Error(`Failed to load audio (${res.status})`);
      }
      const data = await res.json();
      if (typeof data.url === "string") {
        setAudioUrl(data.url);
      } else {
        throw new Error("Invalid response");
      }
    } catch {
      setError(t("audioError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface p-3 text-sm text-on-surface-variant">
        <Loader2 className="h-4 w-4 animate-spin text-secondary" />
        <span>{t("audioLoading")}</span>
      </div>
    );
  }

  if (error || !audioUrl) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error || t("audioError")}</span>
        </div>
        <button
          type="button"
          onClick={fetchAudio}
          className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold text-error hover:bg-error/10"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{t("audioLoading") ? "Retry" : "إعادة المحاولة"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
      <div className="flex items-center justify-between gap-2 pb-2 text-xs text-on-surface-variant">
        <div className="flex items-center gap-1.5 font-medium text-primary">
          <Music className="h-4 w-4 text-secondary" />
          <span>{t("recitationAudio")}</span>
        </div>
        {format && (
          <span className="rounded bg-secondary/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase text-secondary">
            {format}
          </span>
        )}
      </div>
      <audio controls preload="metadata" className="w-full">
        <source src={audioUrl} />
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}
