// Data layer. The rest of the site only talks to the object returned by
// createBackend(), so it works the same with Supabase ("live") or without it ("demo").

import { SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_DOMAINS, EXPIRY_DAYS, PRIVACY_VERSION } from "./config.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
const DAY = 864e5;

// True when the email belongs to one of the allowed institutions (exact domain match).
export function isStudentEmail(email) {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(String(email).trim().toLowerCase());
  return !!m && ALLOWED_DOMAINS.includes(m[1]);
}

const NOT_STUDENT = "Use your student email from one of the Auckland institutions listed below.";

// Today's date as YYYY-MM-DD in the visitor's own time zone.
export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}

export async function createBackend() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return createLive();
  return createDemo();
}

// Turn Supabase errors into sentences a student can act on.
function friendly(error) {
  const msg = (error && (error.message || error.error_description)) || String(error);
  const rules = [
    [/rate limit|too many|security purposes/i, "Too many attempts. Wait a minute and try again."],
    [/student email/i, NOT_STUDENT],
    [/row-level security|permission denied/i, "Only signed-in students with an accepted student email can do that."],
    [/token has expired|invalid.*(token|otp|code)|(otp|token).*(invalid|expired)/i, "That code is wrong or has expired. Request a new code and try again."],
    [/error sending|smtp|email address not authorized/i, "We couldn't send the email. The site's email service isn't set up yet (see README, step 4)."],
    [/signups not allowed/i, "New sign-ups are switched off at the moment."],
    [/failed to fetch|network/i, "Can't reach the server. Check your internet connection and try again."],
    [/check constraint/i, "One of the fields is too long or empty. Shorten it and try again."],
  ];
  for (const [re, text] of rules) if (re.test(msg)) return new Error(text);
  return new Error(msg);
}

// ---------------------------------------------------------------------------
// LIVE: Supabase
// ---------------------------------------------------------------------------
async function createLive() {
  const { createClient } = await import(SUPABASE_JS);
  // Accept common copy-paste mistakes: trailing slash, "/rest/v1", spaces.
  const url = SUPABASE_URL.trim().replace(/\/(rest|auth)\/v1\/?.*$/, "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url))
    throw new Error(`SUPABASE_URL in js/config.js should look like https://abcdefgh.supabase.co (it is "${SUPABASE_URL}").`);
  const sb = createClient(url, SUPABASE_ANON_KEY.trim());

  const check = ({ data, error, count }) => {
    if (error) throw friendly(error);
    return count ?? data;
  };
  const normPost = (p) => ({
    id: p.id, section: p.section, category: p.category, title: p.title, body: p.body,
    contact: p.contact, price: p.price, createdAt: new Date(p.created_at).getTime(),
    authorId: p.author_id, authorName: p.author?.display_name || "Student",
    authorCountry: p.author?.home_country || "",
  });

  return {
    mode: "live",

    async currentUser() {
      const { data: { session } } = await sb.auth.getSession();
      const u = session?.user;
      if (!u) return null;
      const { data: p } = await sb.from("profiles").select("*").eq("id", u.id).maybeSingle();
      return { id: u.id, email: u.email, name: p?.display_name || u.email.split("@")[0],
               country: p?.home_country || "", isAdmin: !!p?.is_admin };
    },
    onAuthChange(cb) {
      // Supabase advises not to call other Supabase functions inside this callback, hence setTimeout.
      sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(cb, 0);
      });
    },
    async sendCode(email) {
      // Supabase's default email contains a sign-in link. Clicking it brings the student back
      // to this page already signed in. (If the email template shows {{ .Token }}, the code works too.)
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin + window.location.pathname,
          // Saved on the new account; the database records when consent was given.
          data: { privacy_consent: true, privacy_version: PRIVACY_VERSION },
        },
      });
      if (error) throw friendly(error);
    },
    async verifyCode(email, token) {
      const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
      if (error) throw friendly(error);
    },
    async signOut() { await sb.auth.signOut(); },
    async updateProfile(userId, { name, country }) {
      const patch = {};
      if (name) patch.display_name = name;
      if (country !== undefined) patch.home_country = country || null;
      if (!Object.keys(patch).length) return;
      check(await sb.from("profiles").update(patch).eq("id", userId));
    },

    async listPosts(section) {
      const rows = check(await sb.from("posts")
        .select("id,section,category,title,body,contact,price,created_at,author_id,author:profiles(display_name,home_country)")
        .eq("section", section).order("created_at", { ascending: false }).limit(200));
      return rows.map(normPost);
    },
    async createPost(post) {
      check(await sb.from("posts").insert({
        section: post.section, category: post.category, title: post.title,
        body: post.body, contact: post.contact || null, price: post.price || null,
      }));
    },
    async deletePost(id) {
      const n = check(await sb.from("posts").delete({ count: "exact" }).eq("id", id));
      if (!n) throw new Error("You can only delete your own posts.");
    },

    async reportPost(postId, reason = null) {
      const { error } = await sb.from("reports").insert({ post_id: postId, reason });
      if (error && error.code !== "23505") throw friendly(error); // 23505 = already reported
    },
    async listReports() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return [];
      return check(await sb.from("reports").select("post_id,reporter_id"));
    },
    async clearReports(postId) {
      check(await sb.from("reports").delete().eq("post_id", postId));
    },

    async listEvents() {
      const rows = check(await sb.from("events")
        .select("id,title,event_date,venue,blurb,host_id,payment_status,host:profiles(display_name)")
        .gte("event_date", todayISO()).order("event_date"));
      return rows.map((e) => ({ id: e.id, title: e.title, date: e.event_date, venue: e.venue, blurb: e.blurb,
        hostId: e.host_id, hostName: e.host?.display_name || "Student", paymentStatus: e.payment_status }));
    },
    async createEvent(ev) {
      check(await sb.from("events").insert({ title: ev.title, event_date: ev.date, venue: ev.venue, blurb: ev.blurb }));
    },
    async deleteEvent(id) {
      const n = check(await sb.from("events").delete({ count: "exact" }).eq("id", id));
      if (!n) throw new Error("You can only delete events you posted.");
    },
  };
}

// ---------------------------------------------------------------------------
// DEMO: no server. Sample data kept in this browser's localStorage.
// ---------------------------------------------------------------------------
function createDemo() {
  const KEY = "abroadboard-demo-v2";
  const listeners = [];
  let S;

  function seed() {
    const now = Date.now(), ago = (d) => now - d * DAY;
    const inDays = (d) => new Date(now + d * DAY - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    const P = (id, section, category, title, body, authorName, authorCountry, contact, days, price = null) =>
      ({ id, section, category, title, body, authorName, authorCountry, contact, price, createdAt: ago(days), authorId: "sample-" + authorName });
    return {
      user: null, admin: false, nextId: 100, reports: [],
      posts: [
        P(1, "board", "Meetups", "Anyone up for a Rangitoto hike this Sunday?", "Planning to catch the morning ferry from downtown and walk to the summit. Slow pace, lots of photo stops. Bring water and lunch.", "Mei", "Taiwan", "Insta @mei.walks", 0.15),
        P(2, "board", "Housing", "Room free in a 4-bedroom flat near Grafton", "Quiet flat, two other internationals and one Kiwi. 15 min walk to the City Campus. Available from 1 November.", "Arjun", "India", "arjun.p@aucklanduni.ac.nz", 1.2),
        P(3, "board", "Buy & sell", "Rice cooker and desk lamp, $25 for both", "Both work perfectly. Leaving NZ at the end of semester. Pick-up near Symonds St.", "Lukas", "Germany", "WhatsApp 021 000 0000", 2.4),
        P(4, "board", "Study buddies", "ENGGEN study group, Tuesday evenings", "Looking for 3–4 people to go through lecture content and past papers together. Library group rooms.", "Nazia", "Bangladesh", "nazia.a@aucklanduni.ac.nz", 3.1),
        P(5, "board", "Help", "How do I get an IRD number for part-time work?", "Just got my first casual job offer. What documents did you need, and how long did it take?", "Zihou", "China", "zihou.r@aucklanduni.ac.nz", 5.6),
        P(6, "board", "Meetups", "Casual cricket in the Domain, Saturday 2pm", "All levels welcome. We have a bat and tennis balls. Look for the red umbrella.", "Vishal", "India", "vishal.s@aucklanduni.ac.nz", 8.3),
        P(7, "board", "Meetups", "Board games night: bring a snack from home", "Sharing food from our home countries plus Catan and Codenames. Around 8 people so far.", "Sofie", "Denmark", "sofie.r@aucklanduni.ac.nz", 12.5),
        P(8, "board", "Buy & sell", "Commuter bike for sale, fits 160–175 cm", "Includes lock and helmet. Great for getting up the hill to campus.", "Megha", "India", "megha.m@aucklanduni.ac.nz", 19.2),
        P(20, "food", "Tip", "Supermarket markdowns after 7pm", "Bakery and deli items often get reduced near closing time.", "Lukas", "Germany", "", 1, "50% off"),
        P(21, "food", "Tip", "Weekend vege market", "Buy a week of fruit and vegetables in one trip. Go near closing for the best deals.", "Nazia", "Bangladesh", "", 2, "~$20/week"),
        P(22, "food", "Tip", "Cook-once, eat-three-times dal", "Lentils, onion, tomato and spices. Freezes well and costs very little per serve.", "Arjun", "India", "", 4, "~$2/serve"),
        P(23, "food", "Tip", "Bring your own lunch box", "Microwaves are available in several student spaces on campus. Ask around in your faculty.", "Mei", "Taiwan", "", 6, "Free"),
      ],
      events: [
        { id: 1, title: "International welcome potluck", date: inDays(3), venue: "Albert Park, by the fountain", blurb: "Bring a dish from home and meet other new arrivals. Plates provided.", hostId: "sample-g7", hostName: "Group 7", paymentStatus: "demo_paid" },
        { id: 2, title: "Beach afternoon at Mission Bay", date: inDays(6), venue: "Mission Bay, meet at the bus stop", blurb: "Swimming if it's warm, ice cream if it's not. Bus from the city centre.", hostId: "sample-mei", hostName: "Mei", paymentStatus: "demo_paid" },
        { id: 3, title: "Karaoke night", date: inDays(9), venue: "Central city, details on sign-up", blurb: "Songs in every language welcome. Split cost for a room of 10.", hostId: "sample-s", hostName: "Sathvik", paymentStatus: "demo_paid" },
        { id: 4, title: "Budget grocery walk", date: inDays(12), venue: "Meet outside the General Library", blurb: "We visit two supermarkets and a vege market and compare prices for a week of meals.", hostId: "sample-n", hostName: "Nazia", paymentStatus: "demo_paid" },
      ],
    };
  }
  const load = () => { try { const r = localStorage.getItem(KEY); S = r ? JSON.parse(r) : seed(); } catch { S = seed(); } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage blocked: keep in memory */ } };
  const expire = () => { const cutoff = Date.now() - EXPIRY_DAYS * DAY; S.posts = S.posts.filter((p) => p.createdAt > cutoff); };
  const notify = () => listeners.forEach((cb) => setTimeout(cb, 0));
  const me = () => { if (!S.user) throw new Error("Sign in with your student email first."); return S.user; };
  const wait = () => new Promise((r) => setTimeout(r, 150)); // feels like a network call
  load(); expire(); save();

  return {
    mode: "demo",
    async currentUser() { return S.user ? { ...S.user, isAdmin: !!S.admin } : null; },
    onAuthChange(cb) { listeners.push(cb); },
    async sendCode(email) { await wait(); if (!isStudentEmail(email)) throw new Error(NOT_STUDENT); },
    async verifyCode(email, token) {
      await wait();
      if (!/^\d{6}$/.test(token)) throw new Error("That code is wrong or has expired. Request a new code and try again.");
      const local = email.split("@")[0];
      S.user = { id: "demo-" + email.toLowerCase(), email: email.toLowerCase(), name: local, country: "" };
      save(); notify();
    },
    async signOut() { S.user = null; save(); notify(); },
    async updateProfile(_id, { name, country }) { const u = me(); if (name) u.name = name; if (country !== undefined) u.country = country; save(); },

    async listPosts(section) { await wait(); expire(); return S.posts.filter((p) => p.section === section).sort((a, b) => b.createdAt - a.createdAt); },
    async createPost(post) {
      const u = me();
      S.posts.push({ ...post, id: S.nextId++, createdAt: Date.now(), authorId: u.id, authorName: u.name, authorCountry: u.country });
      save();
    },
    async deletePost(id) {
      const u = me(), p = S.posts.find((x) => x.id === id);
      if (!p) return;
      if (p.authorId !== u.id && !S.admin) throw new Error("You can only delete your own posts.");
      S.posts = S.posts.filter((x) => x.id !== id); S.reports = S.reports.filter((r) => r.post_id !== id); save();
    },
    async reportPost(postId) {
      const u = me();
      if (!S.reports.some((r) => r.post_id === postId && r.reporter_id === u.id)) S.reports.push({ post_id: postId, reporter_id: u.id });
      save();
    },
    async listReports() {
      if (!S.user) return [];
      return S.admin ? S.reports : S.reports.filter((r) => r.reporter_id === S.user.id);
    },
    async clearReports(postId) { S.reports = S.reports.filter((r) => r.post_id !== postId); save(); },

    async listEvents() { await wait(); const t = todayISO(); return S.events.filter((e) => e.date >= t).sort((a, b) => a.date.localeCompare(b.date)); },
    async createEvent(ev) { const u = me(); S.events.push({ ...ev, id: S.nextId++, hostId: u.id, hostName: u.name, paymentStatus: "demo_paid" }); save(); },
    async deleteEvent(id) {
      const u = me(), e = S.events.find((x) => x.id === id);
      if (e && e.hostId !== u.id && !S.admin) throw new Error("You can only delete events you posted.");
      S.events = S.events.filter((x) => x.id !== id); save();
    },

    // Demo-only helpers
    setAdmin(on) { S.admin = !!on; save(); },
    reset() { S = seed(); save(); notify(); },
  };
}
