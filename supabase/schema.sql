-- ============================================================================
-- abroadboard: database setup for Supabase
-- Run this whole file once in Supabase Dashboard > SQL Editor > New query.
-- It is safe to run again later (it updates what already exists).
--
-- What it creates
--   profiles  one row per signed-up student (name, home country, admin flag)
--   posts     board posts and food & budget tips              (Stories 2, 18)
--   events    local event listings, $5 fee status             (Story 16)
--   reports   "Report" clicks on posts, visible to admins     (Story 8)
--   category_requests, support_threads/support_messages, notifications  (section 8)
--
-- Rules it enforces on the server (not just in the browser)
--   * Only student emails from the accepted Auckland institutions can post,
--     list events or report (Story 6). The list is in allowed_email_domains().
--   * Each new account records when it agreed to the privacy notice and
--     confirmed it studies in Auckland; posting needs both (is_verified())
--   * Contact details on posts are private until the author approves a request
--   * Photos: up to 2 JPEGs per post, 5 MB each, in the post-images bucket
--   * Anyone can read; people can delete their own posts; admins can delete any (Story 3)
--   * Posts older than 21 days are hidden at once and deleted hourly (Story 10)
--   * Users cannot make themselves admin or back-date their posts
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------------

-- Allowed student email domains. Keep in sync with INSTITUTIONS in js/config.js.
create or replace function public.allowed_email_domains()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'aucklanduni.ac.nz', 'uoa.auckland.ac.nz',   -- University of Auckland
    'autuni.ac.nz',                              -- AUT
    'massey.ac.nz',                              -- Massey University (Albany)
    'myunitec.ac.nz',                            -- Unitec
    'manukaumail.com',                           -- Manukau Institute of Technology
    'student.yoobee.ac.nz',                      -- Yoobee College
    'nzst.ac.nz',                                -- NZ School of Tourism
    'ess.ais.ac.nz',                             -- Auckland Institute of Studies
    'nztertiarycollege.ac.nz',                   -- NZ Tertiary College
    'nzma.ac.nz',                                -- NZMA
    'nzse.ac.nz',                                -- NZ Skills and Education College
    'acts.ac.nz',                                -- Auckland College of Tertiary Studies
    'imperial.ac.nz',                            -- Imperial College of NZ
    'ica.ac.nz',                                 -- International College of Auckland
    'crown.ac.nz',                               -- Crown Institute of Studies
    'nzios.ac.nz'                                -- NZ Institute of Studies
  ]::text[]
$$;

-- True when an email address belongs to one of the allowed domains (exact match).
create or replace function public.is_student_email(email text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    lower(split_part(email, '@', 2)) = any (public.allowed_email_domains())
      and email like '%_@_%',
    false)
$$;

-- True when the signed-in user has an allowed student email.
create or replace function public.is_student()
returns boolean language sql stable set search_path = '' as $$
  select public.is_student_email(auth.jwt() ->> 'email')
$$;


-- ---------------------------------------------------------------------------
-- 2. Profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default 'Student'
                check (char_length(display_name) between 1 and 40),
  home_country  text check (char_length(home_country) <= 40),
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Record of privacy-notice consent, filled in when the account is created.
alter table public.profiles add column if not exists privacy_consent_at timestamptz;
alter table public.profiles add column if not exists privacy_version text;

-- Auckland location confirmation, given at sign-up (or later on the account page).
alter table public.profiles add column if not exists campus text check (char_length(campus) <= 60);
alter table public.profiles add column if not exists auckland_confirmed_at timestamptz;

-- True when the signed-in user is an admin. SECURITY DEFINER so it can read
-- profiles without tripping the table's own security rules.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false)
$$;

-- True when the signed-in user has an allowed student email AND has confirmed
-- they study in Auckland. Every "create" rule below uses this.
create or replace function public.is_verified()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_student() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.auckland_confirmed_at is not null)
$$;

-- Confirm Auckland study for an account that signed up before this was asked.
create or replace function public.confirm_auckland(campus_name text)
returns void language sql security definer set search_path = '' as $$
  update public.profiles
     set campus = left(nullif(trim(campus_name), ''), 60),
         auckland_confirmed_at = coalesce(auckland_confirmed_at, now())
   where id = auth.uid() and nullif(trim(campus_name), '') is not null
$$;

-- Create a profile automatically when someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, privacy_consent_at, privacy_version,
                               campus, auckland_confirmed_at)
  values (
    new.id,
    left(coalesce(nullif(split_part(new.email, '@', 1), ''), 'Student'), 40),
    case when new.raw_user_meta_data ->> 'privacy_consent' = 'true' then now() end,
    left(new.raw_user_meta_data ->> 'privacy_version', 20),
    left(nullif(trim(new.raw_user_meta_data ->> 'campus'), ''), 60),
    case when new.raw_user_meta_data ->> 'auckland_confirmed' = 'true'
              and nullif(trim(new.raw_user_meta_data ->> 'campus'), '') is not null then now() end)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only called by the trigger below and is_admin() by security rules; not public API.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.is_verified() from anon, public;
grant execute on function public.is_verified() to authenticated;
revoke execute on function public.confirm_auckland(text) from anon, public;
grant execute on function public.confirm_auckland(text) to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "Profiles are readable by everyone" on public.profiles;
create policy "Profiles are readable by everyone"
  on public.profiles for select to anon, authenticated using (true);

drop policy if exists "Students update their own profile" on public.profiles;
create policy "Students update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Students may change only their name and country, never is_admin.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (display_name, home_country, campus) on public.profiles to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Posts (the board and the food & budget page share this table)
-- ---------------------------------------------------------------------------

create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  section     text not null default 'board' check (section in ('board', 'food')),
  category    text not null check (char_length(category) between 1 and 30),
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 2000),
  contact     text check (char_length(contact) <= 120),
  price       text check (char_length(price) <= 30),
  author_id   uuid not null default auth.uid()
              references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Added for the marketplace, audience criteria, private contact and photos.
alter table public.posts add column if not exists condition text
  check (condition in ('New', 'Like new', 'Good', 'Fair'));
alter table public.posts add column if not exists audience_gender text not null default 'any'
  check (audience_gender in ('any', 'women', 'men', 'nonbinary'));
alter table public.posts add column if not exists audience_sleeper text not null default 'any'
  check (audience_sleeper in ('any', 'light', 'heavy'));
alter table public.posts add column if not exists audience_note text
  check (char_length(audience_note) <= 120);
-- Which contact methods the author offers (the details themselves are in post_contacts).
alter table public.posts add column if not exists contact_methods text[] not null default '{}'
  check (contact_methods <@ array['email', 'mobile', 'social']::text[]);
-- Storage paths in the post-images bucket, at most two.
alter table public.posts add column if not exists images text[] not null default '{}'
  check (coalesce(array_length(images, 1), 0) <= 2);

-- 'market' is the Buy & sell section.
alter table public.posts drop constraint if exists posts_section_check;
alter table public.posts add constraint posts_section_check
  check (section in ('board', 'food', 'market'));

create index if not exists posts_section_created_idx
  on public.posts (section, created_at desc);

alter table public.posts enable row level security;

drop policy if exists "Recent posts are readable by everyone" on public.posts;
create policy "Recent posts are readable by everyone"
  on public.posts for select to anon, authenticated
  using (created_at > now() - interval '21 days');

drop policy if exists "UoA students create their own posts" on public.posts;
drop policy if exists "Students create their own posts" on public.posts;
create policy "Students create their own posts"
  on public.posts for insert to authenticated
  with check (author_id = auth.uid() and public.is_verified()
              -- photos must be in the author's own folder
              and not exists (select 1 from unnest(images) i
                              where i not like auth.uid()::text || '/%'));

drop policy if exists "Authors and admins delete posts" on public.posts;
create policy "Authors and admins delete posts"
  on public.posts for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- Only these columns can be written by the website. id, author_id and
-- created_at are always filled in by the database, so they can't be faked.
revoke insert, update, delete on public.posts from anon, authenticated;
grant select on public.posts to anon, authenticated;
grant insert (section, category, title, body, contact, price, condition, audience_gender,
               audience_sleeper, audience_note, contact_methods, images) on public.posts to authenticated;
grant delete on public.posts to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Events
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id              bigint generated always as identity primary key,
  title           text not null check (char_length(title) between 1 and 80),
  event_date      date not null,
  venue           text not null check (char_length(venue) between 1 and 80),
  blurb           text not null check (char_length(blurb) between 1 and 400),
  host_id         uuid not null default auth.uid()
                  references public.profiles (id) on delete cascade,
  -- 'demo_paid' while payments are simulated. When Stripe is added, change the
  -- default to 'pending' and let the Stripe webhook set 'paid'.
  payment_status  text not null default 'demo_paid'
                  check (payment_status in ('pending', 'demo_paid', 'paid')),
  created_at      timestamptz not null default now()
);

create index if not exists events_date_idx on public.events (event_date);

alter table public.events enable row level security;

drop policy if exists "Paid upcoming events are readable by everyone" on public.events;
create policy "Paid upcoming events are readable by everyone"
  on public.events for select to anon, authenticated
  using (payment_status in ('demo_paid', 'paid') and event_date >= current_date - 1);

drop policy if exists "Hosts see their own events" on public.events;
create policy "Hosts see their own events"
  on public.events for select to authenticated
  using (host_id = auth.uid() or public.is_admin());

drop policy if exists "UoA students create events" on public.events;
drop policy if exists "Students create events" on public.events;
create policy "Students create events"
  on public.events for insert to authenticated
  with check (host_id = auth.uid() and public.is_verified()
              and event_date >= current_date and event_date <= current_date + 365);

drop policy if exists "Hosts and admins delete events" on public.events;
create policy "Hosts and admins delete events"
  on public.events for delete to authenticated
  using (host_id = auth.uid() or public.is_admin());

-- payment_status is deliberately not writable from the website.
revoke insert, update, delete on public.events from anon, authenticated;
grant select on public.events to anon, authenticated;
grant insert (title, event_date, venue, blurb) on public.events to authenticated;
grant delete on public.events to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Reports
-- ---------------------------------------------------------------------------

create table if not exists public.reports (
  id           bigint generated always as identity primary key,
  post_id      bigint not null references public.posts (id) on delete cascade,
  reporter_id  uuid not null default auth.uid()
               references public.profiles (id) on delete cascade,
  reason       text check (char_length(reason) <= 300),
  created_at   timestamptz not null default now(),
  unique (post_id, reporter_id)
);

alter table public.reports enable row level security;

drop policy if exists "Students report posts" on public.reports;
create policy "Students report posts"
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_verified());

-- Students see their own reports (so the button shows "Reported");
-- admins see every report.
drop policy if exists "Reporters and admins read reports" on public.reports;
create policy "Reporters and admins read reports"
  on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists "Admins clear reports" on public.reports;
create policy "Admins clear reports"
  on public.reports for delete to authenticated
  using (public.is_admin());

revoke insert, update, delete, select on public.reports from anon, authenticated;
grant select, delete on public.reports to authenticated;
grant insert (post_id, reason) on public.reports to authenticated;


-- ---------------------------------------------------------------------------
-- 5b. Private contact details and contact requests
-- The author's email / mobile / social handle for a post are readable only by
-- the author, admins, and students whose contact request the author approved.
-- ---------------------------------------------------------------------------

create table if not exists public.post_contacts (
  post_id  bigint primary key references public.posts (id) on delete cascade,
  email    text check (char_length(email) <= 120),
  mobile   text check (char_length(mobile) <= 40),
  social   text check (char_length(social) <= 120)
);

create table if not exists public.contact_requests (
  id            bigint generated always as identity primary key,
  post_id       bigint not null references public.posts (id) on delete cascade,
  requester_id  uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'declined')),
  created_at    timestamptz not null default now(),
  unique (post_id, requester_id)
);

-- SECURITY DEFINER helpers so the rules below don't depend on each other's RLS.
create or replace function public.owns_post(pid bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.posts p where p.id = pid and p.author_id = auth.uid())
$$;
create or replace function public.contact_approved(pid bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contact_requests r
                 where r.post_id = pid and r.requester_id = auth.uid() and r.status = 'approved')
$$;
revoke execute on function public.owns_post(bigint) from anon, public;
revoke execute on function public.contact_approved(bigint) from anon, public;
grant execute on function public.owns_post(bigint) to authenticated;
grant execute on function public.contact_approved(bigint) to authenticated;

alter table public.post_contacts enable row level security;

drop policy if exists "Authors add contact details" on public.post_contacts;
create policy "Authors add contact details"
  on public.post_contacts for insert to authenticated
  with check (public.owns_post(post_id));

drop policy if exists "Authors, admins and approved students read contact details" on public.post_contacts;
create policy "Authors, admins and approved students read contact details"
  on public.post_contacts for select to authenticated
  using (public.owns_post(post_id) or public.is_admin() or public.contact_approved(post_id));

revoke insert, update, delete, select on public.post_contacts from anon, authenticated;
grant select, insert on public.post_contacts to authenticated;

alter table public.contact_requests enable row level security;

drop policy if exists "Students request contact details" on public.contact_requests;
create policy "Students request contact details"
  on public.contact_requests for insert to authenticated
  with check (requester_id = auth.uid() and public.is_verified()
              and not public.owns_post(post_id));

drop policy if exists "Requesters and authors see requests" on public.contact_requests;
create policy "Requesters and authors see requests"
  on public.contact_requests for select to authenticated
  using (requester_id = auth.uid() or public.owns_post(post_id) or public.is_admin());

drop policy if exists "Authors answer requests" on public.contact_requests;
create policy "Authors answer requests"
  on public.contact_requests for update to authenticated
  using (public.owns_post(post_id)) with check (public.owns_post(post_id));

revoke insert, update, delete, select on public.contact_requests from anon, authenticated;
grant select on public.contact_requests to authenticated;
grant insert (post_id) on public.contact_requests to authenticated;
grant update (status) on public.contact_requests to authenticated;


-- ---------------------------------------------------------------------------
-- 5c. Photos: public bucket, JPEG only, 5 MB each, uploads into <user id>/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "Students upload their own post photos" on storage.objects;
create policy "Students upload their own post photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-images'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_verified());

drop policy if exists "Students delete their own post photos" on storage.objects;
create policy "Students delete their own post photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and (storage.foldername(name))[1] = auth.uid()::text);


-- ---------------------------------------------------------------------------
-- 6. Block sign-ups from other email domains (optional but recommended)
-- After running this file, turn it on in:
--   Authentication > Hooks > Before User Created > Postgres > public.hook_uoa_only
-- (The name is kept from the first version so an existing hook keeps working.)
-- Without it, anyone can create an account but still cannot post (rules above).
-- ---------------------------------------------------------------------------

create or replace function public.hook_uoa_only(event jsonb)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if public.is_student_email(event -> 'user' ->> 'email') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'message', 'Use your student email from one of the accepted Auckland institutions.',
    'http_code', 403));
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_uoa_only(jsonb) to supabase_auth_admin;
grant execute on function public.allowed_email_domains() to supabase_auth_admin;
grant execute on function public.is_student_email(text) to supabase_auth_admin;
revoke execute on function public.hook_uoa_only(jsonb) from authenticated, anon, public;

-- Functions from the first version, no longer used by any rule.
drop function if exists public.is_uoa();
drop function if exists public.allowed_email_domain();


-- ---------------------------------------------------------------------------
-- 7. Automatic clean-up (Story 10)
-- Posts are already hidden after 21 days by the read rule above; these jobs
-- delete them for good. Check them in Integrations > Cron.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'abroadboard-delete-expired-posts',
  '15 * * * *',                      -- every hour at :15 (UTC)
  $$ delete from public.posts where created_at < now() - interval '21 days' $$
);

select cron.schedule(
  'abroadboard-delete-past-events',
  '20 14 * * *',                     -- daily at 14:20 UTC (early morning NZ)
  $$ delete from public.events where event_date < current_date - 7 $$
);


-- ---------------------------------------------------------------------------
-- 8. Interests, notifications, category requests and messages to the admins
--    (FC-34/41 interests, FC-35 notifications, FC-44 categories, FC-37 messages)
-- ---------------------------------------------------------------------------

-- Interests are board category names (CATEGORY_GROUPS in js/config.js).
alter table public.profiles add column if not exists interests text[] not null default '{}'
  check (coalesce(array_length(interests, 1), 0) <= 40);
alter table public.profiles add column if not exists notify_interests boolean not null default true;
grant update (display_name, home_country, campus, interests, notify_interests) on public.profiles to authenticated;

-- Posts in "Sports" carry a sport tag (SPORTS in js/config.js).
alter table public.posts add column if not exists sport text check (char_length(sport) <= 30);
grant insert (sport) on public.posts to authenticated;

-- New categories students ask for. Approved names are readable by everyone
-- and show up in the category menus.
create table if not exists public.category_requests (
  id            bigint generated always as identity primary key,
  name          text not null check (char_length(trim(name)) between 2 and 30),
  reason        text check (char_length(reason) <= 300),
  requested_by  uuid not null default auth.uid()
                references public.profiles (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'declined')),
  created_at    timestamptz not null default now()
);
alter table public.category_requests enable row level security;
drop policy if exists "Approved categories are public" on public.category_requests;
create policy "Approved categories are public"
  on public.category_requests for select to anon, authenticated
  using (status = 'approved' or requested_by = auth.uid() or public.is_admin());
drop policy if exists "Students request categories" on public.category_requests;
create policy "Students request categories"
  on public.category_requests for insert to authenticated
  with check (requested_by = auth.uid() and public.is_student());
drop policy if exists "Admins answer category requests" on public.category_requests;
create policy "Admins answer category requests"
  on public.category_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke insert, update, delete, select on public.category_requests from anon, authenticated;
grant select on public.category_requests to anon, authenticated;
grant insert (name, reason) on public.category_requests to authenticated;
grant update (status) on public.category_requests to authenticated;

-- Messages between students and the admins (contact, complaints, reports).
create table if not exists public.support_threads (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid()
              references public.profiles (id) on delete cascade,
  kind        text not null default 'contact'
              check (kind in ('contact', 'complaint', 'report', 'other')),
  subject     text not null check (char_length(subject) between 1 and 120),
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.support_messages (
  id          bigint generated always as identity primary key,
  thread_id   bigint not null references public.support_threads (id) on delete cascade,
  sender_id   uuid not null default auth.uid()
              references public.profiles (id) on delete cascade,
  from_admin  boolean not null default false,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists support_messages_thread_idx on public.support_messages (thread_id, created_at);

create or replace function public.owns_thread(tid bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.support_threads t where t.id = tid and t.user_id = auth.uid())
$$;
revoke execute on function public.owns_thread(bigint) from anon, public;
grant execute on function public.owns_thread(bigint) to authenticated;

alter table public.support_threads enable row level security;
drop policy if exists "Students and admins read threads" on public.support_threads;
create policy "Students and admins read threads"
  on public.support_threads for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "Students start threads" on public.support_threads;
create policy "Students start threads"
  on public.support_threads for insert to authenticated
  with check (user_id = auth.uid() and public.is_student());
drop policy if exists "Admins close threads" on public.support_threads;
create policy "Admins close threads"
  on public.support_threads for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke insert, update, delete, select on public.support_threads from anon, authenticated;
grant select on public.support_threads to authenticated;
grant insert (kind, subject) on public.support_threads to authenticated;
grant update (status) on public.support_threads to authenticated;

alter table public.support_messages enable row level security;
drop policy if exists "Thread members read messages" on public.support_messages;
create policy "Thread members read messages"
  on public.support_messages for select to authenticated
  using (public.owns_thread(thread_id) or public.is_admin());
drop policy if exists "Thread members write messages" on public.support_messages;
create policy "Thread members write messages"
  on public.support_messages for insert to authenticated
  with check (sender_id = auth.uid() and (public.owns_thread(thread_id) or public.is_admin()));
revoke insert, update, delete, select on public.support_messages from anon, authenticated;
grant select on public.support_messages to authenticated;
grant insert (thread_id, body) on public.support_messages to authenticated;

-- In-site notifications: new posts in a student's interests, admin replies,
-- and answers to category requests.
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('post', 'reply', 'category')),
  post_id     bigint references public.posts (id) on delete cascade,
  thread_id   bigint references public.support_threads (id) on delete cascade,
  title       text not null check (char_length(title) <= 160),
  detail      text check (char_length(detail) <= 60),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "Students read their notifications" on public.notifications;
create policy "Students read their notifications"
  on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "Students mark notifications read" on public.notifications;
create policy "Students mark notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Students clear notifications" on public.notifications;
create policy "Students clear notifications"
  on public.notifications for delete to authenticated using (user_id = auth.uid());
revoke insert, update, delete, select on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- A new board post notifies everyone who picked its category as an interest.
create or replace function public.notify_interested()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.section = 'board' then
    insert into public.notifications (user_id, kind, post_id, title, detail)
    select p.id, 'post', new.id, left(new.title, 160), left(new.category, 60)
      from public.profiles p
     where p.id <> new.author_id and p.notify_interests and new.category = any (p.interests);
  end if;
  return new;
end;
$$;
drop trigger if exists on_post_notify on public.posts;
create trigger on_post_notify after insert on public.posts
  for each row execute function public.notify_interested();

-- Messages: mark admin replies, keep the thread's updated_at current, and
-- notify the student when an admin answers.
create or replace function public.on_support_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  owner uuid; subj text;
begin
  select user_id, subject into owner, subj from public.support_threads where id = new.thread_id;
  new.from_admin := new.sender_id <> owner and public.is_admin();
  update public.support_threads set updated_at = now(),
         status = case when new.from_admin then status else 'open' end
   where id = new.thread_id;
  if new.from_admin then
    insert into public.notifications (user_id, kind, thread_id, title)
    values (owner, 'reply', new.thread_id, left(subj, 160));
  end if;
  return new;
end;
$$;
drop trigger if exists on_support_message on public.support_messages;
create trigger on_support_message before insert on public.support_messages
  for each row execute function public.on_support_message();

-- Tell the student when an admin approves or declines their category.
create or replace function public.on_category_answer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> old.status and new.status in ('approved', 'declined') then
    insert into public.notifications (user_id, kind, title, detail)
    values (new.requested_by, 'category', left(new.name, 160), new.status);
  end if;
  return new;
end;
$$;
drop trigger if exists on_category_answer on public.category_requests;
create trigger on_category_answer after update on public.category_requests
  for each row execute function public.on_category_answer();

revoke execute on function public.notify_interested() from anon, authenticated, public;
revoke execute on function public.on_support_message() from anon, authenticated, public;
revoke execute on function public.on_category_answer() from anon, authenticated, public;

-- Board categories were renamed in October 2026 (FC-44). Move older posts across.
update public.posts set category = case category
    when 'Housing' then 'Flatmates and rooms'
    when 'Study buddies' then 'Study partners'
    when 'Help' then 'Questions and advice'
    when 'Sport' then 'Sports'
    else category end
 where section = 'board' and category in ('Housing', 'Study buddies', 'Help', 'Sport');
update public.posts set category = case title
    when 'Rangitoto hike this Sunday, who''s in?' then 'Weekend and day trips'
    when 'Weekly study session at the library' then 'Study partners'
    else 'Coffee and chat' end
 where section = 'board' and category = 'Meetups';
update public.posts set category = 'Sports', sport = 'Cricket'
 where section = 'board' and title = 'Casual cricket in the Domain, Saturday 2pm';
