// Data layer. The rest of the site only talks to the object returned by
// createBackend(), so it works the same with Supabase ("live") or without it ("demo").

import { SUPABASE_URL, SUPABASE_ANON_KEY, ALLOWED_DOMAINS, EXPIRY_DAYS, PRIVACY_VERSION, SIGNUP_CODE } from "./config.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
const DAY = 864e5;
const BUCKET = "post-images";

// True when the email belongs to one of the allowed institutions (exact domain match).
export function isStudentEmail(email) {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(String(email).trim().toLowerCase());
  return !!m && ALLOWED_DOMAINS.includes(m[1]);
}

const NOT_STUDENT = "Use your student email from one of the Auckland institutions listed below.";
const WRONG_CODE = SIGNUP_CODE ? "That code isn't right. Check it and try again." : "That code is wrong or has expired. Request a new code and try again.";
const BAD_LOGIN = "That email and password don't match a profile. New here? Use Sign up instead.";
const NOT_CONFIRMED = "Confirm that you study in Auckland (on your account page) before posting.";

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
    [/payload too large|maximum allowed size|exceeded/i, "Each photo must be 5 MB or smaller."],
    [/mime type|invalid_mime/i, "Photos must be .jpg or .jpeg files."],
    [/failed to fetch|network/i, "Can't reach the server. Check your internet connection and try again."],
    [/check constraint/i, "One of the fields is too long or empty. Shorten it and try again."],
  ];
  for (const [re, text] of rules) if (re.test(msg)) return new Error(text);
  return new Error(msg);
}

// Fields shared by both backends when a post is created.
const postRow = (p) => ({
  section: p.section, category: p.category, sport: p.sport || null, title: p.title, body: p.body, price: p.price || null,
  condition: p.condition || null, audience_gender: p.audienceGender || "any",
  audience_sleeper: p.audienceSleeper || "any", audience_note: p.audienceNote || null,
  contact_methods: Object.keys(p.contacts || {}).filter((k) => p.contacts[k]),
});

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
  const publicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const normPost = (p) => ({
    id: p.id, section: p.section, category: p.category, sport: p.sport || "", title: p.title, body: p.body,
    contact: p.contact, price: p.price, condition: p.condition,
    audienceGender: p.audience_gender, audienceSleeper: p.audience_sleeper, audienceNote: p.audience_note,
    contactMethods: p.contact_methods || [], imagePaths: p.images || [], images: (p.images || []).map(publicUrl),
    createdAt: new Date(p.created_at).getTime(),
    authorId: p.author_id, authorName: p.author?.display_name || "Student",
    authorCountry: p.author?.home_country || "",
  });
  const uid = async () => (await sb.auth.getSession()).data.session?.user?.id;

  // Fixed-code sign-in (SIGNUP_CODE in config.js): a password account per email,
  // created on first use. The before-user-created hook still checks the domain.
  // What people type is wrapped like this before it is sent, so students type
  // the code and admin accounts (set up in Supabase) type their own number.
  let signupData = {};
  const wrapPassword = (typed) => `abroadboard-${typed}-signin`;
  const fixedPassword = () => wrapPassword(SIGNUP_CODE);
  async function fixedCodeSignIn(email, token) {
    if (token !== SIGNUP_CODE) throw new Error(WRONG_CODE);
    const password = fixedPassword();
    const first = await sb.auth.signInWithPassword({ email, password });
    if (!first.error) return;
    if (!/invalid login credentials/i.test(first.error.message)) throw friendly(first.error);
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: signupData } });
    if (error) throw friendly(error);
    if (data.session) return;
    // No session: the email already has an account made another way, or
    // "Confirm email" is still on in Supabase.
    throw new Error(data.user?.identities?.length === 0
      ? "This email already has an account that can't use the sign-up code. Email info@abroadboard.com for help."
      : "Sign-up with the code isn't switched on yet. Email info@abroadboard.com for help.");
  }

  return {
    mode: "live",

    async currentUser() {
      const { data: { session } } = await sb.auth.getSession();
      const u = session?.user;
      if (!u) return null;
      const { data: p } = await sb.from("profiles").select("*").eq("id", u.id).maybeSingle();
      return { id: u.id, email: u.email, name: p?.display_name || u.email.split("@")[0],
               country: p?.home_country || "", isAdmin: !!p?.is_admin,
               campus: p?.campus || "", aucklandConfirmed: !!p?.auckland_confirmed_at,
               interests: p?.interests || [], notifyInterests: p?.notify_interests !== false };
    },
    onAuthChange(cb) {
      // Supabase advises not to call other Supabase functions inside this callback, hence setTimeout.
      sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(cb, 0);
      });
    },
    async sendCode(email, { campus } = {}) {
      // Saved on a new account; the database records consent and Auckland confirmation.
      signupData = { privacy_consent: true, privacy_version: PRIVACY_VERSION, auckland_confirmed: true, campus };
      if (SIGNUP_CODE) return; // fixed code (config.js): nothing to email
      // Supabase emails a one-time code ({{ .Token }} in the email template) that the
      // student types into the site. The template may also include a sign-in link.
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + window.location.pathname, data: signupData },
      });
      if (error) throw friendly(error);
    },
    async verifyCode(email, token) {
      if (SIGNUP_CODE) return fixedCodeSignIn(email, token);
      const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
      if (error) throw friendly(error);
    },
    // "Sign in" tab for people who already have a profile: email + password
    // (the shared code for students; admins have their own).
    async signIn(email, password) {
      if (!SIGNUP_CODE || !/^\d{4,12}$/.test(password)) throw new Error(BAD_LOGIN);
      const { error } = await sb.auth.signInWithPassword({ email, password: wrapPassword(password) });
      if (error) throw /invalid login credentials/i.test(error.message) ? new Error(BAD_LOGIN) : friendly(error);
    },
    async signOut() { await sb.auth.signOut(); },
    async updateProfile(userId, { name, country, interests, notifyInterests }) {
      const patch = {};
      if (name) patch.display_name = name;
      if (country !== undefined) patch.home_country = country || null;
      if (interests) patch.interests = interests;
      if (notifyInterests !== undefined) patch.notify_interests = !!notifyInterests;
      if (!Object.keys(patch).length) return;
      check(await sb.from("profiles").update(patch).eq("id", userId));
    },
    async confirmAuckland(campus) {
      check(await sb.rpc("confirm_auckland", { campus_name: campus }));
    },

    async listPosts(section) {
      const rows = check(await sb.from("posts")
        .select("id,section,category,sport,title,body,contact,price,condition,audience_gender,audience_sleeper,audience_note,contact_methods,images,created_at,author_id,author:profiles(display_name,home_country)")
        .eq("section", section).order("created_at", { ascending: false }).limit(200));
      return rows.map(normPost);
    },
    // photos: JPEG Blobs, already checked and resized by the page.
    async createPost(post, photos = []) {
      const me = await uid();
      if (!me) throw new Error("Sign in with your student email first.");
      const paths = [];
      for (const blob of photos.slice(0, 2)) {
        const path = `${me}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
        if (error) { if (paths.length) await sb.storage.from(BUCKET).remove(paths); throw friendly(error); }
        paths.push(path);
      }
      const { data, error } = await sb.from("posts").insert({ ...postRow(post), images: paths }).select("id").single();
      if (error) { if (paths.length) await sb.storage.from(BUCKET).remove(paths); throw friendly(error); }
      const c = post.contacts || {};
      if (c.email || c.mobile || c.social)
        check(await sb.from("post_contacts").insert({ post_id: data.id, email: c.email || null, mobile: c.mobile || null, social: c.social || null }));
    },
    async deletePost(id) {
      const { data: rows } = await sb.from("posts").select("images,author_id").eq("id", id);
      const n = check(await sb.from("posts").delete({ count: "exact" }).eq("id", id));
      if (!n) throw new Error("You can only delete your own posts.");
      const imgs = rows?.[0]?.images || [];
      if (imgs.length && rows[0].author_id === (await uid())) await sb.storage.from(BUCKET).remove(imgs);
    },

    // Contact requests the signed-in user can see (their own, and ones on their posts),
    // plus the contact details they are allowed to read.
    async listContactInfo() {
      if (!(await uid())) return { requests: [], contacts: {} };
      const requests = check(await sb.from("contact_requests")
        .select("id,post_id,requester_id,status,created_at,requester:profiles(display_name,home_country)"));
      const contacts = check(await sb.from("post_contacts").select("post_id,email,mobile,social"));
      return {
        requests: requests.map((r) => ({ id: r.id, postId: r.post_id, requesterId: r.requester_id, status: r.status,
          requesterName: r.requester?.display_name || "Student", requesterCountry: r.requester?.home_country || "" })),
        contacts: Object.fromEntries(contacts.map((c) => [c.post_id, c])),
      };
    },
    async requestContact(postId) {
      const { error } = await sb.from("contact_requests").insert({ post_id: postId });
      if (error && error.code !== "23505") throw friendly(error); // 23505 = already requested
    },
    async answerRequest(id, status) {
      check(await sb.from("contact_requests").update({ status }).eq("id", id));
    },

    async reportPost(postId, reason = null) {
      const { error } = await sb.from("reports").insert({ post_id: postId, reason });
      if (error && error.code !== "23505") throw friendly(error); // 23505 = already reported
    },
    async listReports() {
      if (!(await uid())) return [];
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

    // Categories students asked for. Everyone gets the approved ones; the
    // requester and admins also see pending and declined ones.
    async listCategoryRequests() {
      const rows = check(await sb.from("category_requests")
        .select("id,name,reason,status,created_at,requested_by,requester:profiles(display_name)").order("created_at"));
      return rows.map((r) => ({ id: r.id, name: r.name, reason: r.reason || "", status: r.status,
        requestedBy: r.requested_by, requesterName: r.requester?.display_name || "Student", createdAt: new Date(r.created_at).getTime() }));
    },
    async requestCategory(name, reason) {
      check(await sb.from("category_requests").insert({ name, reason: reason || null }));
    },
    async answerCategoryRequest(id, status) {
      check(await sb.from("category_requests").update({ status }).eq("id", id));
    },

    async listNotifications() {
      if (!(await uid())) return [];
      const rows = check(await sb.from("notifications")
        .select("id,kind,post_id,thread_id,title,detail,read_at,created_at").order("created_at", { ascending: false }).limit(50));
      return rows.map((n) => ({ id: n.id, kind: n.kind, postId: n.post_id, threadId: n.thread_id, title: n.title,
        detail: n.detail || "", read: !!n.read_at, createdAt: new Date(n.created_at).getTime() }));
    },
    async markNotificationsRead() {
      check(await sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null));
    },
    async clearNotifications() {
      const me = await uid();
      if (me) check(await sb.from("notifications").delete().eq("user_id", me));
    },

    // Messages to the admins. Students see their own threads; admins see all.
    async listThreads() {
      if (!(await uid())) return [];
      const rows = check(await sb.from("support_threads")
        .select("id,kind,subject,status,created_at,updated_at,user_id,user:profiles(display_name,home_country),messages:support_messages(id,body,from_admin,created_at)")
        .order("updated_at", { ascending: false }));
      return rows.map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, status: r.status, userId: r.user_id,
        userName: r.user?.display_name || "Student", userCountry: r.user?.home_country || "",
        updatedAt: new Date(r.updated_at).getTime(),
        messages: (r.messages || []).sort((a, b) => a.id - b.id)
          .map((m) => ({ id: m.id, body: m.body, fromAdmin: m.from_admin, createdAt: new Date(m.created_at).getTime() })) }));
    },
    async startThread(kind, subject, body) {
      const { data, error } = await sb.from("support_threads").insert({ kind, subject }).select("id").single();
      if (error) throw friendly(error);
      check(await sb.from("support_messages").insert({ thread_id: data.id, body }));
    },
    async replyThread(id, body) {
      check(await sb.from("support_messages").insert({ thread_id: id, body }));
    },
    async setThreadStatus(id, status) {
      check(await sb.from("support_threads").update({ status }).eq("id", id));
    },
  };
}

// ---------------------------------------------------------------------------
// DEMO: no server. Sample data kept in this browser's localStorage.
// ---------------------------------------------------------------------------
function createDemo() {
  const KEY = "abroadboard-demo-v5";
  const listeners = [];
  let S;

  function seed() {
    const now = Date.now(), ago = (d) => now - d * DAY;
    const inDays = (d) => new Date(now + d * DAY - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    const P = (id, section, category, title, body, authorName, authorCountry, days, extra = {}) =>
      ({ id, section, category, title, body, authorName, authorCountry, createdAt: ago(days), authorId: "sample-" + authorName,
         price: null, condition: null, audienceGender: "any", audienceSleeper: "any", audienceNote: "",
         contactMethods: ["email"], images: [], ...extra });
    return {
      user: null, admin: false, nextId: 100, reports: [], requests: [],
      contacts: {}, notifications: [], threads: [],
      categoryRequests: [
        { id: 90, name: "Music and jamming", reason: "For people who want to play music together.", status: "approved", requestedBy: "sample-Diego", requesterName: "Diego", createdAt: now - 9 * DAY },
        { id: 91, name: "Volunteering", reason: "Beach clean-ups and community events.", status: "pending", requestedBy: "sample-Hana", requesterName: "Hana", createdAt: now - DAY },
      ],
      // Same samples as supabase/seed.sql, so they have Mandarin in i18n.js.
      posts: [
        P(1, "board", "Weekend and day trips", "Rangitoto hike this Sunday, who's in?", "Catching the morning ferry from downtown and walking to the summit. Slow pace with lots of photo stops. Bring water and lunch.", "Mei", "Taiwan", 0.15, { contactMethods: ["social"] }),
        P(2, "board", "Flatmates and rooms", "Room available in a Mt Eden flat from 1 November", "Furnished double room in a 3-bedroom flat, 10 minutes by bus to the city. $230 a week including power and Wi-Fi. Looking for a tidy, quiet flatmate.", "Arjun", "India", 1.2, { audienceSleeper: "light", audienceNote: "Non-smoker", contactMethods: ["email", "mobile"] }),
        P(3, "board", "Flatmates and rooms", "Looking for a third flatmate near the city campuses", "Two students looking for one more person to share a 3-bedroom apartment in the CBD from December. About $260 a week each.", "Sofie", "Denmark", 2.5, { audienceGender: "women" }),
        P(4, "board", "Study partners", "Statistics study partner wanted", "Taking first-year statistics and want someone to go through tutorial questions with. Weekdays after 4pm at any city library.", "Nazia", "Bangladesh", 3.1),
        P(5, "board", "Questions and advice", "How do I get an IRD number for part-time work?", "Got my first casual job offer. What documents did you need, and how long did it take?", "Zihou", "China", 5.6),
        P(6, "board", "Sports", "Casual cricket in the Domain, Saturday 2pm", "All levels welcome. We have a bat and tennis balls. Look for the red umbrella near the duck pond.", "Vishal", "India", 8.3, { sport: "Cricket" }),
        P(7, "board", "Coffee and chat", "Board games and snacks from home, Friday night", "Catan, Codenames and Uno, plus food from our home countries to share. Around 8 people so far, room for more.", "Sofie", "Denmark", 12.5),
        P(8, "board", "Study partners", "IELTS speaking practice partner", "Preparing for the IELTS speaking test. Happy to meet twice a week on campus or online to practise together.", "Minh", "Vietnam", 4),
        P(9, "board", "Questions and advice", "Which mobile plan is best for students?", "Just arrived and need a SIM card. Which provider gives the best value for data and for calling home?", "Lukas", "Germany", 0.6),
        P(40, "board", "Coffee and chat", "Coffee after Monday lectures?", "New to Auckland and keen to meet people outside class. I usually grab a flat white near Shortland Street around 3pm on Mondays. Come say hi.", "Hana", "Japan", 0.4),
        P(41, "board", "Weekend and day trips", "Day trip to Piha beach on Saturday", "Two of us are driving out to Piha and have three spare seats. Leaving the city at 9am and back before dinner. Share petrol, about $10 each.", "Lukas", "Germany", 1.8),
        P(42, "board", "Language exchange", "Can teach Hindi, want to practise Spanish", "I'm a native Hindi speaker learning Spanish. Happy to meet once a week for an hour, half in each language. Any level is fine.", "Priya", "India", 0.9),
        P(43, "board", "Language exchange", "Korean and English conversation partner", "I want to improve my English speaking and can help you with Korean. Cafe on campus or a video call, whatever suits you.", "Jiwoo", "South Korea", 3.4),
        P(44, "board", "Cultural and religious", "Diwali night, everyone welcome", "Lights, sweets and music at our flat common room. Bring a friend and a small plate of food if you can. No need to RSVP.", "Arjun", "India", 2.2),
        P(45, "board", "Cultural and religious", "Friday prayers and lunch group", "A few of us walk to the mosque together on Fridays and have lunch afterwards. New students welcome to join us.", "Farhan", "Malaysia", 5.1, { audienceGender: "men" }),
        P(46, "board", "Sports", "5-a-side this Sunday, need 2 more players", "Casual game at the Domain sports fields, 4pm. Mixed ability, just for fun. Bring water and running shoes.", "Diego", "Chile", 0.7, { sport: "Football (soccer)" }),
        P(47, "board", "Sports", "Looking for a badminton doubles partner", "I play twice a week at the rec centre and my partner just graduated. Intermediate level, happy to split court fees.", "Mei", "Taiwan", 2.9, { sport: "Badminton", audienceGender: "women" }),
        P(48, "board", "Sports", "Gym buddy for early mornings", "Training at the campus gym at 6:30am on weekdays. Looking for someone to keep me motivated. Beginners welcome.", "Tomas", "Brazil", 4.6, { sport: "Gym and fitness" }),
        P(49, "board", "Moving in and out", "Selling a desk and chair before I fly home", "Leaving Auckland at the end of semester. Desk, chair, lamp and a small bookshelf. Pick up from Grafton, cheap for a quick sale.", "Sofie", "Denmark", 1.1),
        P(50, "board", "Moving in and out", "Need help moving boxes on Saturday", "Moving from Mt Albert to the city. About ten boxes and a mattress. I'll pay for pizza and petrol if you have a car.", "Nazia", "Bangladesh", 6.3),
        P(51, "board", "Part-time jobs", "Cafe on Queen Street hiring for weekends", "The cafe I work at needs another barista for Saturday and Sunday mornings. Training given. Ask me for the manager's details.", "Minh", "Vietnam", 1.4),
        P(52, "board", "Part-time jobs", "Campus library is looking for student helpers", "Shelving books and helping at the front desk, around 10 hours a week. Good for students on a visa with work rights.", "Zihou", "China", 3.8),
        P(53, "board", "Discounts and deals", "Student discount at a local gym", "Show your student ID at the gym on Symonds Street for half-price membership in your first month.", "Tomas", "Brazil", 2.6),
        P(54, "board", "Discounts and deals", "Half-price movie tickets on Tuesdays", "Most cinemas in the city have cheap Tuesdays and an extra student price. Worth checking before you book.", "Hana", "Japan", 7.5),
        P(55, "board", "Textbooks and notes", "Selling a circuit analysis textbook", "Used for one semester, no writing inside. Comes with my printed lecture notes for free.", "Arjun", "India", 3.2),
        P(56, "board", "Textbooks and notes", "Swapping first-year accounting notes", "I have neat notes for first-year accounting and want notes for business statistics in return.", "Priya", "India", 5.9),
        P(57, "board", "Tutoring", "Offering maths tutoring", "Third-year maths student. I can help with calculus and algebra for first-year courses. $25 an hour, first session free.", "Lukas", "Germany", 0.8),
        P(58, "board", "Tutoring", "Need help with academic writing", "Looking for someone to check the structure of my essays before I submit them. Happy to pay or swap for help with coding.", "Jiwoo", "South Korea", 4.1),
        P(59, "board", "Rides and transport", "Sharing a ride to the airport", "Flying out on the 20th, leaving the city around 6am. Anyone want to split an Uber? Should be about $25 each.", "Megha", "India", 1.6),
        P(60, "board", "Rides and transport", "Best way to get to the North Shore campus?", "Moving to Albany next semester. Is the Northern Express bus reliable, or is it worth carpooling?", "Diego", "Chile", 6.8),
        P(61, "board", "Lost and found", "Found a student card at the library", "Found near the level 2 printers on Tuesday afternoon. Message me with the name on the card and I'll return it.", "Sofie", "Denmark", 0.3),
        P(62, "board", "Lost and found", "Lost a black umbrella on the Link bus", "Plain black umbrella with a wooden handle. Lost on the Inner Link on Wednesday. It means a lot to me.", "Farhan", "Malaysia", 2.4),
        P(63, "board", "Other", "Anyone want to start a photography walk group?", "I'd like to explore Auckland's street art and parks with a camera. Phone cameras totally fine.", "Megha", "India", 3.5),
        P(30, "market", "Kitchen", "Rice cooker and kettle bundle", "Both work perfectly. Leaving New Zealand in December.", "Lukas", "Germany", 2.4, { price: "$20", condition: "Good", contactMethods: ["mobile"] }),
        P(31, "market", "Bikes & transport", "City bike with lock and helmet", "Gears work well, a few small scratches. Fits riders about 160 to 180 cm tall.", "Megha", "India", 4.2, { price: "$120", condition: "Fair", contactMethods: ["email", "social"] }),
        P(32, "market", "Books & study", "First-year economics textbook", "Some highlighting in the first chapters, otherwise clean. Pick up on campus.", "Nazia", "Bangladesh", 6, { price: "$25", condition: "Good" }),
        P(33, "market", "Furniture", "Study desk and chair", "White desk, 120 cm wide, with a matching chair. Pick up in Newmarket.", "Sofie", "Denmark", 9, { price: "$45", condition: "Good" }),
        P(34, "market", "Electronics", "27-inch monitor with HDMI cable", "Barely used and works perfectly. Great as a second screen for assignments.", "Arjun", "India", 1.5, { price: "$90", condition: "Like new" }),
        P(20, "food", "Tip", "Supermarket markdowns after 7pm", "Bakery and deli items are often reduced near closing time. Look for the yellow stickers.", "Lukas", "Germany", 1, { price: "Up to 50% off" }),
        P(21, "food", "Tip", "Weekend vege market", "Buy a week of fruit and vegetables in one trip. Go near closing time for the best deals.", "Nazia", "Bangladesh", 2, { price: "~$20/week" }),
        P(22, "food", "Tip", "Cook-once, eat-three-times dal", "Lentils, onion, tomato and spices. Freezes well and costs very little per serve.", "Arjun", "India", 4, { price: "~$2/serve" }),
        P(23, "food", "Tip", "Bring your own lunch box", "Most campuses have microwaves in student lounges. Packing lunch can save around $60 a week.", "Mei", "Taiwan", 6, { price: "Free" }),
      ],
      events: [
        { id: 1, title: "International welcome potluck", date: inDays(3), venue: "Albert Park, by the fountain", blurb: "Bring a dish from home and meet other new arrivals from every Auckland campus. Plates and cutlery provided.", hostId: "sample-g7", hostName: "Group 7", paymentStatus: "demo_paid" },
        { id: 2, title: "Sunset walk up Maungawhau / Mt Eden", date: inDays(6), venue: "Meet at the Mt Eden summit car park", blurb: "An easy 30-minute walk to the top for city views at sunset. Wear good shoes and bring a jacket.", hostId: "sample-mei", hostName: "Mei", paymentStatus: "demo_paid" },
        { id: 3, title: "Night market food crawl", date: inDays(9), venue: "Meet at the night market entrance", blurb: "Try street food from a dozen countries for under $20. We will split into small groups so nobody gets lost.", hostId: "sample-s", hostName: "Sathvik", paymentStatus: "demo_paid" },
        { id: 4, title: "Budget grocery walk", date: inDays(12), venue: "Meet outside Britomart station", blurb: "We visit two supermarkets and a vege market and compare prices for a week of meals. Bring a reusable bag.", hostId: "sample-n", hostName: "Nazia", paymentStatus: "demo_paid" },
        { id: 5, title: "Free museum afternoon", date: inDays(13), venue: "Auckland War Memorial Museum, main entrance", blurb: "Entry is free for Auckland residents with ID. We will visit the Māori Court and the volcanoes gallery together.", hostId: "sample-g7", hostName: "Group 7", paymentStatus: "demo_paid" },
      ],
    };
  }
  const load = () => { try { const r = localStorage.getItem(KEY); S = r ? JSON.parse(r) : seed(); } catch { S = seed(); } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage full or blocked: keep in memory */ } };
  const expire = () => { const cutoff = Date.now() - EXPIRY_DAYS * DAY; S.posts = S.posts.filter((p) => p.createdAt > cutoff); };
  const notify = () => listeners.forEach((cb) => setTimeout(cb, 0));
  const me = () => { if (!S.user) throw new Error("Sign in with your student email first."); return S.user; };
  const verified = () => { const u = me(); if (!u.aucklandConfirmed) throw new Error(NOT_CONFIRMED); return u; };
  const wait = () => new Promise((r) => setTimeout(r, 150)); // feels like a network call
  const notifyUser = (userId, n) => {
    if (n.postId && S.notifications.some((x) => x.userId === userId && x.postId === n.postId)) return;
    S.notifications.push({ id: S.nextId++, userId, read: false, createdAt: Date.now(), postId: null, threadId: null, detail: "", ...n });
  };
  const toDataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  load(); expire(); save();

  return {
    mode: "demo",
    async currentUser() { return S.user ? { interests: [], notifyInterests: true, ...S.user, isAdmin: !!S.admin } : null; },
    onAuthChange(cb) { listeners.push(cb); },
    async sendCode(email, { campus } = {}) {
      await wait();
      if (!isStudentEmail(email)) throw new Error(NOT_STUDENT);
      S.pendingCampus = campus || ""; save();
    },
    async verifyCode(email, token) {
      await wait();
      if (SIGNUP_CODE ? token !== SIGNUP_CODE : !/^\d{6,8}$/.test(token)) throw new Error(WRONG_CODE);
      const local = email.split("@")[0];
      const known = (S.accounts || {})[email.toLowerCase()];
      S.user = known || { id: "demo-" + email.toLowerCase(), email: email.toLowerCase(), name: local, country: "",
                 campus: S.pendingCampus || "", aucklandConfirmed: !!S.pendingCampus, interests: [], notifyInterests: true };
      save(); notify();
    },
    async signIn(email, password) {
      await wait();
      const known = (S.accounts || {})[String(email).trim().toLowerCase()];
      if (!SIGNUP_CODE || password !== SIGNUP_CODE || !known) throw new Error(BAD_LOGIN);
      S.user = known; save(); notify();
    },
    async signOut() {
      if (S.user) (S.accounts ||= {})[S.user.email] = S.user; // remembered for "Sign in"
      S.user = null; save(); notify();
    },
    async updateProfile(_id, { name, country, interests, notifyInterests }) {
      const u = me();
      if (name) u.name = name;
      if (country !== undefined) u.country = country;
      if (notifyInterests !== undefined) u.notifyInterests = !!notifyInterests;
      if (interests) {
        // Demo only: sample students "post" in your new interests so the bell has something to show.
        const added = interests.filter((c) => !(u.interests || []).includes(c));
        u.interests = interests;
        if (u.notifyInterests !== false) S.posts
          .filter((p) => p.section === "board" && added.includes(p.category) && p.authorId !== u.id && Date.now() - p.createdAt < 3 * DAY)
          .forEach((p) => notifyUser(u.id, { kind: "post", postId: p.id, title: p.title, detail: p.category, createdAt: p.createdAt }));
      }
      save();
    },
    async confirmAuckland(campus) { const u = me(); u.campus = campus; u.aucklandConfirmed = true; save(); },

    async listPosts(section) { await wait(); expire(); return S.posts.filter((p) => p.section === section).sort((a, b) => b.createdAt - a.createdAt); },
    async createPost(post, photos = []) {
      const u = verified();
      const images = [];
      for (const b of photos.slice(0, 2)) images.push(await toDataUrl(b));
      const row = postRow(post);
      const id = S.nextId++;
      S.posts.push({ id, section: row.section, category: row.category, sport: row.sport || "", title: row.title, body: row.body, price: row.price,
        condition: row.condition, audienceGender: row.audience_gender, audienceSleeper: row.audience_sleeper,
        audienceNote: row.audience_note || "", contactMethods: row.contact_methods, images,
        createdAt: Date.now(), authorId: u.id, authorName: u.name, authorCountry: u.country });
      S.contacts[id] = { post_id: id, ...post.contacts };
      save();
    },
    async deletePost(id) {
      const u = me(), p = S.posts.find((x) => x.id === id);
      if (!p) return;
      if (p.authorId !== u.id && !S.admin) throw new Error("You can only delete your own posts.");
      S.posts = S.posts.filter((x) => x.id !== id); S.reports = S.reports.filter((r) => r.post_id !== id); save();
    },

    async listContactInfo() {
      if (!S.user) return { requests: [], contacts: {} };
      const mine = new Set(S.posts.filter((p) => p.authorId === S.user.id).map((p) => p.id));
      const requests = S.requests.filter((r) => r.requesterId === S.user.id || mine.has(r.postId));
      const approved = new Set(requests.filter((r) => r.requesterId === S.user.id && r.status === "approved").map((r) => r.postId));
      const contacts = {};
      for (const [pid, c] of Object.entries(S.contacts)) if (mine.has(+pid) || approved.has(+pid)) contacts[pid] = c;
      return { requests, contacts };
    },
    async requestContact(postId) {
      const u = verified();
      if (S.requests.some((r) => r.postId === postId && r.requesterId === u.id)) return;
      const p = S.posts.find((x) => x.id === postId);
      // Sample authors aren't real people, so in the demo they "approve" straight away.
      const sample = p && String(p.authorId).startsWith("sample-");
      if (sample && !S.contacts[postId]) {
        const n = p.authorName.toLowerCase(), has = (m) => p.contactMethods.includes(m);
        S.contacts[postId] = { post_id: postId, email: has("email") ? `${n}@aucklanduni.ac.nz` : null,
          mobile: has("mobile") ? "021 000 0000" : null, social: has("social") ? `@${n}.akl` : null };
      }
      S.requests.push({ id: S.nextId++, postId, requesterId: u.id, requesterName: u.name, requesterCountry: u.country, status: sample ? "approved" : "pending" });
      save();
    },
    async answerRequest(id, status) { const r = S.requests.find((x) => x.id === id); if (r) r.status = status; save(); },

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
    async createEvent(ev) { const u = verified(); S.events.push({ ...ev, id: S.nextId++, hostId: u.id, hostName: u.name, paymentStatus: "demo_paid" }); save(); },
    async deleteEvent(id) {
      const u = me(), e = S.events.find((x) => x.id === id);
      if (e && e.hostId !== u.id && !S.admin) throw new Error("You can only delete events you posted.");
      S.events = S.events.filter((x) => x.id !== id); save();
    },

    async listCategoryRequests() {
      const u = S.user;
      return S.categoryRequests.filter((r) => r.status === "approved" || S.admin || (u && r.requestedBy === u.id));
    },
    async requestCategory(name, reason) {
      const u = me();
      S.categoryRequests.push({ id: S.nextId++, name, reason: reason || "", status: "pending", requestedBy: u.id, requesterName: u.name, createdAt: Date.now() });
      save();
    },
    async answerCategoryRequest(id, status) {
      if (!S.admin) throw new Error("Only admins can do that.");
      const r = S.categoryRequests.find((x) => x.id === id);
      if (r && r.status !== status) { r.status = status; notifyUser(r.requestedBy, { kind: "category", title: r.name, detail: status }); }
      save();
    },

    async listNotifications() { return S.user ? S.notifications.filter((n) => n.userId === S.user.id).sort((a, b) => b.createdAt - a.createdAt) : []; },
    async markNotificationsRead() { S.notifications.forEach((n) => { if (S.user && n.userId === S.user.id) n.read = true; }); save(); },
    async clearNotifications() { S.notifications = S.notifications.filter((n) => !S.user || n.userId !== S.user.id); save(); },

    async listThreads() {
      if (!S.user) return [];
      return S.threads.filter((t) => S.admin || t.userId === S.user.id).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async startThread(kind, subject, body) {
      const u = me(), now = Date.now();
      S.threads.push({ id: S.nextId++, kind, subject, status: "open", userId: u.id, userName: u.name, userCountry: u.country,
        updatedAt: now, messages: [{ id: S.nextId++, body, fromAdmin: false, createdAt: now }] });
      save();
    },
    async replyThread(id, body) {
      const u = me(), t = S.threads.find((x) => x.id === id);
      if (!t || (t.userId !== u.id && !S.admin)) throw new Error("Only signed-in students with an accepted student email can do that.");
      const fromAdmin = !!S.admin;
      t.messages.push({ id: S.nextId++, body, fromAdmin, createdAt: Date.now() });
      t.updatedAt = Date.now();
      if (fromAdmin) notifyUser(t.userId, { kind: "reply", threadId: t.id, title: t.subject });
      else t.status = "open";
      save();
    },
    async setThreadStatus(id, status) { const t = S.threads.find((x) => x.id === id); if (t && S.admin) t.status = status; save(); },

    // Demo-only helpers
    setAdmin(on) { S.admin = !!on; save(); },
    reset() { S = seed(); save(); notify(); },
  };
}
