# دليل الـ Deployment — Supabase + Vercel + Railway (أو OpenWA والـ worker على جهازك)

آخر تحديث: 2026-10-31. الدليل ده للتجربة الصغيرة (pilot) وللإطلاق. القائمة الكاملة لبنود الإطلاق في
[`deploy-checklist.md`](./deploy-checklist.md)، وتشغيل الـ staging المؤقت على ngrok في
[`staging-runbook.md`](./staging-runbook.md). الدليل ده مبيكررش اللي فيهم، بيحيل ليهم.

**قواعد ثابتة:** ولا secret يتكتب في ملف جوه الريبو أو في رسالة. الأسماء بس هي اللي في الدليل، والقيم
بتتحط في إعدادات المنصة (Vercel / Railway) أو في ملف `.env.*` على جهازك (متجاهَل في git).
الـ migrations إنت اللي بتطبّقها.

---

## 0. هنشغّل إيه وفين

التطبيق عبارة عن 4 حاجات منفصلة:

| الجزء | بيعمل إيه | لازم يفضل شغال طول الوقت؟ |
|---|---|---|
| **الموقع** (Next.js، `webapp`) | الصفحات والـ API والـ webhooks | لأ، بيشتغل مع كل request |
| **الـ worker** (`npm run worker`) | بيبعت رسايل الواتساب والتذكيرات ويعيد اللي فشل | **أيوه**، نسخة واحدة بس |
| **OpenWA** | بوابة الواتساب، ماسكة جلسة WhatsApp Web | **أيوه**، نسخة واحدة بس |
| **الداتابيز** (Supabase Postgres) | كل البيانات | Supabase بيشغّلها |

Vercel مبيشغّلش حاجة طول الوقت، علشان كده الـ worker وOpenWA لازم يتحطوا في مكان تاني:

| | الطريقة A (المقترحة) | الطريقة B |
|---|---|---|
| الموقع | Vercel | Vercel |
| الداتابيز | Supabase | Supabase |
| الـ worker | Railway | جهازك |
| OpenWA | Railway (مع Volume) | جهازك + ngrok |
| لو جهازك اتقفل | مفيش أي تأثير | الواتساب والتذكيرات يقفوا لحد ما يرجع |
| التكلفة | Railway تقريباً 5–10$ في الشهر | ngrok مجاني (domain ثابت) |

**مهم في الطريقة B:** الموقع على Vercel بيكلّم OpenWA مباشرة في مكانين:
- موافقة الطلب وموافقة المدرّس (`/api/applications/[id]/approve` و`/api/admin/teachers/[id]/approve`): رسالة بيانات الدخول بتتبعت ساعتها.
- فحص الواتساب في صفحة الأدمن (`/api/admin/whatsapp/health`).

علشان كده OpenWA اللي على جهازك لازم يبقى ليه رابط عام، وده دور ngrok. لو الجهاز مقفول وقت الموافقة،
رسالة بيانات الدخول هتفشل. باقي الرسايل بتستنى في الداتابيز وتتبعت لما الـ worker يرجع.

---

## 1. لازم يتعمل قبل أي deploy

- [ ] **قفل الدخول وحدود الطلبات على Vercel (تعديل في الكود، أنا اللي هعمله).**
  - قفل الحساب بعد 3 محاولات غلط في 15 دقيقة، وحد الـ 120 طلب في الدقيقة، متخزنين في ذاكرة السيرفر (`lib/rate-limit.ts`).
  - Vercel بيشغّل نسخ كتير من الموقع، وكل نسخة ليها عدّادها، فالحماية بتضعف.
  - الحل إن العدادات تتنقل للداتابيز، بـ migration جديدة وجدول صغير (مش مالي)، وهبعتلك الـ SQL الأول.
  - **متفتحش الموقع لحد قبل البند ده.**
- [ ] **الـ SQL بتاعة S-10 وS-11 وS-12** مستنية موافقتك. بعد الموافقة تتطبّق بـ `migrate deploy` (الخطوة 3).
- [ ] **مشروع Supabase جديد** للتجربة أو للإنتاج، مش الداتابيز اللي بنطوّر عليها. السبب إن داتابيز التطوير فيها أرقام تليفونات تجريبية، والواتساب الحقيقي ممكن يبعتلها.
- [ ] **secrets جديدة كلها** (D21 في `deploy-checklist.md`): `NEXTAUTH_SECRET`، باسورد الداتابيز، مفاتيح OpenWA، وPaymob وCloudinary لما يتفعّلوا.
- [ ] **رقم واتساب للأكاديمية** على موبايل، يتربط بـ OpenWA بالـ QR.

---

## 2. الحسابات المطلوبة

| الحساب | ليه | ملاحظة |
|---|---|---|
| GitHub | الكود (`Mahmoud-Wahdan/zarabicschool`) | موجود |
| Supabase | الداتابيز | خطة Free للتجربة. للإنتاج Pro علشان الـ backups اليومية |
| Vercel | الموقع | **خطة Hobby للاستخدام الشخصي غير التجاري**. الأكاديمية تجارية، فللإطلاق تحتاج Pro. راجع الشروط والأسعار |
| Railway (A) | الـ worker وOpenWA | خطة Hobby |
| ngrok (B) | رابط عام لـ OpenWA اللي على جهازك | domain ثابت مجاني من Dashboard → Domains |
| Domain (اختياري) | زي `app.zarabicschool.com` | من غيره هتستخدم `*.vercel.app` |
| Cloudinary (اختياري) | مرفقات التقارير | من غيره الرفع بيرد "storage not configured" |
| Paymob (بعد "go") | الدفع | الخطوة 7 |

**الـ regions:** اختار مناطق قريبة من بعض ومن مصر. Supabase في Frankfurt (`eu-central-1`)، ودوال Vercel في
`fra1`، وRailway في أقرب منطقة أوروبية. لو الداتابيز بعيدة عن الموقع، كل صفحة هتبطّأ.

---

## 3. Supabase (الداتابيز)

1. **New project** باسم مثلاً `zarabicschool-pilot`، في region Frankfurt، وباسورد قوي. احفظه في password manager.
2. من **Connect** (أو Project Settings → Database) خد رابطين:
   - **`DATABASE_URL`** = *Transaction pooler* (port **6543**). ده اللي Vercel والـ worker بيستخدموه.
   - **`DIRECT_URL`** = *Direct connection* (port 5432)، أو *Session pooler* لو جهازك مفيهوش IPv6. ده للـ migrations بس.
3. **من جهازك**، جوه `webapp`، اعمل ملف `.env.pilot` (متجاهَل في git):
   - انسخ `.env.example` وحط **كل** مفتاح، حتى الفاضي. ليه؟ لأن Prisma والـ seed بيقروا `.env` بتاع التطوير كمان، وأي مفتاح ناقص هياخد قيمة التطوير.
   - المفاتيح المطلوبة: `DATABASE_URL` و`DIRECT_URL` (الجداد) و`SEED_ADMIN_USERNAME` و`SEED_ADMIN_NAME` و`SEED_ADMIN_PASSWORD` (12 حرف على الأقل).
4. حمّل الملف في الترمينال، وتأكّد إنه على الداتابيز الصح. الطريقة في `staging-runbook.md` §2. في PowerShell:

   ```powershell
   Get-Content .env.pilot | ForEach-Object {
     if ($_ -match '^\s*([A-Z][A-Z0-9_]*)=(.*)$') {
       [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"'), 'Process')
     }
   }
   node -e "console.log('host:', new URL(process.env.DIRECT_URL).host)"   # لازم يطبع host مشروع Supabase الجديد
   ```

5. أنشئ الجداول وأول أدمن:

   ```bash
   npx prisma migrate deploy      # كل الـ migrations (عمرك ما تستخدم migrate reset أو db push هنا)
   npx tsx prisma/seed.ts         # الأكاديمية وأول أدمن من SEED_ADMIN_* (مش seed-demo)
   npm run db:verify              # فحوصات قراءة بس، ولازم تنتهي بـ "all … checks passed"
   ```

   - أول ما الأدمن يدخل، الموقع هيطلب منه يغيّر الباسورد.
   - **الـ seed التجريبي (`seed-demo.ts`) مش هنا.** بيعمل مستخدمين بأرقام تجريبية، ومكانه داتابيز staging بس.

6. **الـ backups:** على Pro فعّل الـ backups اليومية. قبل أي `migrate deploy` جديد، خد backup يدوي أو `pg_dump`.

---

## 4. Vercel (الموقع)

1. **Add New → Project → Import** الريبو `zarabicschool`.
2. **Root Directory:** `webapp`. **Framework:** Next.js (بيتعرف لوحده).
3. **Build Command:** `npx prisma generate && npm run build`. لازم كده لأن الـ Prisma client (`generated/prisma`) مش موجود في git.
4. **Node.js Version** (Settings → General): 22.x.
5. **Function Region** (Settings → Functions): `fra1`، جنب Supabase.
6. **Environment Variables** (Production، وPreview لو هتستخدمه):

| المفتاح | القيمة |
|---|---|
| `DATABASE_URL` | Supabase *Transaction pooler* (6543) |
| `DIRECT_URL` | Supabase direct. مش مستخدم وقت التشغيل، بس خليه موجود |
| `NEXTAUTH_SECRET` | قيمة جديدة: `openssl rand -base64 48` |
| `NEXTAUTH_URL`، `APP_PUBLIC_URL` | `https://<رابط الموقع>`، من غير `/` في الآخر |
| `ALLOWED_ORIGINS` | نفس الـ origin بالظبط. لو بتستخدم `www` ومن غيرها، اكتب الاتنين بفاصلة (شوف `deploy-checklist.md` §2) |
| `TRUSTED_PROXY_HOPS` | `1` |
| `WORKER_MODE` | **`separate`**. الـ worker مش بيشتغل جوه Vercel |
| `OPENWA_URL` | (A) رابط OpenWA العام على Railway. (B) رابط ngrok. **من غير `/api` في الآخر** |
| `OPENWA_API_KEY`، `OPENWA_SESSION_ID`، `OPENWA_WEBHOOK_SECRET` | من الخطوة 5 أو 6 |
| `MESSAGING_PROVIDER`، `OPENWA_SEND_ALLOWLIST` | **متحطهمش خالص.** `console` أو `fake` بيوقّفوا الموقع عن قصد |
| `PAYMOB_*` | فاضية لحد "go". الـ checkout هيرد `NOT_CONFIGURED` |
| `FEATURE_AUTO_RENEWAL` | متحطوش (يعني مقفول) |
| `CLOUDINARY_*` | لو هتفعّل المرفقات |
| `HSTS_MAX_AGE` | متحطوش في الأول (300 ثانية). يتعلّى بعد ما الـ HTTPS يثبت (`deploy-checklist.md` §8) |
| `SEED_*` | **لأ** على Vercel |

7. **Deploy.**
   - أول مرة مش هتعرف الرابط غير بعد الـ deploy. اعمل deploy، خد الرابط (`https://<project>.vercel.app` أو الـ domain بتاعك).
   - حطه في `NEXTAUTH_URL` و`APP_PUBLIC_URL` و`ALLOWED_ORIGINS`، واعمل **Redeploy**. القيم دي بتتقري وقت التشغيل، والـ redeploy لازم.
8. **Domain** (اختياري): Settings → Domains، ضيف الـ domain وظبّط الـ DNS زي ما Vercel بيقول. بعدها غيّر المفاتيح التلاتة للـ domain الجديد واعمل redeploy.

---

## 5. الطريقة A: الـ worker وOpenWA على Railway

اعمل **New Project** فيه خدمتين.

### 5.1 خدمة OpenWA

1. **Fork** للريبو `rmyndharis/OpenWA` على حسابك في GitHub. ده المصدر اللي عندنا محلياً (version 0.26.0).
2. في Railway: **New → GitHub Repo →** الـ fork. Railway هيبني من الـ `Dockerfile`.
3. **Volume:** اعمل Volume واربطه على **`/app/data`**. هنا جلسة الواتساب ومفتاح الأدمن وقاعدة OpenWA. من غيره كل redeploy هيمسح الربط وهتعمل QR من الأول.
4. **Variables:**
   - `NODE_ENV=production`
   - `PORT=2785`
   - `AUTO_START_SESSIONS=true` (نسخة واحدة: لو حصل restart الجلسة ترجع لوحدها)
   - `API_MASTER_KEY=<مفتاح طويل عشوائي جديد>`: ده أول مفتاح أدمن. شوف `OpenWA/docs/04-security-design.md`.
   - `API_KEY_PEPPER=<قيمة عشوائية>` **قبل أول تشغيل بس**. لو غيّرته بعد كده، كل المفاتيح هتبطل.
5. **Settings → Networking → Generate Domain** (رابط عام على port 2785). Vercel لازم يوصله.
6. **Replicas = 1.** نسختين على نفس الجلسة ممكن يعملوا logout أو حظر للرقم.
7. افتح `https://<openwa-domain>/`، دي الداشبورد:
   - ادخل بالـ `API_MASTER_KEY`.
   - اعمل **API key** للموقع (Operator أو أقل صلاحية تكفي للإرسال). ده `OPENWA_API_KEY`.
   - اعمل **Session** وامسح الـ QR من موبايل الأكاديمية (WhatsApp → Linked devices).
   - الـ id بتاعها هو `OPENWA_SESSION_ID`.
8. اتأكد إنه شغال:

   ```bash
   curl -s https://<openwa-domain>/api/health
   ```

### 5.2 خدمة الـ worker

1. **New → GitHub Repo →** `zarabicschool` (نفس الريبو).
2. **Settings:**
   - **Root Directory:** `webapp`
   - **Build Command:** `npm ci --include=dev && npx prisma generate`. الـ worker بيشتغل بـ `tsx` وده devDependency، و`NODE_ENV=production` من غير `--include=dev` بيشيله.
   - **Start Command:** `npm run worker`
   - **Replicas = 1.** نسختين = رسايل متكررة.
   - **من غير public domain.** الـ worker مبيستقبلش طلبات.
3. **Variables:**

| المفتاح | القيمة |
|---|---|
| `NODE_ENV` | `production`. **لازم**، وإلا الواتساب يتمنع بالـ allowlist |
| `DATABASE_URL` | نفس اللي على Vercel |
| `NEXTAUTH_URL`، `APP_PUBLIC_URL` | رابط الموقع، علشان روابط الحصص في الرسايل |
| `OPENWA_URL` | `http://<اسم-خدمة-openwa>.railway.internal:2785` (شبكة Railway الداخلية، أسرع ومش عامة) |
| `OPENWA_API_KEY`، `OPENWA_SESSION_ID` | نفس اللي على Vercel |
| `PAYMOB_*`، `FEATURE_AUTO_RENEWAL` | نفس قيم Vercel لما يتفعّلوا |
| `MESSAGING_PROVIDER`، `OPENWA_SEND_ALLOWLIST` | متحطهمش |

4. **Deploy.** الـ logs لازم تبدأ بـ `[worker] started.` ومن غير أخطاء.

### 5.3 الـ webhook بتاع حالة الرسايل

OpenWA بيبلّغ الموقع لما الرسالة توصل. سجّله مرة واحدة من أي ترمينال:

```bash
curl -s -X POST "https://<openwa-domain>/api/sessions/<OPENWA_SESSION_ID>/webhooks" \
  -H "X-API-Key: <OPENWA_API_KEY>" -H "content-type: application/json" \
  -d '{"url":"https://<رابط الموقع>/api/whatsapp/status","events":["*"],"secret":"<OPENWA_WEBHOOK_SECRET>"}'
```

- `OPENWA_WEBHOOK_SECRET`: 16 حرف على الأقل، ونفس القيمة على Vercel.
- اختبره بـ `POST …/webhooks/<id>/test`، ولازم يرد `success: true`.

---

## 6. الطريقة B: الـ worker وOpenWA على جهازك

1. **ملف `webapp/.env.pilot`** على جهازك، بنفس قيم Vercel:
   - `DATABASE_URL` بتاع Supabase.
   - `NEXTAUTH_URL` و`APP_PUBLIC_URL` = رابط Vercel.
   - `OPENWA_URL=http://127.0.0.1:2785`.
   - `OPENWA_API_KEY` و`OPENWA_SESSION_ID`.
   - `NODE_ENV=production`.
   - **كل** مفتاح موجود، حتى لو فاضي، علشان `.env` بتاع التطوير ميدخلش.
2. **OpenWA** (ترمينال 1):

   ```bash
   cd OpenWA
   node dist/main        # أو: docker compose up -d
   ```

   - بيشتغل على `http://127.0.0.1:2785`، وبياناته في `OpenWA/data`.
   - **متمسحش الفولدر ده.** فيه الجلسة والمفاتيح.
   - API key وSession وQR زي 5.1 خطوة 7.
3. **ngrok لـ OpenWA بس** (ترمينال 2):

   ```bash
   ngrok http 2785 --url=https://<static-domain>
   ```

   - الرابط ده هو `OPENWA_URL` **على Vercel**.
   - الـ worker على نفس الجهاز بيستخدم `127.0.0.1`.
   - كده بوابة الواتساب بقت مكشوفة على الإنترنت، وحمايتها هي الـ API key بس. خلي المفاتيح طويلة، ومتشاركش الرابط.
   - **ممنوع** تعمل ngrok للداتابيز أو لأي port تاني.
4. **الـ worker** (ترمينال 3)، جوه `webapp` وبعد ما تحمّل `.env.pilot` زي الخطوة 3.4:

   ```bash
   npm run worker        # لازم يطبع [worker] started.
   ```

5. **الـ webhook:** زي 5.3، بس على رابط ngrok:
   - `https://<static-domain>/api/sessions/<id>/webhooks`
   - الـ `url` جواه = رابط Vercel.
6. **الجهاز:** يفضل شغال من غير sleep. لو اتقفل:
   - الرسايل بتستنى في الداتابيز وتتبعت لما الـ worker يرجع.
   - رسايل بيانات الدخول وقت الموافقة هتفشل.

---

## 7. Paymob (بعد ما تكتب "go" بس)

- خطوات الـ test mode في `staging-runbook.md` §6. بنعملها على رابط Vercel بدل ngrok.
- في Paymob dashboard:
  - **Processed callback:** `https://<رابط الموقع>/api/payments/paymob/webhook`
  - **Subscription webhook** (التجديد التلقائي، بعد ما يتختبر): `https://<رابط الموقع>/api/payments/paymob/subscription-webhook`
- مفاتيح `PAYMOB_*` تتحط على Vercel، وكمان على الـ worker لو التجديد التلقائي اتفعّل. الـ HMAC secret لازم يطابق اللي في الـ dashboard.
- `FEATURE_AUTO_RENEWAL=true` بعد ما تجربة اشتراك وتجديد واسترداد تنجح في الـ test mode بس.

---

## 8. اختبار سريع بعد الـ deploy (قبل ما تبعت الرابط لحد)

- [ ] `https://<الموقع>/ar` و`/en` بيفتحوا.
- [ ] الأدمن يدخل → الموقع يطلب تغيير الباسورد → بعدها الداشبورد تفتح.
- [ ] اعمل مدرّس وولي أمر وطالب بأرقامك إنت. اتأكد إن كل واحد يدخل ويشوف الداشبورد بتاعته بس.
- [ ] أي حفظ (موضوع، ميعاد) ينجح. لو رد **403 `ORIGIN_NOT_ALLOWED`**، يبقى `ALLOWED_ORIGINS` غلط (§9).
- [ ] صفحة الأدمن → WhatsApp → الفحص أخضر.
- [ ] ابعت رسالة لرقمك من صفحة الأدمن. لازم توصل، وحالتها تتغيّر لـ delivered (يعني الـ webhook شغال).
- [ ] احجز حصة قريبة لطالب تجريبي. التذكير يوصل في ميعاده، والرابط اللي فيه رابط **الموقع** مش Zoom.
- [ ] `https://<الموقع>/api/sessions` وإنت داخل: مفيهاش `zoom.us`.
- [ ] Response headers فيها `Content-Security-Policy` و`Strict-Transport-Security` (`deploy-checklist.md` §8).

---

## 9. لما حاجة تقع

| العَرَض | السبب الأغلب | الحل |
|---|---|---|
| كل حفظ بيرد 403 `ORIGIN_NOT_ALLOWED` | `ALLOWED_ORIGINS` مش مطابق | DevTools → Network → انسخ الـ `Origin`، حطه بالظبط، وredeploy |
| الدخول بيفشل للكل | `NEXTAUTH_URL` أو `NEXTAUTH_SECRET` غلط، أو bcrypt مش متبني | راجع المفاتيح. وشوف `deploy-checklist.md` §2b |
| الموقع مبيشتغلش وفي الـ log رسالة عن messaging provider | `MESSAGING_PROVIDER` متحط | امسحه وredeploy |
| الرسايل واقفة PENDING | الـ worker مش شغال، أو OpenWA الجلسة بتاعته واقعة | logs الـ worker، وداشبورد OpenWA (أعد الـ QR لو اتعمل logout) |
| رسايل "Recipient blocked by OPENWA_SEND_ALLOWLIST" | الـ worker شغال من غير `NODE_ENV=production` | حط `NODE_ENV=production` على الـ worker |
| أخطاء `too many clients` من Supabase | `DATABASE_URL` مش على الـ Transaction pooler | استخدم port 6543 |
| صفحة بايظة بعد الـ deploy (حاجة متمنعة) | الـ CSP | `CSP_REPORT_ONLY=1` على Vercel وredeploy، صلّح، وبعدين امسحه |

---

## 10. التحديث والرجوع (rollback)

**تحديث عادي:**
- push على `main` → Vercel وRailway بيعملوا deploy لوحدهم.
- لو فيه migration جديدة: **backup الأول**، بعدين `npx prisma migrate deploy` من جهازك وإنت محمّل `.env.pilot`، **قبل** الـ deploy الجديد.

**رجوع الموقع:**
- Vercel → Deployments → النسخة اللي قبلها → **Instant Rollback** (Promote).
- Railway → Deployments → النسخة اللي قبلها → **Redeploy**.

**رجوع الداتابيز:**
- الـ migrations بتمشي لقدام بس، ومفيش "undo".
- لو migration عملت مشكلة: رجّع الكود الأول، وبعدين استرجع الـ backup اللي اتاخد قبلها (Supabase → Database → Backups، أو `pg_restore`).
- علشان كده **الـ backup قبل كل migration مش اختياري.**

**وقف الواتساب بسرعة:**
- (A) Railway → خدمة الـ worker → **Remove deployment** أو Replicas = 0.
- (B) Ctrl+C في ترمينال الـ worker.
- الرسايل بتفضل في الداتابيز ومش بتضيع.

---

## 11. قبل الإطلاق الحقيقي (بعد الـ pilot)

البنود المفتوحة في [`deploy-checklist.md`](./deploy-checklist.md): §1 (secrets)، §3 (تجربة استرجاع backup)، §4
(Paymob live)، §7 (متابعة الأخطاء، الخصوصية وموافقة أولياء أمور الأطفال، مدة الاحتفاظ بالبيانات)، §8 (رفع
HSTS بعد ما الـ HTTPS يثبت). كمان: خطة Vercel Pro للاستخدام التجاري، و`npm audit` من جديد.
