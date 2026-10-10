# abroadboard

A bulletin board for international students at Auckland universities and colleges.
ENGGEN 731, Group 7.

Plain HTML, CSS and JavaScript. **Supabase** handles the database and email login, and **Vercel** hosts the site. There is no build step, and every tool used here has a free tier.

The site works straight away in **demo mode**, which uses sample data saved only in your own browser. It switches to **live mode** as soon as you add your Supabase keys to `js/config.js` (see step 5).

---

## What's in the folder

| Path | What it is |
|---|---|
| `index.html` | Every page: Board, Buy and Sell, Events, Campus tips, Food & budget, Join |
| `css/styles.css` | Brand colours, fonts and layout (works on phones) |
| `js/config.js` | **The only file you need to edit to go live**: Supabase URL and key |
| `js/data.js` | Talks to Supabase, or to the demo data when there are no keys |
| `js/app.js` | What the pages show and do |
| `supabase/schema.sql` | Database tables and security rules. Run it once in Supabase. |
| `supabase/seed.sql` | Optional sample events and meetup posts |
| `supabase/email-templates/sign-in.html` | The sign-in email with the one-time code (`{{ .Token }}`) |
| `assets/logo.svg`, `assets/favicon.svg` | The globe logo and browser-tab icon |

### Where each user story lives

| Story | Where |
|---|---|
| 1 Access all pages | `index.html`, hash links such as `#events` |
| 2 Make a post, shown on the main page | `app.js` → `openDialog("post")`; `posts` table |
| 3 Admin delete | Delete button; `"Authors and admins delete posts"` rule in `schema.sql` |
| 4 Tips on what to write | "What to include" box in the new-post form |
| 5 Ads | `AD_SLOT` in `app.js`, sponsor panel in `index.html` |
| 6 Student email only | `INSTITUTIONS` in `config.js` and `isStudentEmail()` in the browser; `allowed_email_domains()`, `is_student()` and `hook_uoa_only` in the database |
| English / 中文 switch | `js/i18n.js` (Mandarin text, keyed by the English); `data-i18n` marks static text in `index.html`. Student posts stay in the language they were written in. |
| FAQ + contact | `#faq` page in `index.html` (answers marked `data-i18n`); `CONTACT_EMAIL` in `config.js` (info@abroadboard.com), also in the footer and privacy notice |
| Privacy notice + consent | `privacyNotice()` in `app.js`, shown on the Join page and at `#privacy`; consent saved in `profiles.privacy_consent_at` |
| Auckland check | Campus-area picker and a required "I study in Auckland" box on the Join page (`aucklandFields()` in `app.js`). Saved as `profiles.campus` and `auckland_confirmed_at`; posting, selling and requesting contact details need it (`is_verified()` in `schema.sql`). |
| Sign-in code | `SIGNUP_CODE` in `config.js` (now `12345`): students type it after pressing Sign up, and `fixedCodeSignIn()` in `data.js` signs them in or creates the profile. This does not prove they own the inbox, so it is for testing and demos only. It needs **Confirm email** switched off in Supabase (Authentication → Sign In / Providers → Email). Set `SIGNUP_CODE = ""` to go back to emailed codes, which need the email template in step 3. |
| Buy and Sell | `#market` page, `renderMarket()` and `openDialog("market")` in `app.js`; `posts` with `section = 'market'`, plus `price` and `condition` |
| Who a post is for | Gender, heavy/light sleeper and a free note (`audience_*` columns), shown as "For:" chips |
| Private contact details | Authors pick email, mobile and/or social media. Details live in `post_contacts` and stay hidden; others send a request (`contact_requests`) and the author taps Share or Decline. |
| Photos | Up to 2 .jpg/.jpeg photos per post, 5 MB each, in the `post-images` storage bucket. Resized in the browser before upload; checked again by the bucket. |
| 7 Categories + custom | `CATEGORIES` in `app.js` |
| 8 Report button | `reports` table; admins see "Reported ×n" |
| 10 Auto-delete after 21 days | Read rule hides old posts, and a cron job deletes them hourly |
| 15 Newest first | `order("created_at", { ascending: false })` |
| 16 Events, $5 | Events page and checkout box. Payment is simulated for now. |
| 18 Food tips | `posts` table with `section = 'food'` |
| 22 Filter by category | Category chips above the feed |
| 23 Campus tips + map | Campus page. **The map image still needs adding.** |

---

## Going live: setup steps (about 30–45 minutes, one person)

### 1. Create the Supabase project
1. Sign up at <https://supabase.com> (free plan).
2. **New project**. Name it `abroadboard`, pick the **Sydney** region (closest to Auckland), and save the database password somewhere safe.

### 2. Create the database
1. In the project, open **SQL Editor → New query**.
2. Paste the whole of `supabase/schema.sql` and click **Run**. It should say *Success*.
3. Check **Table Editor**: you should see `profiles`, `posts`, `events` and `reports`.
4. (Optional) To fill the site with sample events and meetup posts, sign up on the site once, then paste `supabase/seed.sql` into a new query and click **Run**. The samples are posted under the first admin's name (or the first account).
5. Check **Integrations → Cron**: you should see two jobs starting with `abroadboard-`.
   If the cron part failed, enable **Cron** under Integrations first, then run the file again. Running it again is safe.

### 3. Set up email sign-in
Students sign in with a one-time code that is emailed to them, so nobody needs a password. The site only accepts emails from the institutions in `js/config.js`, then asks for the code.

1. **Authentication → Sign In / Providers → Email**: make sure it's enabled.
2. **Authentication → URL Configuration**:
   - **Site URL**: your Vercel address once you have it (step 8), e.g. `https://abroadboard.vercel.app`.
   - **Redirect URLs**: add `https://*.vercel.app/**` and `http://localhost:3000/**`.
3. **Authentication → Hooks → Add hook → Before User Created → Postgres**, and choose `public.hook_uoa_only`. This refuses emails from other domains at sign-up. Without it, the database rules still stop them from posting.
4. **Authentication → Emails → Templates**: paste `supabase/email-templates/sign-in.html` into **both** "Confirm signup" and "Magic Link", with the subject `Your abroadboard sign-in code: {{ .Token }}`. Supabase's default emails only contain a link, so **without this step students never see a code**. Editing templates needs your own email service (step 4) on the free plan.

### 4. Make sure the emails actually arrive (important)
Supabase's built-in email sender **only delivers to members of your Supabase team** and is limited to a couple of emails per hour. That's fine for a quick test, but not for a class demo.

- **Quick test:** invite teammates to the Supabase organisation (**Organization settings → Team**) using the email addresses they will log in with.
- **Class demo and real users:** connect a free email service under **Authentication → Emails → SMTP Settings**. Brevo and Resend both have free tiers and are listed in Supabase's guide. Then raise the email limit in **Authentication → Rate Limits**.
- UoA inboxes can filter unfamiliar senders, so tell testers to check their junk folder.

### 5. Connect the site to Supabase
1. **Project Settings → API keys**: copy the **Project URL** and the **publishable** key (called `anon` `public` on older projects).
2. Paste them into `js/config.js`:
   ```js
   export const SUPABASE_URL = "https://abcdefgh.supabase.co";
   export const SUPABASE_ANON_KEY = "sb_publishable_...";
   ```
   This key is meant to be public, and the security rules protect the data. **Never** paste the `secret` or `service_role` key into the site.

### 6. (Optional) Run it on your computer
This step is only for developers. Everyone else can skip straight to step 8 and test on the live site.

Browsers block this kind of JavaScript if you just double-click `index.html`, so run a small local server from the project folder. Use the **Live Server** extension in VS Code, or run `npx serve .` if Node.js is installed.

### 7. Make yourself (and the Product Owner) an admin
In **SQL Editor**, run this after the person has signed up once:
```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'yourupi@aucklanduni.ac.nz');
```
Refresh the site. You'll see an **Admin** badge, Delete buttons on every post, and a count of reported posts.

### 8. Put it online with Vercel (no terminal needed)
1. At <https://github.com>, click **New repository**. Name it `abroadboard`, then create it.
2. On the empty repo page, click **uploading an existing file**. Drag in the *contents* of the `abroadboard` folder (`index.html`, `css`, `js`, `assets`, `supabase`, `README.md`), then click **Commit changes**.
3. At <https://vercel.com>, **sign up with GitHub**, then **Add New → Project**. Import `abroadboard`, set **Framework preset** to **Other**, leave the build settings empty, and click **Deploy**.
4. Copy the `https://…vercel.app` address into Supabase under **Authentication → URL Configuration → Site URL** (step 3).
5. Open the address and sign up with your UoA email. The purple "Demo mode" bar should be gone.
6. Put that address in the QR code on your posters (Story 17).

To change the site later, edit the files on GitHub, or upload new versions. Vercel redeploys automatically within a minute. Each pull request also gets its own preview link, which is handy for sprint reviews.

---

## Working as a team
- One person owns `schema.sql` changes. After changing it, run the file again in the SQL Editor.
- Use a branch and pull request for each user story, and link the story number in the PR title (e.g. `Story 23: campus map`).
- To test without touching real data, clear the two values in `config.js` locally to get demo mode back.

## Known gaps (backlog for Sprints 2–3)
- **Event payments are simulated.** Every event is published straight away. To add Stripe in test mode:
  1. Change the `payment_status` default in `schema.sql` to `'pending'`.
  2. Add a Stripe Checkout link.
  3. Add a small Supabase Edge Function that receives Stripe's webhook and sets `payment_status = 'paid'`.
- **Reports don't email admins yet.** Admins see them in the admin view. To add emails, a Supabase *Database Webhook* on `reports` can call an Edge Function that sends one.
- **Campus map image** still needs adding (see the comment in `index.html`).
- **Google AdSense** needs the site live with real content before it's approved. Replace `AD_SLOT` in `app.js` with the `<ins>` code AdSense gives you.
- **Images on posts (Story 11)**: use Supabase Storage with a 2 MB limit per file.
- **Heading/subheading text options (Story 12)**: not started.
- **New posts don't appear live.** Other people's posts show up after a page refresh. Supabase Realtime can add live updates later.
