/**
 * Report languages (owner, 2026-10-18 — CONTEXT §9): teachers write each
 * student's reports in the student's language: ar / en / fr / de / tr.
 *
 * This module is PURE DATA — no "server-only", because report forms and
 * report views are client components that render labels/options/placeholders
 * in the REPORT language. The site UI locale stays ar/en (next-intl); the
 * report language is a separate axis (no machine translation — the teacher
 * writes the free text in this language, and every viewer sees the report in
 * the language it was written, with the correct dir).
 */

export const REPORT_LANGUAGES = ["ar", "en", "fr", "de", "tr"] as const;

export type ReportLanguageCode = (typeof REPORT_LANGUAGES)[number];

export const REPORT_LANGUAGE_OPTIONS: { value: ReportLanguageCode; nativeName: string }[] = [
  { value: "ar", nativeName: "العربية" },
  { value: "en", nativeName: "English" },
  { value: "fr", nativeName: "Français" },
  { value: "de", nativeName: "Deutsch" },
  { value: "tr", nativeName: "Türkçe" },
];

export function isReportLanguage(value: unknown): value is ReportLanguageCode {
  return typeof value === "string" && (REPORT_LANGUAGES as readonly string[]).includes(value);
}

/** Fallback is ar (the schema default). */
export function resolveReportLanguage(value: string | null | undefined): ReportLanguageCode {
  return isReportLanguage(value) ? value : "ar";
}

export function reportDir(lang: ReportLanguageCode): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/** A class-remark option as stored in AcademySettings (see lib/reports/class-remarks.ts). */
export type ClassRemarkOptionLike = {
  slug: string;
  labels: Partial<Record<ReportLanguageCode, string>>;
};

/** Resolve a stored class-remark slug to its label in the report's language (fallback: en, then the slug). Pure — client-safe. */
export function classRemarkLabel(
  options: ClassRemarkOptionLike[],
  slug: string | null | undefined,
  lang: ReportLanguageCode,
): string {
  if (!slug) return "";
  const option = options.find((candidate) => candidate.slug === slug);
  if (!option) return slug;
  return option.labels[lang] ?? option.labels.en ?? slug;
}

// ---------------------------------------------------------------------------
// Session report form content (End class) — CONTEXT §9 stream 1.
// ---------------------------------------------------------------------------

export type SessionReportContent = {
  attendanceLabel: string;
  attendanceAttended: string;
  attendanceAbsent: string;
  frozenHint: string;
  classRemarkLabel: string;
  summaryLabel: string;
  summaryPlaceholder: string;
  homeworkLabel: string;
  homeworkPlaceholder: string;
  homeworkHint: string;
  notesLabel: string;
  notesPlaceholder: string;
  optionalLabel: string;
  extraTimeLabel: string;
  operationalEventsLabel: string;
  operationalEventsHint: string;
  operationalEventsPlaceholder: string;
  attachmentsLabel: string;
  languageLabel: string;
  requiredMessage: string;
  tooShortMessage: string;
  submitLabel: string;
  resubmitLabel: string;
  submittingLabel: string;
};

export const SESSION_REPORT_CONTENT: Record<ReportLanguageCode, SessionReportContent> = {
  ar: {
    attendanceLabel: "حضور الطالب",
    attendanceAttended: "حضر الطالب",
    attendanceAbsent: "غاب الطالب",
    frozenHint: "يُقفل بعد الإرسال الأول؛ التصحيح يتم عبر الإدارة.",
    classRemarkLabel: "تقدير الحصة",
    summaryLabel: "ملخص الحصة",
    summaryPlaceholder: "ما الذي تم دراسته وكيف كان أداء الطالب؟",
    homeworkLabel: "الواجب",
    homeworkPlaceholder: "اكتب الواجب المطلوب…",
    homeworkHint: "مطلوب — يراه الطالب.",
    notesLabel: "ملاحظات",
    notesPlaceholder: "ملاحظات إضافية…",
    optionalLabel: "اختياري",
    extraTimeLabel: "وقت إضافي (بالدقائق)",
    operationalEventsLabel: "أحداث تشغيلية",
    operationalEventsHint: "حقائق للاطلاع فقط (دخول متأخر، انقطاع…) — لا تحدد الحضور تلقائيًا.",
    operationalEventsPlaceholder: '{"late_entry_minutes": 5}',
    attachmentsLabel: "مرفقات (JPEG/PNG/WebP/PDF، بحد أقصى 10 ميجابايت للملف)",
    languageLabel: "لغة التقرير",
    requiredMessage: "هذا الحقل مطلوب.",
    tooShortMessage: "النص قصير جدًا.",
    submitLabel: "إرسال التقرير",
    resubmitLabel: "إعادة إرسال التقرير",
    submittingLabel: "جارٍ الإرسال…",
  },
  en: {
    attendanceLabel: "Student attendance",
    attendanceAttended: "Student attended",
    attendanceAbsent: "Student was absent",
    frozenHint: "Locked after the first submission; a wrong outcome is corrected by Admin.",
    classRemarkLabel: "Class remark",
    summaryLabel: "Lesson summary",
    summaryPlaceholder: "What was covered and how the student did…",
    homeworkLabel: "Homework",
    homeworkPlaceholder: "Describe the homework…",
    homeworkHint: "Required — the student sees the homework.",
    notesLabel: "Notes",
    notesPlaceholder: "Optional notes…",
    optionalLabel: "optional",
    extraTimeLabel: "Extra time (minutes)",
    operationalEventsLabel: "Operational events",
    operationalEventsHint: "Facts for review only (late entry, disconnection…) — never decides attendance automatically.",
    operationalEventsPlaceholder: '{"late_entry_minutes": 5}',
    attachmentsLabel: "Attachments (JPEG/PNG/WebP/PDF, max 10 MB each)",
    languageLabel: "Report language",
    requiredMessage: "This field is required.",
    tooShortMessage: "The text is too short.",
    submitLabel: "Submit report",
    resubmitLabel: "Resubmit report",
    submittingLabel: "Submitting…",
  },
  fr: {
    attendanceLabel: "Présence de l'élève",
    attendanceAttended: "L'élève était présent",
    attendanceAbsent: "L'élève était absent",
    frozenHint: "Verrouillé après le premier envoi ; une erreur est corrigée par l'administration.",
    classRemarkLabel: "Remarque sur le cours",
    summaryLabel: "Résumé du cours",
    summaryPlaceholder: "Ce qui a été étudié et comment l'élève a progressé…",
    homeworkLabel: "Devoirs",
    homeworkPlaceholder: "Décrivez les devoirs…",
    homeworkHint: "Obligatoire — l'élève voit les devoirs.",
    notesLabel: "Remarques",
    notesPlaceholder: "Remarques facultatives…",
    optionalLabel: "facultatif",
    extraTimeLabel: "Temps supplémentaire (minutes)",
    operationalEventsLabel: "Événements opérationnels",
    operationalEventsHint: "Faits pour examen uniquement (retard, déconnexion…) — ne détermine jamais la présence automatiquement.",
    operationalEventsPlaceholder: '{"late_entry_minutes": 5}',
    attachmentsLabel: "Pièces jointes (JPEG/PNG/WebP/PDF, max 10 Mo chacune)",
    languageLabel: "Langue du rapport",
    requiredMessage: "Ce champ est obligatoire.",
    tooShortMessage: "Le texte est trop court.",
    submitLabel: "Envoyer le rapport",
    resubmitLabel: "Renvoyer le rapport",
    submittingLabel: "Envoi en cours…",
  },
  de: {
    attendanceLabel: "Anwesenheit des Schülers",
    attendanceAttended: "Schüler war anwesend",
    attendanceAbsent: "Schüler war abwesend",
    frozenHint: "Nach der ersten Einreichung gesperrt; eine falsche Angabe wird von der Verwaltung korrigiert.",
    classRemarkLabel: "Bemerkung zur Unterrichtsstunde",
    summaryLabel: "Zusammenfassung der Unterrichtsstunde",
    summaryPlaceholder: "Was behandelt wurde und wie der Schüler abgeschnitten hat…",
    homeworkLabel: "Hausaufgabe",
    homeworkPlaceholder: "Beschreiben Sie die Hausaufgabe…",
    homeworkHint: "Pflichtfeld — der Schüler sieht die Hausaufgabe.",
    notesLabel: "Notizen",
    notesPlaceholder: "Optionale Notizen…",
    optionalLabel: "optional",
    extraTimeLabel: "Zusatzzeit (Minuten)",
    operationalEventsLabel: "Betriebliche Ereignisse",
    operationalEventsHint: "Nur Fakten zur Prüfung (Verspätung, Verbindungsabbruch…) — entscheidet nie automatisch über die Anwesenheit.",
    operationalEventsPlaceholder: '{"late_entry_minutes": 5}',
    attachmentsLabel: "Anhänge (JPEG/PNG/WebP/PDF, max 10 MB pro Datei)",
    languageLabel: "Berichtssprache",
    requiredMessage: "Dieses Feld ist erforderlich.",
    tooShortMessage: "Der Text ist zu kurz.",
    submitLabel: "Bericht senden",
    resubmitLabel: "Bericht erneut senden",
    submittingLabel: "Wird gesendet…",
  },
  tr: {
    attendanceLabel: "Öğrencinin devam durumu",
    attendanceAttended: "Öğrenci derse katıldı",
    attendanceAbsent: "Öğrenci derse katılmadı",
    frozenHint: "İlk gönderimden sonra kilitlenir; hatalı durum yönetim tarafından düzeltilir.",
    classRemarkLabel: "Ders değerlendirmesi",
    summaryLabel: "Ders özeti",
    summaryPlaceholder: "İşlenen konular ve öğrencinin performansı…",
    homeworkLabel: "Ödev",
    homeworkPlaceholder: "Ödevi açıklayın…",
    homeworkHint: "Zorunlu — öğrenci ödevi görür.",
    notesLabel: "Notlar",
    notesPlaceholder: "İsteğe bağlı notlar…",
    optionalLabel: "isteğe bağlı",
    extraTimeLabel: "Ek süre (dakika)",
    operationalEventsLabel: "Operasyonel olaylar",
    operationalEventsHint: "Yalnızca inceleme amaçlı bilgiler (geç giriş, bağlantı kesintisi…) — devamsızlığı otomatik belirlemez.",
    operationalEventsPlaceholder: '{"late_entry_minutes": 5}',
    attachmentsLabel: "Ekler (JPEG/PNG/WebP/PDF, dosya başına en fazla 10 MB)",
    languageLabel: "Rapor dili",
    requiredMessage: "Bu alan zorunludur.",
    tooShortMessage: "Metin çok kısa.",
    submitLabel: "Raporu gönder",
    resubmitLabel: "Raporu yeniden gönder",
    submittingLabel: "Gönderiliyor…",
  },
};

// ---------------------------------------------------------------------------
// Monthly report form content (CONTEXT §9 stream 2).
// ---------------------------------------------------------------------------

export type MonthlyReportContent = {
  monthLabel: string;
  achievementLabel: string;
  achievementPlaceholder: string;
  learningProgressLabel: string;
  classFocusLabel: string;
  homeworkCompletionLabel: string;
  punctualityLabel: string;
  rescheduledSessionsLabel: string;
  supportAreasLabel: string;
  supportAreasPlaceholder: string;
  nextMonthObjectivesLabel: string;
  nextMonthObjectivesPlaceholder: string;
  languageLabel: string;
  requiredMessage: string;
  tooShortMessage: string;
  submitLabel: string;
  saveLabel: string;
};

export const MONTHLY_REPORT_CONTENT: Record<ReportLanguageCode, MonthlyReportContent> = {
  ar: {
    monthLabel: "الشهر",
    achievementLabel: "إنجاز الشهر",
    achievementPlaceholder: "ما أنجزه الطالب خلال هذا الشهر…",
    learningProgressLabel: "مستوى التقدم",
    classFocusLabel: "النشاط والتركيز في الحصة",
    homeworkCompletionLabel: "إنجاز الواجبات والمهام",
    punctualityLabel: "الالتزام بالموعد",
    rescheduledSessionsLabel: "حصص تم تأجيلها هذا الشهر",
    supportAreasLabel: "جوانب تحتاج دعمًا إضافيًا",
    supportAreasPlaceholder: "مجالات تحتاج متابعة ودعمًا…",
    nextMonthObjectivesLabel: "أهداف التعلم للشهر القادم",
    nextMonthObjectivesPlaceholder: "ما التركيز عليه الشهر القادم…",
    languageLabel: "لغة التقرير",
    requiredMessage: "هذا الحقل مطلوب.",
    tooShortMessage: "النص قصير جدًا.",
    submitLabel: "إرسال التقرير الشهري",
    saveLabel: "حفظ التعديلات",
  },
  en: {
    monthLabel: "Month",
    achievementLabel: "Achievement over the month",
    achievementPlaceholder: "What the student achieved this month…",
    learningProgressLabel: "Learning progress",
    classFocusLabel: "Active and focused in class",
    homeworkCompletionLabel: "Completes homework and tasks",
    punctualityLabel: "Comes on time",
    rescheduledSessionsLabel: "Sessions rescheduled this month",
    supportAreasLabel: "Areas needing additional support",
    supportAreasPlaceholder: "Areas that need attention and support…",
    nextMonthObjectivesLabel: "Key learning objectives for next month",
    nextMonthObjectivesPlaceholder: "What to focus on next month…",
    languageLabel: "Report language",
    requiredMessage: "This field is required.",
    tooShortMessage: "The text is too short.",
    submitLabel: "Submit monthly report",
    saveLabel: "Save changes",
  },
  fr: {
    monthLabel: "Mois",
    achievementLabel: "Réalisations du mois",
    achievementPlaceholder: "Ce que l'élève a accompli ce mois-ci…",
    learningProgressLabel: "Progrès de l'apprentissage",
    classFocusLabel: "Actif et concentré en classe",
    homeworkCompletionLabel: "Fait les devoirs et les tâches",
    punctualityLabel: "Arrive à l'heure",
    rescheduledSessionsLabel: "Séances reportées ce mois-ci",
    supportAreasLabel: "Domaines nécessitant un soutien supplémentaire",
    supportAreasPlaceholder: "Domaines qui nécessitent un suivi et un soutien…",
    nextMonthObjectivesLabel: "Objectifs d'apprentissage clés pour le mois prochain",
    nextMonthObjectivesPlaceholder: "Sur quoi se concentrer le mois prochain…",
    languageLabel: "Langue du rapport",
    requiredMessage: "Ce champ est obligatoire.",
    tooShortMessage: "Le texte est trop court.",
    submitLabel: "Envoyer le rapport mensuel",
    saveLabel: "Enregistrer les modifications",
  },
  de: {
    monthLabel: "Monat",
    achievementLabel: "Leistungen des Monats",
    achievementPlaceholder: "Was der Schüler in diesem Monat erreicht hat…",
    learningProgressLabel: "Lernfortschritt",
    classFocusLabel: "Im Unterricht aktiv und konzentriert",
    homeworkCompletionLabel: "Erledigt Hausaufgaben und Aufgaben",
    punctualityLabel: "Kommt pünktlich",
    rescheduledSessionsLabel: "In diesem Monat verschobene Unterrichtsstunden",
    supportAreasLabel: "Bereiche mit zusätzlichem Förderbedarf",
    supportAreasPlaceholder: "Bereiche, die Aufmerksamkeit und Förderung brauchen…",
    nextMonthObjectivesLabel: "Wichtige Lernziele für den nächsten Monat",
    nextMonthObjectivesPlaceholder: "Worauf sich der nächste Monat konzentrieren soll…",
    languageLabel: "Berichtssprache",
    requiredMessage: "Dieses Feld ist erforderlich.",
    tooShortMessage: "Der Text ist zu kurz.",
    submitLabel: "Monatsbericht senden",
    saveLabel: "Änderungen speichern",
  },
  tr: {
    monthLabel: "Ay",
    achievementLabel: "Bu ayki başarılar",
    achievementPlaceholder: "Öğrencinin bu ay neler başardığı…",
    learningProgressLabel: "Öğrenme gelişimi",
    classFocusLabel: "Derste aktif ve odaklı",
    homeworkCompletionLabel: "Ödev ve görevleri tamamlıyor",
    punctualityLabel: "Zamanında katılıyor",
    rescheduledSessionsLabel: "Bu ay ertelenen dersler",
    supportAreasLabel: "Ek destek gerektiren alanlar",
    supportAreasPlaceholder: "Dikkat ve destek gerektiren alanlar…",
    nextMonthObjectivesLabel: "Gelecek ay için temel öğrenme hedefleri",
    nextMonthObjectivesPlaceholder: "Gelecek ay neye odaklanılacağı…",
    languageLabel: "Rapor dili",
    requiredMessage: "Bu alan zorunludur.",
    tooShortMessage: "Metin çok kısa.",
    submitLabel: "Aylık raporu gönder",
    saveLabel: "Değişiklikleri kaydet",
  },
};

// ---------------------------------------------------------------------------
// Enum option labels (monthly report bands). Used by the teacher form AND by
// every viewer — the report is shown in the language it was written (CONTEXT §9).
// ---------------------------------------------------------------------------

export type MonthlyLearningProgressKey = "EXCELLENT" | "VERY_GOOD" | "GOOD" | "VERY_SLOW_PROGRESS";
export type EngagementBandKey = "ALWAYS" | "OFTEN" | "SOMETIMES" | "RARELY";
export type HomeworkBandKey = "ALWAYS" | "MOST_OF_THE_TIME" | "SOMETIMES" | "RARELY";

export const MONTHLY_PROGRESS_LABELS: Record<ReportLanguageCode, Record<MonthlyLearningProgressKey, string>> = {
  ar: { EXCELLENT: "ممتاز", VERY_GOOD: "جيد جدًا", GOOD: "جيد", VERY_SLOW_PROGRESS: "تقدم بطيء جدًا" },
  en: { EXCELLENT: "Excellent", VERY_GOOD: "Very good", GOOD: "Good", VERY_SLOW_PROGRESS: "Very slow progress" },
  fr: { EXCELLENT: "Excellent", VERY_GOOD: "Très bien", GOOD: "Bien", VERY_SLOW_PROGRESS: "Progrès très lents" },
  de: { EXCELLENT: "Hervorragend", VERY_GOOD: "Sehr gut", GOOD: "Gut", VERY_SLOW_PROGRESS: "Sehr langsamer Fortschritt" },
  tr: { EXCELLENT: "Mükemmel", VERY_GOOD: "Çok iyi", GOOD: "İyi", VERY_SLOW_PROGRESS: "Çok yavaş gelişim" },
};

export const ENGAGEMENT_BAND_LABELS: Record<ReportLanguageCode, Record<EngagementBandKey, string>> = {
  ar: { ALWAYS: "دائمًا", OFTEN: "غالبًا", SOMETIMES: "أحيانًا", RARELY: "نادرًا" },
  en: { ALWAYS: "Always", OFTEN: "Often", SOMETIMES: "Sometimes", RARELY: "Rarely" },
  fr: { ALWAYS: "Toujours", OFTEN: "Souvent", SOMETIMES: "Parfois", RARELY: "Rarement" },
  de: { ALWAYS: "Immer", OFTEN: "Oft", SOMETIMES: "Manchmal", RARELY: "Selten" },
  tr: { ALWAYS: "Her zaman", OFTEN: "Çoğunlukla", SOMETIMES: "Bazen", RARELY: "Nadiren" },
};

export const HOMEWORK_BAND_LABELS: Record<ReportLanguageCode, Record<HomeworkBandKey, string>> = {
  ar: { ALWAYS: "دائمًا", MOST_OF_THE_TIME: "معظم الوقت", SOMETIMES: "أحيانًا", RARELY: "نادرًا" },
  en: { ALWAYS: "Always", MOST_OF_THE_TIME: "Most of the time", SOMETIMES: "Sometimes", RARELY: "Rarely" },
  fr: { ALWAYS: "Toujours", MOST_OF_THE_TIME: "La plupart du temps", SOMETIMES: "Parfois", RARELY: "Rarement" },
  de: { ALWAYS: "Immer", MOST_OF_THE_TIME: "Die meiste Zeit", SOMETIMES: "Manchmal", RARELY: "Selten" },
  tr: { ALWAYS: "Her zaman", MOST_OF_THE_TIME: "Çoğu zaman", SOMETIMES: "Bazen", RARELY: "Nadiren" },
};

/** Sessions rescheduled in the month: None / 1 / 2 / More than 2 (CONTEXT §9). */
export function rescheduledBandLabel(lang: ReportLanguageCode, count: number): string {
  if (count <= 0) return lang === "ar" ? "لا يوجد" : lang === "en" ? "None" : lang === "fr" ? "Aucune" : lang === "de" ? "Keine" : "Yok";
  if (count === 1) return "1";
  if (count === 2) return "2";
  return lang === "ar" ? "أكثر من اثنتين" : lang === "en" ? "More than 2" : lang === "fr" ? "Plus de 2" : lang === "de" ? "Mehr als 2" : "2'den fazla";
}
