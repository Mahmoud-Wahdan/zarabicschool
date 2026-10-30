# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

All roles carry the same design priority (owner, 2026-10-31):
- **Admin (SuperAdmin) and Supervisor:** run the academy day to day from a computer: applications, accounts, subjects and assignments, schedules and Zoom links, enrollments, report approval, outage/absence requests, complaints, announcements. Only the Admin sees money (invoices, refunds, renewals, payroll).
- **Teacher:** joins sessions through the platform's join button, writes a report per session and student, sees her schedule and her pay. Often on a phone.
- **Guardian:** one view across all linked children: schedule, attendance, remaining sessions, reports, invoices and payment. Usually arrives from a WhatsApp link on a phone.
- **Student:** own schedule, join button, homework and notes from reports. An adult student without a guardian also pays and sees the full report.

## Product Purpose

The operating system of Zarabicschool, an online academy teaching Arabic and Quran over Zoom: scheduling across time zones, report-gated teacher pay, packages and online payment (Paymob), WhatsApp notices. Success: the academy runs its week from one place, families always know what is next and what they paid for, and teachers are paid only for sessions that really happened.

## Positioning

Built for one academy first and meant to become a SaaS for other academies later. Against the incumbent (madarakeg.com): simpler, Zoom stays a plain link opened through the platform (the click time is logged), and teacher pay follows an approved report — a teacher who did not show up is not paid.

## Operating Context

- Arabic is the default language (RTL); English is complete; report languages also include fr, de, tr.
- Every time is shown in the viewer's own time zone; families live in many countries.
- WhatsApp (OpenWA) is a second channel; every notice also exists in the platform. Messages carry platform links, never raw Zoom links.
- Staging runs through an ngrok tunnel on the owner's PC; production hosting is still open.

## Capabilities and Constraints

- Next.js 16 App Router, next-intl (ar/en), Tailwind, Lucide icons (D71). The Stitch export ("Academic Precision" design system) is the UI reference; its tokens live in `webapp/app/globals.css`.
- Role-based access is strict: the Supervisor never sees money; a student with a guardian has no finance screens.
- Business rules, data and tests are fixed by the redesign: a visual change never changes behavior.

## Brand Commitments

- **Binding (owner, 2026-10-31):** the name Zarabicschool, the logo (ز and ع inside a mihrab/dome frame, from the brand PDF — never redrawn), and the colors Navy `#1B365D`, Emerald `#00897B`, Warm Gold `#D4AF37`.
- Typography from the brand guide: Cairo / Tajawal (Arabic), Montserrat (English).
- Tagline: "تعلّم العربية والقرآن ... بنيَة تضيء قلبك" / "Learn Arabic & Quran... with a foundation that lights your heart".

## Evidence on Hand

- Demo seed data only (staging); no real testimonials, customer counts or press. None may be invented on any page.
- Stitch export: on the owner's PC (`docs/stitch_zarabicschool_edtech_management_platform/`), not in the repository; `docs/specs/slices/S-14-stitch-map.md` maps its screens to pages.

## Product Principles

1. What is next comes first: the next session, the next action, the next payment.
2. Money is exact and visible only to whom it belongs.
3. One language at a time, fully: correct RTL, local digits and dates, the viewer's time zone.
4. Evidence over trust: reports, approvals and click logs, shown plainly — a click is never called attendance.
5. Calm operations: dense where the Admin works, simple where families look.

## Accessibility & Inclusion

Right-to-left Arabic first; contrast tests already guard the palette. Families and teachers use phones over mobile data.
