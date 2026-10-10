"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { wallClockInputToUtc } from "../../../../lib/schedules/recurrence";
import { validateZoomUrl, type ZoomUrlValidation } from "../../../../lib/validation/zoom-url";

export type TeacherOption = { id: string; displayName: string };
export type SubjectOption = { id: string; nameEn: string; nameAr: string };
export type BusySlot = {
  id: string;
  scheduledStart: string;
  scheduledEnd: string;
  sessionType: string;
  subject: { nameEn: string; nameAr: string };
};
export type AssignedStudentsGroup = { subjectId: string; students: { studentId: string; displayName: string }[] };
export type TeacherContext = {
  subjects: SubjectOption[];
  busySlots: BusySlot[];
  assignedStudents: AssignedStudentsGroup[];
};

export type ContextState = "idle" | "loading" | "ready" | "error";

function dayWindowUtc(day: string, timeZone: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const from = wallClockInputToUtc(`${day}T00:00`, timeZone);
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * Shared state for the single-session and weekly-series forms:
 * teacher -> their subjects -> assigned students -> busy slots for the chosen day,
 * with subject/student resets and real-time Zoom link feedback.
 * The API remains the final authority; this is guidance only.
 */
export function useSmartSessionForm(viewerTimezone: string) {
  const [teacherId, setTeacherId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [sessionType, setSessionType] = useState("PRIVATE");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [timezone, setTimezone] = useState(viewerTimezone);
  const [zoomJoinUrl, setZoomJoinUrl] = useState("");
  const [zoomHostUrl, setZoomHostUrl] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [weekCount, setWeekCount] = useState(8);

  const [context, setContext] = useState<TeacherContext | null>(null);
  const [contextState, setContextState] = useState<ContextState>("idle");

  const selectTeacher = useCallback((nextTeacherId: string) => {
    setTeacherId(nextTeacherId);
    setSubjectId("");
    setStudentIds([]);
    setContext(null);
    setContextState(nextTeacherId ? "loading" : "idle");
  }, []);

  const selectSubject = useCallback((nextSubjectId: string) => {
    setSubjectId(nextSubjectId);
    setStudentIds([]);
  }, []);

  useEffect(() => {
    if (!teacherId) return;
    let cancelled = false;
    fetch(`/api/admin/teachers/${teacherId}/context`)
      .then(async (response) => {
        if (!response.ok) throw new Error("context failed");
        const payload = (await response.json()) as { data?: TeacherContext };
        if (cancelled) return;
        setContext(payload.data ?? { subjects: [], busySlots: [], assignedStudents: [] });
        setContextState("ready");
      })
      .catch(() => {
        if (!cancelled) setContextState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  const subjects = useMemo(() => context?.subjects ?? [], [context]);
  const assignedStudents = useMemo(
    () => context?.assignedStudents.find((group) => group.subjectId === subjectId)?.students ?? [],
    [context, subjectId],
  );
  const busySlotsForDay = useMemo(() => {
    if (!context || !scheduledStart) return [];
    const day = scheduledStart.slice(0, 10);
    const window = dayWindowUtc(day, timezone);
    if (!window) return [];
    return context.busySlots.filter((slot) => {
      const start = new Date(slot.scheduledStart).getTime();
      return start >= window.from.getTime() && start < window.to.getTime();
    });
  }, [context, scheduledStart, timezone]);

  const selectedRange = useMemo(() => {
    if (!scheduledStart || !scheduledEnd) return null;
    const start = wallClockInputToUtc(scheduledStart, timezone);
    const end = wallClockInputToUtc(scheduledEnd, timezone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    return { start, end };
  }, [scheduledStart, scheduledEnd, timezone]);

  const conflictSlots = useMemo(() => {
    if (!selectedRange) return [];
    return busySlotsForDay.filter((slot) => {
      const slotStart = new Date(slot.scheduledStart).getTime();
      const slotEnd = new Date(slot.scheduledEnd).getTime();
      return slotStart < selectedRange.end.getTime() && slotEnd > selectedRange.start.getTime();
    });
  }, [busySlotsForDay, selectedRange]);

  const zoomJoinCheck: ZoomUrlValidation | null = zoomJoinUrl ? validateZoomUrl(zoomJoinUrl) : null;
  const zoomHostCheck: ZoomUrlValidation | null = zoomHostUrl ? validateZoomUrl(zoomHostUrl) : null;

  function toggleStudent(studentId: string) {
    setStudentIds((current) =>
      current.includes(studentId) ? current.filter((item) => item !== studentId) : [...current, studentId],
    );
  }

  function toUtcIso(value: string): string | null {
    if (!value) return null;
    try {
      return wallClockInputToUtc(value, timezone).toISOString();
    } catch {
      return null;
    }
  }

  return {
    teacherId,
    subjectId,
    sessionType,
    scheduledStart,
    scheduledEnd,
    timezone,
    zoomJoinUrl,
    zoomHostUrl,
    studentIds,
    weekCount,
    context,
    contextState,
    subjects,
    assignedStudents,
    busySlotsForDay,
    conflictSlots,
    zoomJoinCheck,
    zoomHostCheck,
    selectedRange,
    selectTeacher,
    selectSubject,
    setSessionType,
    setScheduledStart,
    setScheduledEnd,
    setTimezone,
    setZoomJoinUrl,
    setZoomHostUrl,
    setWeekCount,
    toggleStudent,
    toUtcIso,
  };
}

export function useTeacherOptions() {
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [teachersState, setTeachersState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/profiles?type=teacher")
      .then(async (response) => {
        if (!response.ok) throw new Error("teachers failed");
        const payload = (await response.json()) as { data?: { id: string; displayName: string; teacherProfile?: { id: string } | null }[] };
        if (cancelled) return;
        setTeachers((payload.data ?? []).map((teacher) => ({
          id: teacher.teacherProfile?.id ?? teacher.id,
          displayName: teacher.displayName,
        })));
        setTeachersState("ready");
      })
      .catch(() => {
        if (!cancelled) setTeachersState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { teachers, teachersState };
}
