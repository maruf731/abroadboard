// abroadboard UI. All data goes through ./data.js, so this file doesn't care
// whether Supabase is connected (live) or not (demo).

import { createBackend, isStudentEmail, todayISO } from "./data.js";
import { INSTITUTIONS, EXPIRY_DAYS, EVENT_FEE_NZD, PRIVACY_VERSION, PRIVACY_CONTACT } from "./config.js";

const DAY = 864e5;
const CATEGORIES = ["Meetups", "Housing", "Buy & sell", "Study buddies", "Help"]; // Story 7
const VIEWS = ["board", "events", "campus", "food", "join", "privacy"];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  user: null,
  posts: null, food: null, events: null, // null = still loading
  reports: [],
  errors: {},
  filter: "All", query: "",
  confirmDelete: null, // "post:12" or "event:4" while waiting for a second click
  join: { stage: "email", email: "", name: "", country: "", consent: false, error: "", busy: false },
  afterJoin: null,
};

let db;

// ---------------------------------------------------------------- helpers
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.hidden = true), 2800);
}
function timeAgo(ms) {
  const m = Math.round((Date.now() - ms) / 6e4);
  if (m < 60) return m <= 1 ? "just now" : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const daysLeft = (ms) => Math.max(0, Math.ceil((ms + EXPIRY_DAYS * DAY - Date.now()) / DAY));
const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const canDelete = (ownerId) => state.user && (state.user.isAdmin || state.user.id === ownerId);

// ---------------------------------------------------------------- data loading
async function loadAll() {
  await Promise.all([loadPosts(), loadFood(), loadEvents(), loadReports()]);
}
async function run(key, fn) {
  try { state.errors[key] = null; await fn(); }
  catch (e) { state.errors[key] = e.message; }
}
const loadPosts = () => run("posts", async () => { state.posts = await db.listPosts("board"); }).then(renderBoard);
const loadFood = () => run("food", async () => { state.food = await db.listPosts("food"); }).then(renderFood);
const loadEvents = () => run("events", async () => { state.events = await db.listEvents(); }).then(renderEvents);
const loadReports = () => run("reports", async () => { state.reports = await db.listReports(); }).then(renderBoard);

// Name and country typed on the Join form are kept until the student comes back
// from the sign-in link (which may open in a new tab).
const PENDING_KEY = "abroadboard-pending-profile";
function savePending(p) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
async function applyPending(user) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch { /* ignore */ }
  if (!p || !user || p.email.toLowerCase() !== user.email.toLowerCase()) return false;
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  if (!p.name && !p.country) return false;
  await db.updateProfile(user.id, { name: p.name, country: p.country });
  return true;
}

async function refreshUser() {
  state.user = await db.currentUser();
  if (state.user && (await applyPending(state.user).catch(() => false))) state.user = await db.currentUser();
  renderWho(); renderJoin(); renderBoard(); renderEvents(); renderFood();
}

// ---------------------------------------------------------------- header & footer
function renderWho() {
  const w = $("#who");
  if (state.user) {
    w.innerHTML = `<span>Signed in as <b>${esc(state.user.name)}</b></span> <button class="link-btn" id="signout">Sign out</button>`;
    $("#signout").onclick = async () => { await db.signOut(); toast("Signed out"); };
  } else {
    w.innerHTML = `<a class="btn btn-ghost btn-sm" href="#join">Sign in</a>`;
  }
  $("#joinTab").textContent = state.user ? "My account" : "Join";
  $("#adminBadge").innerHTML = state.user?.isAdmin ? '<span class="admin-on">Admin</span>' : "";
  if (db.mode === "demo") {
    $("#adminToggle").hidden = false; $("#resetDemo").hidden = false;
    $("#adminToggle").textContent = state.user?.isAdmin ? "Switch to student view (demo)" : "Switch to admin view (demo)";
  }
}

// ---------------------------------------------------------------- board
function reportInfo(postId) {
  const mine = state.user && state.reports.some((r) => r.post_id === postId && r.reporter_id === state.user.id);
  const total = state.reports.filter((r) => r.post_id === postId).length;
  return { mine, total };
}

function deleteControl(kind, id, ownerId) {
  if (!canDelete(ownerId)) return "";
  const key = `${kind}:${id}`;
  if (state.confirmDelete === key)
    return `<span class="confirm"><button class="btn btn-primary btn-sm" data-del-confirm="${key}">Confirm delete</button><button class="link-btn" data-del-cancel>Cancel</button></span>`;
  return `<button class="btn btn-ghost btn-sm del" data-del="${key}">Delete</button>`;
}

function postCard(p) {
  const left = daysLeft(p.createdAt);
  const { mine, total } = reportInfo(p.id);
  let report;
  if (state.user?.isAdmin && total) report = `<span class="pill alert">Reported ×${total}</span><button class="link-btn" data-clear="${p.id}">Clear reports</button>`;
  else if (mine) report = `<span class="flagged">Reported · admin notified</span>`;
  else report = `<button class="link-btn" data-report="${p.id}">Report</button>`;
  return `<article class="post${state.user?.isAdmin && total ? " is-reported" : ""}">
    <div class="post-head"><span class="tag">${esc(p.category)}</span><span>${esc(p.authorName)}${p.authorCountry ? " · " + esc(p.authorCountry) : ""}</span><span>·</span><span>${timeAgo(p.createdAt)}</span></div>
    <h3>${esc(p.title)}</h3>
    <p class="body">${esc(p.body)}</p>
    <div class="post-foot">
      <span class="contact">${esc(p.contact)}</span><span class="grow"></span>
      <span class="expiry${left <= 3 ? " soon" : ""}">${left <= 1 ? "Expires within a day" : `Expires in ${left} days`}</span>
      ${report}
      ${deleteControl("post", p.id, p.authorId)}
    </div></article>`;
}

// Ad slot (Story 5). Replace the inner HTML with your Google AdSense <ins> tag once approved.
const AD_SLOT = `<div class="ad" role="complementary" aria-label="Advertisement"><div><small>Advertisement</small><strong>Google AdSense slot</strong></div><span class="dim">responsive · 728×90</span></div>`;

function renderBoard() {
  const feed = $("#feedList");
  if (state.errors.posts) { feed.innerHTML = `<div class="error-box"><b>Couldn't load posts.</b> ${esc(state.errors.posts)}</div>`; return; }
  if (!state.posts) return;

  const counts = { All: state.posts.length };
  state.posts.forEach((p) => (counts[p.category] = (counts[p.category] || 0) + 1));
  const cats = ["All", ...CATEGORIES, ...Object.keys(counts).filter((c) => c !== "All" && !CATEGORIES.includes(c))];
  $("#chips").innerHTML = cats.map((c) => `<button class="chip" aria-pressed="${c === state.filter}" data-cat="${esc(c)}">${esc(c)}<span class="n">${counts[c] || 0}</span></button>`).join("");

  const q = state.query.trim().toLowerCase();
  const list = state.posts
    .filter((p) => (state.filter === "All" || p.category === state.filter) && (!q || `${p.title} ${p.body} ${p.category}`.toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt - a.createdAt); // newest first (Story 15)

  feed.innerHTML = list.length
    ? list.map((p, i) => postCard(p) + (i === 2 ? AD_SLOT : "")).join("") + (list.length <= 2 ? AD_SLOT : "")
    : `<div class="empty">${state.posts.length ? "No posts match that. Try another category or search." : "No posts yet. Be the first to post!"}</div>${AD_SLOT}`;

  const soon = state.posts.filter((p) => daysLeft(p.createdAt) <= 3).length;
  const reported = new Set(state.reports.map((r) => r.post_id)).size;
  $("#stats").innerHTML = `<h4>On the board now</h4>
    <div class="stat"><span>Active posts</span><b>${state.posts.length}</b></div>
    <div class="stat"><span>Upcoming events</span><b>${state.events ? state.events.length : "–"}</b></div>
    <div class="stat"><span>Expiring in 3 days</span><b>${soon}</b></div>
    ${state.user?.isAdmin ? `<div class="stat"><span>Reported posts to review</span><b style="color:var(--accent-text)">${reported}</b></div>` : ""}`;
}

// ---------------------------------------------------------------- events
function renderEvents() {
  const box = $("#eventList");
  if (state.errors.events) { box.innerHTML = `<div class="error-box"><b>Couldn't load events.</b> ${esc(state.errors.events)}</div>`; return; }
  if (!state.events) return;
  if (!state.events.length) { box.innerHTML = `<div class="empty">No upcoming events yet. Post the first one.</div>`; return; }
  box.innerHTML = state.events.map((e) => {
    const d = parseDate(e.date);
    const pending = e.paymentStatus === "pending" ? `<span class="pill warn">Waiting for payment</span>` : "";
    const del = deleteControl("event", e.id, e.hostId);
    return `<article class="event"><div class="date"><div class="m">${d.toLocaleString("en-NZ", { month: "short" })}</div><div class="d">${d.getDate()}</div></div>
      <div><h3>${esc(e.title)}</h3><div class="meta">${d.toLocaleString("en-NZ", { weekday: "long" })} · ${esc(e.venue)} · hosted by ${esc(e.hostName)}</div><p>${esc(e.blurb)}</p>
      ${pending || del ? `<div class="foot">${pending}${del}</div>` : ""}</div></article>`;
  }).join("");
  if (state.posts) renderBoard(); // keeps the event count in the sidebar current
}

// ---------------------------------------------------------------- food
function renderFood() {
  const box = $("#foodList");
  if (state.errors.food) { box.innerHTML = `<div class="error-box"><b>Couldn't load tips.</b> ${esc(state.errors.food)}</div>`; return; }
  if (!state.food) return;
  if (!state.food.length) { box.innerHTML = `<div class="empty">No tips yet. Share the first one.</div>`; return; }
  box.innerHTML = state.food.map((f) => `<article class="post">
    <div class="post-head"><span class="tag">Tip</span><span>${esc(f.authorName)} · ${timeAgo(f.createdAt)}</span></div>
    <h3>${esc(f.title)}</h3><p class="body">${esc(f.body)}</p>
    <div class="post-foot"><span class="price">${esc(f.price || "")}</span><span class="grow"></span>${deleteControl("post", f.id, f.authorId)}</div></article>`).join("");
}

// ---------------------------------------------------------------- privacy notice
const privacyContact = () => PRIVACY_CONTACT
  ? `email <a href="mailto:${esc(PRIVACY_CONTACT)}">${esc(PRIVACY_CONTACT)}</a>`
  : "contact the abroadboard admins";

function privacyNotice() {
  return `<h3>What we collect</h3>
    <ul>
      <li>Your student email address, used only to sign you in and to check that you study at an accepted Auckland institution.</li>
      <li>The display name you choose and, if you add it, your home country. Both appear on your posts.</li>
      <li>What you post: board posts, food tips, events and reports, including any contact details you type into a post.</li>
    </ul>
    <h3>Who can see it</h3>
    <ul>
      <li>Posts, events, your display name and home country are public on this site.</li>
      <li>Your email address is never shown publicly unless you put it in a post's contact field.</li>
      <li>Reports are seen only by you and the site admins.</li>
    </ul>
    <h3>Where it's kept and for how long</h3>
    <ul>
      <li>Data is stored with Supabase in its Seoul, South Korea region. The site is hosted by Vercel.</li>
      <li>Posts are deleted automatically after ${EXPIRY_DAYS} days, and events about a week after they happen.</li>
      <li>Your account stays until you ask us to delete it.</li>
    </ul>
    <h3>Your rights</h3>
    <p>Under the New Zealand Privacy Act 2020 you can ask to see, correct or delete your information at any time. To do that, ${privacyContact()}. We don't sell your data or use it for advertising profiles.</p>
    <p class="muted">Notice version ${esc(PRIVACY_VERSION)}</p>`;
}

const institutionList = () => `<details class="domains"><summary>Accepted student emails (${INSTITUTIONS.length} institutions)</summary><ul>${
  INSTITUTIONS.map((i) => `<li><b>${esc(i.name)}</b> <span>${i.domains.map((d) => "@" + esc(d)).join(" or ")}</span></li>`).join("")
}</ul></details>`;

// ---------------------------------------------------------------- join / account (Story 6)
function renderJoin() {
  const box = $("#joinBox"), j = state.join;
  if (state.user) {
    box.innerHTML = `<h1>Your account</h1><p>Signed in as <b>${esc(state.user.email)}</b>${state.user.isAdmin ? " (admin)" : ""}. This name shows on your posts.</p>
      <form id="profileForm" novalidate>
        <div class="row2">
          <div class="field"><label for="pName">Display name</label><input id="pName" maxlength="40" value="${esc(state.user.name)}"></div>
          <div class="field"><label for="pCountry">Home country</label><input id="pCountry" maxlength="40" value="${esc(state.user.country)}" placeholder="Optional"></div>
        </div>
        <div class="actions"><button class="btn btn-ghost" type="button" id="signout2">Sign out</button><button class="btn btn-primary" type="submit">Save</button></div>
      </form>`;
    $("#signout2").onclick = async () => { await db.signOut(); toast("Signed out"); };
    $("#profileForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await db.updateProfile(state.user.id, { name: $("#pName").value.trim(), country: $("#pCountry").value.trim() });
        await refreshUser(); loadPosts(); loadFood(); toast("Saved");
      } catch (err) { toast(err.message); }
    };
    return;
  }

  if (j.stage === "email") {
    box.innerHTML = `<h1>Join abroadboard</h1><p>Use your student email from an Auckland university or college. We'll email you a sign-in link, so there's no password to remember.</p>
      <form id="joinForm" novalidate>
        <div class="field"><label for="jEmail">Student email</label><input id="jEmail" type="email" autocomplete="email" placeholder="you@aucklanduni.ac.nz" value="${esc(j.email)}">
          ${institutionList()}</div>
        <div class="row2">
          <div class="field"><label for="jName">Display name</label><input id="jName" maxlength="40" placeholder="e.g. Mei" value="${esc(j.name)}"></div>
          <div class="field"><label for="jCountry">Home country</label><input id="jCountry" maxlength="40" placeholder="Optional" value="${esc(j.country)}"></div>
        </div>
        <div class="privacy-box" id="privacyBox"><h2>Privacy notice</h2>${privacyNotice()}</div>
        <label class="consent"><input type="checkbox" id="jConsent" ${j.consent ? "checked" : ""}>
          <span>I have read the privacy notice and agree to abroadboard collecting and using my information as described.</span></label>
        ${j.error ? `<p class="err">${esc(j.error)}</p>` : ""}
        <div class="actions"><button class="btn btn-primary" type="submit" id="jSubmit" ${j.busy || !j.consent ? "disabled" : ""}>${j.busy ? "Sending…" : "I agree, send my sign-in link"}</button></div>
      </form>`;
    $("#jConsent").onchange = (e) => { j.consent = e.target.checked; $("#jSubmit").disabled = j.busy || !j.consent; };
    $("#joinForm").onsubmit = async (e) => {
      e.preventDefault();
      Object.assign(j, { email: $("#jEmail").value.trim(), name: $("#jName").value.trim(), country: $("#jCountry").value.trim(), consent: $("#jConsent").checked, error: "" });
      if (!isStudentEmail(j.email)) { j.error = "That email isn't from an accepted institution. Open the list under the email box to see which addresses work."; renderJoin(); $("#jEmail").focus(); return; }
      if (!j.consent) { j.error = "Tick the box to agree to the privacy notice before joining."; renderJoin(); $("#jConsent").focus(); return; }
      j.busy = true; renderJoin();
      savePending({ email: j.email, name: j.name, country: j.country });
      try { await db.sendCode(j.email); j.stage = "code"; }
      catch (err) { j.error = err.message; }
      j.busy = false; renderJoin();
      $(j.stage === "code" ? "#jCode" : "#jEmail")?.focus();
    };
  } else {
    const intro = db.mode === "demo"
      ? `We sent a 6-digit code to <b>${esc(j.email)}</b>. <br><span class='muted'>Demo mode: any 6 digits will work.</span>`
      : `We sent an email to <b>${esc(j.email)}</b>. <b>Open it and click the sign-in link</b>, and you'll come back here signed in. It can take a minute and may land in junk mail.`;
    box.innerHTML = `<h1>Check your inbox</h1><p>${intro}</p>
      <form id="codeForm" novalidate>
        <div class="field"><label for="jCode">${db.mode === "demo" ? "Verification code" : "Got a 6-digit code instead? Enter it here"}</label><input id="jCode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code"></div>
        ${j.error ? `<p class="err">${esc(j.error)}</p>` : ""}
        <div class="actions"><button class="btn btn-ghost" type="button" id="jBack">Use a different email</button><button class="btn btn-primary" type="submit" ${j.busy ? "disabled" : ""}>${j.busy ? "Checking…" : "Verify and join"}</button></div>
      </form>`;
    $("#jBack").onclick = () => { j.stage = "email"; j.error = ""; renderJoin(); };
    $("#codeForm").onsubmit = async (e) => {
      e.preventDefault();
      const code = $("#jCode").value.trim();
      if (!/^\d{6}$/.test(code)) { j.error = "Enter the 6-digit code from the email."; renderJoin(); $("#jCode").focus(); return; }
      j.busy = true; j.error = ""; renderJoin();
      try {
        await db.verifyCode(j.email, code);
        const u = await db.currentUser();
        if (u && (j.name || j.country)) await db.updateProfile(u.id, { name: j.name, country: j.country });
        state.join = { stage: "email", email: "", name: "", country: "", consent: false, error: "", busy: false };
        await refreshUser(); loadReports();
        toast("Email verified. Welcome to abroadboard!");
        const next = state.afterJoin; state.afterJoin = null;
        if (next) { location.hash = "#" + next.view; setTimeout(() => openDialog(next.kind), 60); }
        else location.hash = "#board";
      } catch (err) { j.busy = false; j.error = err.message; renderJoin(); }
    };
  }
}

// ---------------------------------------------------------------- create dialogs (Stories 2, 4, 7, 16, 18)
const dlg = $("#dlg"), form = $("#dlgForm");
const field = (id, label, input, hint = "") => `<div class="field"><label for="${id}">${label}</label>${input}${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;

function openDialog(kind) {
  if (!state.user) {
    state.afterJoin = { kind, view: kind === "post" ? "board" : kind === "event" ? "events" : "food" };
    location.hash = "#join";
    toast("Sign in with your student email to post");
    return;
  }
  let html;
  if (kind === "post") {
    html = `<h2>New post</h2>
      <div class="guide"><b>What to include:</b> what you're looking for, when and where, and the best way to reach you. Never share your home address or passport details.</div>
      ${field("fTitle", "Title", `<input id="fTitle" maxlength="120" placeholder="e.g. Looking for badminton partners">`)}
      <div class="row2">${field("fCat", "Category", `<select id="fCat">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}<option value="__custom">Other…</option></select>`)}
      ${field("fCustom", "Custom category", `<input id="fCustom" maxlength="30" placeholder="e.g. Sports" disabled>`)}</div>
      ${field("fBody", "Details", `<textarea id="fBody" maxlength="2000"></textarea>`)}
      ${field("fContact", "How to contact you", `<input id="fContact" maxlength="120" value="${esc(state.user.email)}">`, "Shown publicly on your post")}`;
  } else if (kind === "event") {
    html = `<h2>Post an event</h2>
      ${field("fTitle", "Event name", `<input id="fTitle" maxlength="80">`)}
      <div class="row2">${field("fDate", "Date", `<input id="fDate" type="date" min="${todayISO()}">`)}${field("fVenue", "Where", `<input id="fVenue" maxlength="80">`)}</div>
      ${field("fBody", "Short description", `<textarea id="fBody" maxlength="400" style="min-height:80px"></textarea>`)}
      <div class="checkout"><div class="line"><span>Event listing</span><span>$${EVENT_FEE_NZD.toFixed(2)}</span></div><div class="line total"><span>Total (NZD)</span><span>$${EVENT_FEE_NZD.toFixed(2)}</span></div>
      <p style="margin-top:8px;color:var(--muted);font-size:13px">Test payment: no money is taken yet. Stripe (test mode) can be connected in a later sprint.</p></div>`;
  } else {
    html = `<h2>Share a food tip</h2>
      ${field("fTitle", "Place or idea", `<input id="fTitle" maxlength="120" placeholder="e.g. $6 bento near the Quad">`)}
      ${field("fBody", "Why it's good", `<textarea id="fBody" maxlength="2000" style="min-height:80px"></textarea>`)}
      ${field("fPrice", "Rough cost", `<input id="fPrice" maxlength="30" placeholder="e.g. ~$8">`)}`;
  }
  form.innerHTML = html + `<p class="err" id="fErr" hidden></p><div class="actions"><button class="btn btn-ghost" type="button" id="fCancel">Cancel</button><button class="btn btn-primary" type="submit" id="fSubmit">${kind === "event" ? `Pay $${EVENT_FEE_NZD} and publish` : "Publish"}</button></div>`;
  form.dataset.kind = kind;
  $("#fCancel").onclick = () => dlg.close();
  const cat = $("#fCat");
  if (cat) cat.onchange = () => { const c = $("#fCustom"); c.disabled = cat.value !== "__custom"; if (!c.disabled) c.focus(); };
  dlg.showModal();
  $("#fTitle").focus();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const kind = form.dataset.kind, v = (id) => ($(id)?.value || "").trim(), err = $("#fErr");
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  const required = kind === "event" ? ["#fTitle", "#fDate", "#fVenue", "#fBody"] : ["#fTitle", "#fBody"];
  if (required.some((id) => !v(id))) return fail("Fill in every field before publishing.");

  const btn = $("#fSubmit"); btn.disabled = true;
  try {
    if (kind === "post") {
      let category = v("#fCat");
      if (category === "__custom") { category = v("#fCustom"); if (!category) { btn.disabled = false; return fail("Type a custom category or pick one from the list."); } }
      await db.createPost({ section: "board", category, title: v("#fTitle"), body: v("#fBody"), contact: v("#fContact") || state.user.email });
      state.filter = "All"; dlg.close(); toast("Published to the board"); loadPosts();
    } else if (kind === "event") {
      if (v("#fDate") < todayISO()) { btn.disabled = false; return fail("Pick today or a date in the future."); }
      await db.createEvent({ title: v("#fTitle"), date: v("#fDate"), venue: v("#fVenue"), blurb: v("#fBody") });
      dlg.close(); toast("Event published"); loadEvents();
    } else {
      await db.createPost({ section: "food", category: "Tip", title: v("#fTitle"), body: v("#fBody"), price: v("#fPrice") });
      dlg.close(); toast("Tip shared"); loadFood();
    }
  } catch (ex) { btn.disabled = false; fail(ex.message); }
});

// ---------------------------------------------------------------- clicks
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-cat],[data-report],[data-clear],[data-del],[data-del-confirm],[data-del-cancel],[data-new]");
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.cat !== undefined) { state.filter = d.cat; renderBoard(); }
    else if (d.new) openDialog(d.new);
    else if (d.report) {
      if (!state.user) { location.hash = "#join"; toast("Sign in to report a post"); return; }
      await db.reportPost(Number(d.report)); await loadReports(); toast("Thanks. An admin will review this post.");
    }
    else if (d.clear) { await db.clearReports(Number(d.clear)); await loadReports(); toast("Reports cleared"); }
    else if (d.del) { state.confirmDelete = d.del; rerenderLists(); }
    else if (d.delCancel !== undefined) { state.confirmDelete = null; rerenderLists(); }
    else if (d.delConfirm) {
      const [kind, id] = d.delConfirm.split(":");
      state.confirmDelete = null;
      if (kind === "event") { await db.deleteEvent(Number(id)); await loadEvents(); }
      else { await db.deletePost(Number(id)); await Promise.all([loadPosts(), loadFood(), loadReports()]); }
      toast("Deleted");
    }
  } catch (ex) { state.confirmDelete = null; rerenderLists(); toast(ex.message); }
});
const rerenderLists = () => { renderBoard(); renderEvents(); renderFood(); };

$("#q").addEventListener("input", (e) => { state.query = e.target.value; renderBoard(); });

// ---------------------------------------------------------------- routing
function route() {
  const v = location.hash.slice(1);
  const view = VIEWS.includes(v) ? v : "board";
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "view-" + view));
  document.querySelectorAll("nav.tabs a").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

// ---------------------------------------------------------------- start
async function start() {
  route();
  $("#privacyPage").innerHTML = privacyNotice();
  try { db = await createBackend(); }
  catch (e) {
    $("#feedList").innerHTML = `<div class="error-box"><b>The site couldn't start.</b> ${esc(e.message)}</div>`;
    return;
  }
  if (db.mode === "demo") {
    $("#modeBar").hidden = false;
    $("#adminToggle").onclick = async () => {
      if (!state.user) { location.hash = "#join"; toast("Sign in first, then switch to admin view"); return; }
      db.setAdmin(!state.user?.isAdmin); await refreshUser(); await loadReports(); toast(state.user?.isAdmin ? "Admin view on" : "Student view"); };
    $("#resetDemo").onclick = async () => { db.reset(); state.filter = "All"; toast("Demo data reset"); await loadAll(); };
  }
  db.onAuthChange(async () => { await refreshUser(); loadReports(); });
  await refreshUser();
  await loadAll();
}
start();
