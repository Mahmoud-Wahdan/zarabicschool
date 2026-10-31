# دليل الكود للمبتدئين — Zarabicschool

الدليل ده لحد لسه بيتعلّم. هنبدأ من الصفر: يعني إيه JavaScript، ويعني إيه TypeScript، وإزاي الموقع بيتبني.
بعد كده هنمشي **سطر سطر** في ملفات حقيقية من المشروع.

> **ليه مش كل ملف سطر سطر؟**
> المشروع فيه 69 صفحة و82 API route وأكتر من 100 ملف اختبار، يعني عشرات الآلاف من السطور. شرح كل سطر فيهم هيبقى كتاب
> ماحدش هيقراه. اللي بنعمله هنا إننا نشرح **كل نوع ملف** بمثال حقيقي سطر سطر. كل باقي الملفات ماشية على نفس الأنماط
> دي بالظبط. لو فهمت الأمثلة دي، هتعرف تقرا أي ملف في المشروع.

---

## الجزء 1: المفاهيم الأساسية

### JavaScript (JS)

لغة برمجة اتعملت في الأول علشان تشتغل **جوه المتصفح** وتخلّي الصفحة تتحرك: لما تدوس زرار يحصل حاجة.

```js
let name = "Ahmed";                 // متغيّر اسمه name شايل نص
const count = 3;                    // ثابت، قيمته متتغيرش
function greet(person) {            // دالة (function) بتاخد مدخل اسمه person
  return "Hello " + person;         // وبترجّع نص
}
greet(name);                        // "Hello Ahmed"
```

### Node.js

برنامج بيخلّي JavaScript تشتغل **برّه المتصفح**، على السيرفر. علشان كده بنكتب المشروع كله بلغة واحدة: الواجهة
والسيرفر. `npm` هو مدير المكتبات بتاع Node: `npm install` بينزّل المكتبات اللي مكتوبة في `package.json`.

### TypeScript (TS)

JavaScript، بس بزيادة **أنواع (types)**. بتقول للكود: "المتغيّر ده لازم يبقى رقم". لو حطيت فيه نص، المحرّر يطلّعلك خطأ
**قبل** ما تشغّل البرنامج.

```ts
let count: number = 3;              // ": number" دي الـ type
count = "three";                    // ❌ خطأ: نص مش رقم. TypeScript يمسكه فوراً

function greet(person: string): string {   // المدخل نص، والراجع نص
  return "Hello " + person;
}
```

- ملفات `.ts` = TypeScript.
- ملفات `.tsx` = TypeScript فيها شكل واجهة (JSX، هنشرحه تحت).
- المتصفح مبيفهمش TypeScript، فبيتحوّل لـ JavaScript وقت الـ build.
- الأمر `npx tsc --noEmit` بيفحص الأنواع في المشروع كله من غير ما يطلّع ملفات.

### React

مكتبة لبناء الواجهات. بتقسّم الصفحة لـ **components**، وكل component دالة بترجّع "شكل" مكتوب بحاجة شبه HTML
اسمها **JSX**:

```tsx
function Welcome({ name }: { name: string }) {
  return <h1>Welcome {name}</h1>;     // ده JSX: شبه HTML جوه الكود
}
// وبعدين تستخدمه كأنه tag:  <Welcome name="Ahmed" />
```

### Next.js

إطار شغل (framework) مبني على React، وبيضيف:

- **Routing بالفولدرات:** الفولدر `app/[locale]/admin/teachers/page.tsx` بيبقى صفحة على الرابط `/ar/admin/teachers`.
- **Server Components:** الصفحة تقدر تجيب بيانات من الداتابيز على السيرفر قبل ما توصل للمتصفح.
- **API routes:** ملف `route.ts` جوه `app/api/...` بيبقى رابط بيستقبل طلبات (POST/GET...) ويرد بـ JSON.

### المكتبات المهمة في المشروع

| المكتبة | بتعمل إيه |
|---|---|
| **Prisma** | بتكلّم الداتابيز (PostgreSQL) بكود TypeScript بدل SQL مكتوب يدوي |
| **Zod** | بتتأكد إن البيانات اللي جاية من المستخدم شكلها صح قبل ما نستخدمها |
| **NextAuth** | تسجيل الدخول والـ session |
| **next-intl** | العربي والإنجليزي: كل النصوص في `messages/ar.json` و`messages/en.json` |
| **Tailwind CSS** | التصميم بـ classes جاهزة، زي `p-4` (padding) و`text-primary` (لون) |
| **bcrypt** | تشفير الباسوردات (بنخزّن hash، عمرنا ما بنخزّن الباسورد نفسه) |
| **Jest** | اختبارات الكود (842 اختبار) |
| **Playwright** | اختبارات بمتصفح حقيقي بيضغط في الموقع زي البني آدم (122 اختبار) |

---

## الجزء 2: الموقع بيشتغل إزاي (رحلة طلب واحد)

لما ولي أمر يفتح `https://site/ar/guardian`:

```
المتصفح
  │  GET /ar/guardian
  ▼
proxy.ts                      ← أول حاجة: مين ده؟ داخل؟ دوره يسمح بالصفحة دي؟ (لو لأ → يتحوّل لصفحة الدخول)
  │                              وكمان بيحط security headers (CSP وغيره)
  ▼
app/[locale]/guardian/page.tsx ← الصفحة: Server Component بيشتغل على السيرفر
  │  بيجيب البيانات عن طريق lib/... ← Prisma ← PostgreSQL
  ▼
HTML جاهز يرجع للمتصفح، وبعدين React "يصحّي" الأجزاء التفاعلية (الزراير)
```

ولما يدوس زرار "ابعت شكوى":

```
المتصفح → POST /api/complaints (JSON)
  ▼
app/api/complaints/route.ts
  1. requireSameOrigin  ← الطلب جاي من موقعنا؟ (حماية من مواقع تانية)
  2. requireApiRoles    ← داخل؟ ودوره مسموح له؟
  3. allowRequest       ← مش بيبعت كتير؟ (rate limit)
  4. zod.safeParse      ← البيانات شكلها صح؟
  5. prisma.complaint.create ← يخزّن في الداتابيز
  6. يرجّع JSON
```

ورسايل الواتساب مش بتتبعت وقت الطلب. بتتحط في جدول "مهام" (`notification_jobs`)، والـ **worker** بيلفّ كل شوية
ويبعتها عن طريق OpenWA، ويعيد اللي فشل. علشان كده لو الواتساب وقع، ولا رسالة بتضيع.

---

## الجزء 3: خريطة الفولدرات

```
zarabicschool/
├── webapp/                     ← الموقع كله
│   ├── app/                    ← الصفحات والـ API (Next.js App Router)
│   │   ├── [locale]/           ← [locale] = ar أو en، جزء متغيّر في الرابط
│   │   │   ├── admin/          ← صفحات الأدمن والمشرف
│   │   │   ├── teacher/        ← صفحات المدرّس
│   │   │   ├── guardian/       ← صفحات ولي الأمر
│   │   │   ├── student/        ← صفحات الطالب
│   │   │   └── layout.tsx      ← الإطار المشترك لكل الصفحات (اللغة، الاتجاه، الـ theme)
│   │   ├── api/                ← الـ API routes (route.ts)
│   │   ├── _components/        ← components مشتركة (الـ _ معناها: مش صفحة)
│   │   └── globals.css         ← الألوان والخطوط (الفاتح والغامق)
│   ├── lib/                    ← "المخ": منطق الشغل بعيد عن الواجهة
│   │   ├── prisma.ts           ← الاتصال بالداتابيز
│   │   ├── dal.ts              ← مين داخل ودوره إيه
│   │   ├── scheduling/ credits/ payroll/ messaging/ worker/ ...
│   ├── prisma/
│   │   ├── schema.prisma       ← شكل الداتابيز (الجداول)
│   │   └── migrations/         ← كل تغيير اتعمل في الداتابيز، بالترتيب (45 ملف)
│   ├── messages/ar.json, en.json ← كل نصوص الموقع
│   ├── __tests__/              ← اختبارات Jest
│   ├── e2e/                    ← اختبارات Playwright
│   ├── proxy.ts                ← الحارس اللي على الباب
│   └── instrumentation.ts      ← بيشتغل مرة واحدة لما السيرفر يقوم
├── OpenWA/                     ← بوابة الواتساب (مشروع منفصل، مش في git بتاعنا)
└── docs/specs/                 ← القرارات والخطط والأدلة
```

---

## الجزء 4: سطر سطر في ملفات حقيقية

### مثال 1: ملف إعداد صغير — `lib/config/features.ts`

```ts
type Env = Record<string, string | undefined>;
```
- `type` = بنعرّف **نوع** جديد اسمه `Env`.
- `Record<string, string | undefined>` = "قاموس": المفتاح نص، والقيمة يا نص يا مش موجودة (`undefined`).
- ده شكل متغيرات البيئة (`process.env`)، زي `FEATURE_AUTO_RENEWAL`.

```ts
const on = (value: string | undefined) => value?.trim().toLowerCase() === "true";
```
- `const on =` = ثابت اسمه `on` شايل **دالة**. الصيغة `(...) => ...` اسمها arrow function.
- `value?.trim()`: الـ `?.` معناها "لو `value` مش موجودة، متكمّلش وارجع `undefined`". من غيرها البرنامج كان هيقع.
- `.trim()` بتشيل المسافات، و`.toLowerCase()` بتصغّر الحروف، فـ " TRUE " تبقى "true".
- `=== "true"` مقارنة صارمة. يعني الخاصية تتفتح **بس** لو القيمة "true" بالظبط. أي حاجة تانية (فاضي، غلط، "yes") = مقفولة. ده قصد أماني.

```ts
export function isAutoRenewalEnabled(env: Env = process.env): boolean {
  return on(env.FEATURE_AUTO_RENEWAL);
}
```
- `export` = ملفات تانية تقدر تستورد الدالة دي.
- `env: Env = process.env` = المدخل اسمه `env` من نوع `Env`، ولو ماحدش بعته ياخد `process.env` (متغيرات البيئة الحقيقية).
  ليه نخليه مدخل؟ علشان الاختبارات تبعت قيم تجريبية من غير ما تلمس البيئة الحقيقية.
- `: boolean` = الدالة بترجّع صح أو غلط.

### مثال 2: الاتصال بالداتابيز — `lib/prisma.ts`

```ts
import "server-only";
```
- بيضمن إن الملف ده **عمره ما يتبعت للمتصفح**. لو حد استورده في component بيشتغل في المتصفح، الـ build يفشل. لأنه فيه رابط الداتابيز.

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";
```
- `import { X } from "Y"` = هات الحاجة X من المكتبة أو الملف Y.
- `PrismaClient` بيتولّد من `schema.prisma` بالأمر `npx prisma generate`. علشان كده الفولدر `generated/` مش في git.
- `Pool` = مجموعة اتصالات مفتوحة بالداتابيز بنعيد استخدامها، بدل ما نفتح اتصال جديد مع كل طلب (ده بطيء).

```ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});
```
- `new Pool({...})` = اعمل pool بالإعدادات دي.
- `connectionString` = عنوان الداتابيز، من `.env`.
- `max: 10` = بحد أقصى 10 اتصالات في نفس الوقت.
- `60_000` = 60000 مللي ثانية = دقيقة. الـ `_` للقراية بس. الاتصال الفاضي يتقفل بعد دقيقة.
- `connectionTimeoutMillis` = لو الداتابيز مردّتش في 10 ثواني، اعتبره فشل.

```ts
const adapter = new PrismaPg(pool);
return { client: new PrismaClient({ adapter }), pool };
```
- Prisma بيستخدم الـ pool ده عن طريق adapter.
- `{ adapter }` اختصار لـ `{ adapter: adapter }`.

### مثال 3: جدول في الداتابيز — `prisma/schema.prisma` (طلب انقطاع حصة)

```prisma
model SessionRequest {
  id        String   @id @default(uuid()) @db.Uuid
  academyId String   @map("academy_id") @db.Uuid
  sessionId String   @map("session_id") @db.Uuid
  reason    String
  status    SessionRequestStatus @default(PENDING)
  reviewedAt DateTime? @map("reviewed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  session   Session  @relation(..., fields: [sessionId], references: [id], onDelete: Restrict)
}
```
- `model SessionRequest` = جدول. Prisma بيعمل منه `prisma.sessionRequest` نستخدمه في الكود.
- `id String @id @default(uuid())` = المفتاح الأساسي، وبيتولّد لوحده كـ UUID (كود عشوائي فريد).
- `@map("academy_id")` = اسم العمود في الداتابيز `academy_id`، وفي الكود `academyId`.
- `DateTime?` = الـ `?` معناها ممكن يبقى فاضي (`null`). `reviewedAt` فاضي لحد ما حد يراجع الطلب.
- `@default(PENDING)` = أي طلب جديد حالته "منتظر".
- `@relation(... onDelete: Restrict)` = الطلب ده مربوط بحصة. ومش مسموح تمسح الحصة وهي ليها طلبات، علشان الداتا متضيعش.
- `academyId` موجود في كل جدول تقريباً: كل استعلام بيتفلتر بالأكاديمية، فمستحيل أكاديمية تشوف بيانات أكاديمية تانية.

**الـ migration:** لما بنغيّر `schema.prisma`، بنعمل ملف SQL في `prisma/migrations/`.
`npx prisma migrate deploy` بيطبّق الملفات اللي لسه مطبّقتش على الداتابيز، بالترتيب، وبيسجّل اللي اتطبّق
علشان ميتكررش. علشان كده لما شغّلته عندي قال "No pending migrations": كله كان متطبّق.

### مثال 4: API route — `app/api/sessions/[id]/session-request/route.ts` (الطالب يبلّغ إن الحصة وقعت)

```ts
const sessionRequestSchema = z.object({
  reason: z.string().trim().min(2).max(1000),
});
```
- Zod "قالب" للبيانات: لازم يبقى فيه `reason` نص، بعد شيل المسافات طوله من 2 لـ 1000 حرف. أي حاجة تانية تترفض.

```ts
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
```
- اسم الدالة `POST` = Next.js يشغّلها لما يجي طلب POST على الرابط ده.
- `async` = الدالة فيها عمليات بتاخد وقت (داتابيز)، فبنستنّاها بـ `await`.
- `[id]` في اسم الفولدر = جزء متغيّر في الرابط (رقم الحصة)، وبيوصل في `params`.

```ts
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
```
- خطوة حماية: لو الطلب جاي من موقع تاني (هجوم CSRF)، رجّع الرفض فوراً و**متكمّلش**.

```ts
  const { user, error } = await requireApiRoles(["STUDENT", "GUARDIAN", "TEACHER"]);
  if (error) return error;
```
- مين داخل؟ ولازم يكون طالب أو ولي أمر أو مدرّس. غير كده → 401/403.
- `const { user, error } =` اسمها destructuring: بنطلّع `user` و`error` من النتيجة مرة واحدة.

```ts
  const { id: sessionId } = await params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "..." } }, { status: 400 });
  }
```
- نطلّع رقم الحصة ونسمّيه `sessionId`. لو مش UUID صحيح → 400 (طلب غلط).

```ts
  if (!allowRequest(`session-request:${user.id}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: { code: "RATE_LIMITED", ... } }, { status: 429 });
  }
```
- بحد أقصى 5 طلبات في الساعة لكل مستخدم. `` `...${x}` `` نص فيه متغيّر جوّاه (template string).

```ts
  const parsed = sessionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) { return ... 400 }
```
- نقرا الـ JSON اللي جاي. لو مش JSON أصلاً، `.catch(() => null)` يحوّله لـ `null` بدل ما البرنامج يقع.
- `safeParse` مبترميش خطأ، بترجّع `success: true/false`.

```ts
  const session = await prisma.session.findFirst({
    where: { id: sessionId, academyId: user.academyId },
    select: { id: true, status: true, teacher: { select: { userId: true } } },
  });
  if (!session) return ... 404
```
- دوّر على الحصة **في أكاديمية المستخدم بس**.
- `select` = هات الأعمدة دي بس، مش كل حاجة. أسرع وأأمن.
- لو مش موجودة → 404. ولو موجودة بس في أكاديمية تانية برضه 404، علشان منكشفش إنها موجودة.

```ts
  if (user.role === "TEACHER") {
    if (session.teacher.userId !== user.id) return ... 404
  } else {
    const roster = await prisma.sessionStudent.findFirst({ where: { sessionId, ... } });
    if (!roster) return ... 404
  }
```
- المدرّس لازم يكون مدرّس الحصة دي. الطالب لازم يكون في الحصة. ولي الأمر لازم يكون ابنه في الحصة.

```ts
  created = await prisma.sessionRequest.create({
    data: { academyId: user.academyId, sessionId, requestedById: user.id, reason: parsed.data.reason },
    select: { id: true, status: true, createdAt: true },
  });
```
- نخزّن الطلب. والداتابيز نفسها فيها قاعدة: طلب واحد مفتوح لكل شخص على نفس الحصة. لو اتكرر → كود الخطأ
  `P2002`، فبنرد 409 (تعارض) بدل ما البرنامج يقع.

**كل API في المشروع ماشي على نفس الترتيب ده:** أصل الطلب ← الدور ← الـ rate limit ← Zod ← الداتابيز ← الرد.

### مثال 5: component في المتصفح — `app/_components/theme-switch.tsx` (زرار الـ dark mode)

```tsx
"use client";
```
- السطر ده بيقول لـ Next.js: "الملف ده بيشتغل في **المتصفح**". لازم، لأنه بيدوس زرار ويقرا الـ cookie.
  من غيره الملف يبقى Server Component.

```tsx
type Theme = "light" | "dark" | "system";
const ORDER: Theme[] = ["light", "dark", "system"];
```
- `Theme` نوع ليه 3 قيم بس. لو كتبت `"dakr"` بالغلط، TypeScript يمسكها.
- `ORDER` = ترتيب اللفّ: فاتح ← غامق ← حسب الجهاز.

```tsx
function readTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}
```
- `document.documentElement` = الـ `<html>` بتاع الصفحة. و`dataset.theme` = الـ attribute `data-theme`.
- `شرط ? أ : ب` = لو الشرط صح رجّع أ، غير كده ب.

```tsx
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
    document.cookie = "theme=; path=/; max-age=0; samesite=lax";
  } else {
    root.dataset.theme = theme;
    document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  }
  listeners.forEach((listener) => listener());
}
```
- "حسب الجهاز": نشيل `data-theme` ونمسح الـ cookie (`max-age=0` = امسحها).
- غير كده: نحط `data-theme="dark"` على `<html>`، ونحفظ الاختيار في cookie لمدة سنة (31536000 ثانية).
- بمجرد ما `data-theme="dark"` يتحط، `globals.css` يبدّل كل الألوان. ده كل سحر الـ dark mode.
- ليه cookie مش localStorage؟ لأن السيرفر بيقرا الـ cookie في `layout.tsx` ويحط `data-theme` **قبل** ما الصفحة تترسم،
  فمبيحصلش "وميض أبيض" لما الصفحة تفتح.

```tsx
export default function ThemeSwitch({ className = "" }: { className?: string }) {
  const t = useTranslations("theme");
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
```
- `useTranslations("theme")` = هات نصوص الـ theme من `messages/ar.json` أو `en.json` حسب اللغة.
- `useSyncExternalStore` = React hook بيخلي الزرار يتحدّث لما الـ theme يتغيّر. والدالة التالتة هي القيمة على
  السيرفر ("system")، لأن السيرفر ميعرفش إعداد جهازك.
- `% ORDER.length` = باقي القسمة: بعد آخر عنصر يرجع للأول (0 ← 1 ← 2 ← 0).

```tsx
  return (
    <button type="button" onClick={() => applyTheme(next)} aria-label={t("switch", { current: t(theme), next: t(next) })}>
      <Icon name={ICON[theme]} size={20} />
    </button>
  );
```
- JSX: زرار، لما يتداس يطبّق الـ theme اللي بعده.
- `aria-label` = اسم الزرار لبرامج قراءة الشاشة للمكفوفين، زي "الوضع الحالي غامق، اضغط للتبديل لحسب الجهاز".

### مثال 6: صفحة على السيرفر — `app/[locale]/admin/teachers/page.tsx`

```tsx
export async function generateMetadata() {
  const t = await getTranslations("management");
  return { title: `${t("teachers.title")} | Zarabicschool` };
}
```
- بتحدد عنوان التاب في المتصفح (`<title>`).

```tsx
export default async function TeachersPage() {
  const user = await requireRoles(["ADMIN", "SUPERVISOR"]);
```
- `export default` = ده الـ component الأساسي للصفحة، وNext.js بيعرضه.
- `async` لأن Server Component يقدر يستنّى الداتابيز.
- `requireRoles`: أدمن أو مشرف بس، وغير كده يتحوّل لصفحته.

```tsx
  return (
    <DashboardShell role={user.role} userName={user.displayName}>
      <PageHeader title={t("teachers.title")} subtitle={t("teachers.subtitle")} />
      <ProfilesPanel type="teacher" ... viewerRole={user.role === "ADMIN" ? "ADMIN" : "SUPERVISOR"} />
    </DashboardShell>
  );
```
- `DashboardShell` = الإطار: القايمة الجانبية والشريط اللي فوق (فيه زرار الـ dark mode).
- الحاجات اللي بنبعتها لـ component (`role=`, `title=`) اسمها **props**.
- `ProfilesPanel` = component في المتصفح فيه الجدول والفورم.

### مثال 7: حد الطلبات — `lib/rate-limit.ts`

```ts
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
```
- `Map` = قاموس في الذاكرة. لكل مفتاح (زي `login:IP`) "سطل" فيه عدد المحاولات وإمتى يتصفّر.

```ts
export function allowRequest(key: string, limit = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
```
- `Date.now()` = الوقت الحالي بالمللي ثانية.
- لو مفيش سطل أو وقته خلص: نبدأ سطل جديد ونسمح.
- لو وصل للحد: نرفض (`false`).
- غير كده: نزوّد العدّاد ونسمح.
- **ملحوظة مهمة:** الـ `Map` ده في ذاكرة السيرفر. على Vercel فيه نسخ كتير من السيرفر، وكل نسخة ليها `Map` لوحدها.
  علشان كده الدليل بيقول لازم ننقله للداتابيز قبل Vercel.

---

## الجزء 5: الموقع بيتبني ويشتغل إزاي

| الأمر | بيعمل إيه |
|---|---|
| `npm install` | ينزّل كل المكتبات في `node_modules/` |
| `npx prisma generate` | يولّد كود Prisma من `schema.prisma` |
| `npx prisma migrate deploy` | يطبّق الـ migrations الناقصة على الداتابيز |
| `npm run dev` | يشغّل الموقع للتطوير: بطيء شوية، بس بيتحدّث لوحده مع كل تعديل |
| `npm run build` | يحوّل TypeScript لـ JavaScript، يفحص الأنواع، ويجهّز نسخة سريعة في `.next/` |
| `npm run start` | يشغّل النسخة اللي اتبنت بـ build. **لو عدّلت كود لازم build تاني، وإلا هتشوف النسخة القديمة** |
| `npm run worker` | يشغّل الـ worker لوحده (لما `WORKER_MODE=separate`) |
| `npm test` | اختبارات Jest |
| `npx playwright test` | اختبارات المتصفح |

---

## الجزء 6: تتعلّم منين بعد كده

1. **JavaScript:** javascript.info (مجاني، فيه عربي جزئي).
2. **TypeScript:** typescriptlang.org/docs/handbook.
3. **React:** react.dev/learn.
4. **Next.js:** nextjs.org/learn.
5. **في المشروع:** ابدأ بملف صغير في `lib/config/`، وبعدين API route، وبعدين صفحة. وفي كل ملف دوّر على الأنماط اللي هنا.
