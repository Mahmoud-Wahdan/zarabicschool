Read HANDOFF.md in the project root first. This project was being built by
another agent (opencode) that hit its usage limit. Continue from where it
stopped; do not redo finished work.

Order:
1. Run `npx tsc --noEmit`, `npm run lint`, `npm run build` and fix every error.
2. Then finish the "Remaining" list in HANDOFF.md, in order.
3. After each item, re-run tsc to confirm nothing broke.

Rules:
- Do NOT apply the Prisma migration or touch the database.
- Do NOT commit or edit .env.
- Edit Arabic/UTF-8 files only with file-edit tools, never through PowerShell
  Get-Content/Set-Content.
- Keep messages/ar.json and messages/en.json in key parity.
- When done, give me a short summary: what you fixed, what's left.