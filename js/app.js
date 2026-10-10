// abroadboard UI. All data goes through ./data.js, so this file doesn't care
// whether Supabase is connected (live) or not (demo).

import { createBackend, isStudentEmail, todayISO } from "./data.js";
import { INSTITUTIONS, CAMPUSES, MAX_PHOTOS, MAX_PHOTO_MB, EXPIRY_DAYS, EVENT_FEE_NZD, PRIVACY_VERSION, PRIVACY_CONTACT, SIGNUP_CODE } from "./config.js";
import { t, getLang, setLang, locale, applyStatic } from "./i18n.js";

const DAY = 864e5;
const CATEGORIES = ["Meetups", "Housing", "Study buddies", "Help"]; // Story 7
const MARKET_CATEGORIES = ["Furniture", "Electronics", "Books & study", "Kitchen", "Clothing", "Bikes & transport", "Other"];
const CONDITIONS = ["New", "Like new", "Good", "Fair"];
// Who a post is meant for. Stored as the key; shown as the label.
const GENDERS = { any: "Anyone", women: "Women", men: "Men", nonbinary: "Non-binary people" };
const SLEEPERS = { any: "Any", light: "Light sleepers", heavy: "Heavy sleepers" };
const METHODS = { email: "Email", mobile: "Mobile", social: "Social media" };
const VIEWS = ["board", "market", "events", "campus", "food", "faq", "join", "privacy"];
const NOT_CONFIRMED = "Confirm that you study in Auckland (on your account page) before posting.";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const freshJoin = () => ({ stage: "email", email: "", name: "", country: "", campus: "", auckland: false, consent: false, error: "", busy: false });
const state = {
  user: null,
  posts: null, market: null, food: null, events: null, // null = still loading
  reports: [],
  contactInfo: { requests: [], contacts: {} },
  errors: {},
  filter: "All", query: "",
  marketFilter: "All", marketQuery: "",
  confirmDelete: null, // "post:12" or "event:4" while waiting for a second click
  join: freshJoin(),
  afterJoin: null,
  photos: [], // [{ blob, url }] picked in the open dialog
};

let db;

// ---------------------------------------------------------------- helpers
function toast(msg) {
  const el = $("#toast");
  el.textContent = t(msg); el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (el.hidden = true), 2800);
}
function timeAgo(ms) {
  const m = Math.round((Date.now() - ms) / 6e4);
  if (m < 60) return m <= 1 ? t("just now") : t("{n} min ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n} h ago", { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? t("yesterday") : t("{n} days ago", { n: d });
}
const daysLeft = (ms) => Math.max(0, Math.ceil((ms + EXPIRY_DAYS * DAY - Date.now()) / DAY));
const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const canDelete = (ownerId) => state.user && (state.user.isAdmin || state.user.id === ownerId);
const isMine = (p) => state.user && state.user.id === p.authorId;
const allPosts = () => [...(state.posts || []), ...(state.market || []), ...(state.food || [])];

// Images fade in once loaded (see img.ph in styles.css).
document.addEventListener("load", (e) => { if (e.target.matches?.("img.ph")) e.target.classList.add("loaded"); }, true);
document.addEventListener("error", (e) => { if (e.target.matches?.("img.ph")) e.target.classList.add("loaded", "broken"); }, true);
const markLoaded = (root) => root.querySelectorAll("img.ph").forEach((i) => i.complete && i.naturalWidth && i.classList.add("loaded"));

// ---------------------------------------------------------------- data loading
async function loadAll() {
  await Promise.all([loadPosts(), loadMarket(), loadFood(), loadEvents(), loadReports(), loadContacts()]);
}
async function run(key, fn) {
  try { state.errors[key] = null; await fn(); }
  catch (e) { state.errors[key] = e.message; }
}
const loadPosts = () => run("posts", async () => { state.posts = await db.listPosts("board"); }).then(renderBoard);
const loadMarket = () => run("market", async () => { state.market = await db.listPosts("market"); }).then(renderMarket);
const loadFood = () => run("food", async () => { state.food = await db.listPosts("food"); }).then(renderFood);
const loadEvents = () => run("events", async () => { state.events = await db.listEvents(); }).then(renderEvents);
const loadReports = () => run("reports", async () => { state.reports = await db.listReports(); }).then(renderBoard);
const loadContacts = () => run("contacts", async () => { state.contactInfo = await db.listContactInfo(); })
  .then(() => { renderBoard(); renderMarket(); });

// Name, country and campus typed on the Join form are kept until the student
// comes back signed in (they may use the link in the email instead of the code).
const PENDING_KEY = "abroadboard-pending-profile";
function savePending(p) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
async function applyPending(user) {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch { /* ignore */ }
  if (!p || !user || p.email.toLowerCase() !== user.email.toLowerCase()) return false;
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  let changed = false;
  if (p.name || p.country) { await db.updateProfile(user.id, { name: p.name, country: p.country }); changed = true; }
  if (p.campus && !user.aucklandConfirmed) { await db.confirmAuckland(p.campus); changed = true; }
  return changed;
}

async function refreshUser() {
  state.user = await db.currentUser();
  if (state.user && (await applyPending(state.user).catch(() => false))) state.user = await db.currentUser();
  renderWho(); renderJoin(); rerenderLists();
}

// ---------------------------------------------------------------- header & footer
function renderWho() {
  const w = $("#who");
  if (state.user) {
    w.innerHTML = `<span>${t("Signed in as <b>{name}</b>", { name: esc(state.user.name) })}</span> <button class="link-btn" id="signout">${t("Sign out")}</button>`;
    $("#signout").onclick = async () => { await db.signOut(); toast("Signed out"); };
  } else {
    w.innerHTML = `<a class="btn btn-ghost btn-sm" href="#join">${t("Sign in")}</a>`;
  }
  $("#joinTab").textContent = t(state.user ? "My account" : "Join");
  $("#adminBadge").innerHTML = state.user?.isAdmin ? `<span class="admin-on">${t("Admin")}</span>` : "";
  if (db.mode === "demo") {
    $("#adminToggle").hidden = false; $("#resetDemo").hidden = false;
    $("#adminToggle").textContent = t(state.user?.isAdmin ? "Switch to student view (demo)" : "Switch to admin view (demo)");
    $("#resetDemo").textContent = t("Reset demo data");
  }
}

// ---------------------------------------------------------------- post pieces
function reportInfo(postId) {
  const mine = state.user && state.reports.some((r) => r.post_id === postId && r.reporter_id === state.user.id);
  const total = state.reports.filter((r) => r.post_id === postId).length;
  return { mine, total };
}

function deleteControl(kind, id, ownerId) {
  if (!canDelete(ownerId)) return "";
  const key = `${kind}:${id}`;
  if (state.confirmDelete === key)
    return `<span class="confirm"><button class="btn btn-primary btn-sm" data-del-confirm="${key}">${t("Confirm delete")}</button><button class="link-btn" data-del-cancel>${t("Cancel")}</button></span>`;
  return `<button class="btn btn-ghost btn-sm del" data-del="${key}">${t("Delete")}</button>`;
}

function reportControl(p) {
  const { mine, total } = reportInfo(p.id);
  if (state.user?.isAdmin && total) return `<span class="pill alert">${t("Reported ×{n}", { n: total })}</span><button class="link-btn" data-clear="${p.id}">${t("Clear reports")}</button>`;
  if (mine) return `<span class="flagged">${t("Reported · admin notified")}</span>`;
  if (isMine(p)) return "";
  return `<button class="link-btn" data-report="${p.id}">${t("Report")}</button>`;
}

function expiry(p) {
  const left = daysLeft(p.createdAt);
  return `<span class="expiry${left <= 3 ? " soon" : ""}">${left <= 1 ? t("Expires within a day") : t("Expires in {n} days", { n: left })}</span>`;
}

// "For: Women · Light sleepers · Non-smoker"
function audienceChips(p) {
  const bits = [];
  if (p.audienceGender && p.audienceGender !== "any") bits.push(t(GENDERS[p.audienceGender] || p.audienceGender));
  if (p.audienceSleeper && p.audienceSleeper !== "any") bits.push(t(SLEEPERS[p.audienceSleeper] || p.audienceSleeper));
  if (p.audienceNote) bits.push(esc(p.audienceNote));
  if (!bits.length) return "";
  return `<div class="audience"><span class="lbl">${t("For:")}</span>${bits.map((b) => `<span class="pill soft">${b}</span>`).join("")}</div>`;
}

function photos(p) {
  if (!p.images?.length) return "";
  return `<div class="photos n${p.images.length}">${p.images.map((src, i) =>
    `<button type="button" class="photo" data-photo="${p.id}:${i}" aria-label="${t("Open photo {n}", { n: i + 1 })}"><img class="ph" src="${esc(src)}" alt="" loading="lazy" decoding="async"></button>`).join("")}</div>`;
}

function revealed(c) {
  const rows = [];
  if (c.email) rows.push(`<li><span>${t("Email")}</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`);
  if (c.mobile) rows.push(`<li><span>${t("Mobile")}</span><a href="tel:${esc(c.mobile.replace(/[^\d+]/g, ""))}">${esc(c.mobile)}</a></li>`);
  if (c.social) rows.push(`<li><span>${t("Social media")}</span><b>${esc(c.social)}</b></li>`);
  return `<ul class="revealed">${rows.join("")}</ul>`;
}

// Contact details are hidden. Others ask for them; the author decides who sees them.
function contactBlock(p) {
  const methods = p.contactMethods || [];
  if (!methods.length) return p.contact ? `<div class="contact-row"><span class="contact">${esc(p.contact)}</span></div>` : "";
  const how = `<span class="methods">${t("Contact by:")} ${methods.map((m) => t(METHODS[m] || m)).join(" · ")}</span>`;
  const { requests, contacts } = state.contactInfo;
  const c = contacts[p.id];

  if (isMine(p)) {
    const reqs = requests.filter((r) => r.postId === p.id);
    const pending = reqs.filter((r) => r.status === "pending");
    const shared = reqs.filter((r) => r.status === "approved").length;
    return `<div class="contact-row mine">${how}
      ${pending.length ? `<ul class="requests">${pending.map((r) => `<li class="req"><span>${t("<b>{name}</b> asked for your contact details", { name: esc(r.requesterName) + (r.requesterCountry ? " · " + esc(r.requesterCountry) : "") })}</span>
        <span class="req-btns"><button class="btn btn-primary btn-sm" data-answer="${r.id}:approved">${t("Share")}</button><button class="btn btn-ghost btn-sm" data-answer="${r.id}:declined">${t("Decline")}</button></span></li>`).join("")}</ul>`
        : `<span class="muted small">${shared ? (shared === 1 ? t("Shared with 1 person") : t("Shared with {n} people", { n: shared })) : t("No requests yet. Your details stay hidden until you share them.")}</span>`}
    </div>`;
  }
  if (!state.user) return `<div class="contact-row">${how}<button class="btn btn-ghost btn-sm" data-request="${p.id}">${t("Sign in to request contact details")}</button></div>`;

  const mine = requests.find((r) => r.postId === p.id && r.requesterId === state.user.id);
  if (c && (mine?.status === "approved" || state.user.isAdmin)) return `<div class="contact-row">${how}${revealed(c)}</div>`;
  if (mine?.status === "pending") return `<div class="contact-row">${how}<span class="pill warn">${t("Request sent. Waiting for {name} to share.", { name: esc(p.authorName) })}</span></div>`;
  if (mine?.status === "declined") return `<div class="contact-row">${how}<span class="muted small">${t("{name} didn't share their details for this post.", { name: esc(p.authorName) })}</span></div>`;
  return `<div class="contact-row">${how}<button class="btn btn-ghost btn-sm" data-request="${p.id}">${t("Request contact details")}</button></div>`;
}

const byline = (p) => `<span>${esc(p.authorName)}${p.authorCountry ? " · " + esc(p.authorCountry) : ""}</span><span>·</span><span>${timeAgo(p.createdAt)}</span>`;

function postCard(p) {
  const { total } = reportInfo(p.id);
  return `<article class="post${state.user?.isAdmin && total ? " is-reported" : ""}">
    <div class="post-head"><span class="tag">${esc(t(p.category))}</span>${byline(p)}</div>
    <h3>${esc(p.title)}</h3>
    <p class="body">${esc(p.body)}</p>
    ${photos(p)}
    ${audienceChips(p)}
    ${contactBlock(p)}
    <div class="post-foot"><span class="grow"></span>${expiry(p)}${reportControl(p)}${deleteControl("post", p.id, p.authorId)}</div>
  </article>`;
}

function listingCard(p) {
  const { total } = reportInfo(p.id);
  const img = p.images || [];
  const cover = img.length
    ? `<button type="button" class="cover" data-photo="${p.id}:0" aria-label="${t("Open photo {n}", { n: 1 })}"><img class="ph" src="${esc(img[0])}" alt="" loading="lazy" decoding="async">${img.length > 1 ? `<span class="more-photos">+${img.length - 1}</span>` : ""}</button>`
    : `<div class="cover empty-cover" aria-hidden="true"><span class="dot"></span></div>`;
  return `<article class="listing${state.user?.isAdmin && total ? " is-reported" : ""}">
    ${cover}
    <div class="listing-body">
      <div class="price-row"><span class="price">${esc(p.price || t("Ask"))}</span>${p.condition ? `<span class="pill soft">${esc(t(p.condition))}</span>` : ""}</div>
      <h3>${esc(p.title)}</h3>
      <div class="post-head"><span class="tag">${esc(t(p.category))}</span>${byline(p)}</div>
      <p class="body">${esc(p.body)}</p>
      ${audienceChips(p)}
      ${contactBlock(p)}
      <div class="post-foot"><span class="grow"></span>${expiry(p)}${reportControl(p)}${deleteControl("post", p.id, p.authorId)}</div>
    </div>
  </article>`;
}

function chipsFor(list, base, current) {
  const counts = { All: list.length };
  list.forEach((p) => (counts[p.category] = (counts[p.category] || 0) + 1));
  const cats = ["All", ...base, ...Object.keys(counts).filter((c) => c !== "All" && !base.includes(c))];
  return cats.map((c) => `<button class="chip" aria-pressed="${c === current}" data-cat="${esc(c)}">${esc(t(c))}<span class="n">${counts[c] || 0}</span></button>`).join("");
}
const matches = (p, filter, query) => {
  const q = query.trim().toLowerCase();
  return (filter === "All" || p.category === filter) &&
    (!q || `${p.title} ${p.body} ${p.category} ${p.audienceNote || ""}`.toLowerCase().includes(q));
};

// Ad slot (Story 5). Replace the inner HTML with your Google AdSense <ins> tag once approved.
const AD_SLOT = () => `<div class="ad" role="complementary" aria-label="${t("Advertisement")}"><div><small>${t("Advertisement")}</small><strong>${t("Google AdSense slot")}</strong></div><span class="dim">responsive · 728×90</span></div>`;

// ---------------------------------------------------------------- board
function renderBoard() {
  const feed = $("#feedList");
  if (state.errors.posts) { feed.innerHTML = `<div class="error-box"><b>${t("Couldn't load posts.")}</b> ${esc(t(state.errors.posts))}</div>`; return; }
  if (!state.posts) return;

  $("#chips").innerHTML = chipsFor(state.posts, CATEGORIES, state.filter);
  const list = state.posts.filter((p) => matches(p, state.filter, state.query)).sort((a, b) => b.createdAt - a.createdAt); // newest first (Story 15)

  feed.innerHTML = list.length
    ? list.map((p, i) => postCard(p) + (i === 2 ? AD_SLOT() : "")).join("") + (list.length <= 2 ? AD_SLOT() : "")
    : `<div class="empty">${t(state.posts.length ? "No posts match that. Try another category or search." : "No posts yet. Be the first to post!")}</div>${AD_SLOT()}`;
  markLoaded(feed);

  const soon = state.posts.filter((p) => daysLeft(p.createdAt) <= 3).length;
  const reported = new Set(state.reports.map((r) => r.post_id)).size;
  $("#stats").innerHTML = `<h4>${t("On the board now")}</h4>
    <div class="stat"><span>${t("Active posts")}</span><b>${state.posts.length}</b></div>
    <div class="stat"><span>${t("Items for sale")}</span><b>${state.market ? state.market.length : "–"}</b></div>
    <div class="stat"><span>${t("Upcoming events")}</span><b>${state.events ? state.events.length : "–"}</b></div>
    <div class="stat"><span>${t("Expiring in 3 days")}</span><b>${soon}</b></div>
    ${state.user?.isAdmin ? `<div class="stat"><span>${t("Reported posts to review")}</span><b style="color:var(--accent-text)">${reported}</b></div>` : ""}`;
}

// ---------------------------------------------------------------- Buy and Sell
function renderMarket() {
  const box = $("#marketList");
  if (state.errors.market) { box.innerHTML = `<div class="error-box"><b>${t("Couldn't load listings.")}</b> ${esc(t(state.errors.market))}</div>`; return; }
  if (!state.market) return;
  $("#marketChips").innerHTML = chipsFor(state.market, MARKET_CATEGORIES, state.marketFilter);
  const list = state.market.filter((p) => matches(p, state.marketFilter, state.marketQuery)).sort((a, b) => b.createdAt - a.createdAt);
  box.innerHTML = list.length
    ? list.map(listingCard).join("")
    : `<div class="empty">${t(state.market.length ? "Nothing matches that. Try another category or search." : "Nothing for sale yet. List the first item!")}</div>`;
  markLoaded(box);
  if (state.posts) renderBoard(); // keeps the sidebar count current
}

// ---------------------------------------------------------------- events
function renderEvents() {
  const box = $("#eventList");
  if (state.errors.events) { box.innerHTML = `<div class="error-box"><b>${t("Couldn't load events.")}</b> ${esc(t(state.errors.events))}</div>`; return; }
  if (!state.events) return;
  if (!state.events.length) { box.innerHTML = `<div class="empty">${t("No upcoming events yet. Post the first one.")}</div>`; return; }
  box.innerHTML = state.events.map((e) => {
    const d = parseDate(e.date);
    const pending = e.paymentStatus === "pending" ? `<span class="pill warn">${t("Waiting for payment")}</span>` : "";
    const del = deleteControl("event", e.id, e.hostId);
    return `<article class="event"><div class="date"><div class="m">${d.toLocaleString(locale(), { month: "short" })}</div><div class="d">${d.getDate()}</div></div>
      <div><h3>${esc(e.title)}</h3><div class="meta">${d.toLocaleString(locale(), { weekday: "long" })} · ${esc(e.venue)} · ${t("hosted by {name}", { name: esc(e.hostName) })}</div><p>${esc(e.blurb)}</p>
      ${pending || del ? `<div class="foot">${pending}${del}</div>` : ""}</div></article>`;
  }).join("");
  if (state.posts) renderBoard(); // keeps the event count in the sidebar current
}

// ---------------------------------------------------------------- food
function renderFood() {
  const box = $("#foodList");
  if (state.errors.food) { box.innerHTML = `<div class="error-box"><b>${t("Couldn't load tips.")}</b> ${esc(t(state.errors.food))}</div>`; return; }
  if (!state.food) return;
  if (!state.food.length) { box.innerHTML = `<div class="empty">${t("No tips yet. Share the first one.")}</div>`; return; }
  box.innerHTML = state.food.map((f) => `<article class="post">
    <div class="post-head"><span class="tag">${t("Tip")}</span><span>${esc(f.authorName)} · ${timeAgo(f.createdAt)}</span></div>
    <h3>${esc(f.title)}</h3><p class="body">${esc(f.body)}</p>
    ${photos(f)}
    <div class="post-foot"><span class="price">${esc(f.price || "")}</span><span class="grow"></span>${deleteControl("post", f.id, f.authorId)}</div></article>`).join("");
  markLoaded(box);
}

const rerenderLists = () => { renderBoard(); renderMarket(); renderEvents(); renderFood(); };

// ---------------------------------------------------------------- privacy notice
const privacyContact = () => PRIVACY_CONTACT
  ? `email <a href="mailto:${esc(PRIVACY_CONTACT)}">${esc(PRIVACY_CONTACT)}</a>`
  : "contact the abroadboard admins";

function privacyNotice() {
  if (getLang() === "zh") return privacyNoticeZh();
  return `<h3>What we collect</h3>
    <ul>
      <li>Your student email address, used only to sign you in and to check that you study at an accepted Auckland institution.</li>
      <li>The area of Auckland you study in, and your confirmation that you study in Auckland.</li>
      <li>The display name you choose and, if you add it, your home country. Both appear on your posts.</li>
      <li>What you post: board posts, items for sale, photos, food tips, events and reports.</li>
      <li>The contact details you add to a post (email, mobile or social media), and who asked to see them.</li>
    </ul>
    <h3>Who can see it</h3>
    <ul>
      <li>Posts, photos, events, your display name and home country are public on this site.</li>
      <li>Contact details on a post are hidden. Only students you approve, and the site admins, can see them.</li>
      <li>Your sign-in email address is never shown publicly.</li>
      <li>Reports are seen only by you and the site admins.</li>
    </ul>
    <h3>Where it's kept and for how long</h3>
    <ul>
      <li>Data and photos are stored with Supabase in its Seoul, South Korea region. The site is hosted by Vercel.</li>
      <li>Posts and their photos are deleted automatically after ${EXPIRY_DAYS} days, and events about a week after they happen.</li>
      <li>Your account stays until you ask us to delete it.</li>
    </ul>
    <h3>Your rights</h3>
    <p>Under the New Zealand Privacy Act 2020 you can ask to see, correct or delete your information at any time. To do that, ${privacyContact()}. We don't sell your data or use it for advertising profiles.</p>
    <p class="muted">Notice version ${esc(PRIVACY_VERSION)}</p>`;
}

// Mandarin version of the notice above. Keep the two in step when either changes.
function privacyNoticeZh() {
  const contact = PRIVACY_CONTACT
    ? `发送邮件至 <a href="mailto:${esc(PRIVACY_CONTACT)}">${esc(PRIVACY_CONTACT)}</a>`
    : "联系 abroadboard 管理员";
  return `<h3>我们收集哪些信息</h3>
    <ul>
      <li>你的学生邮箱，仅用于登录，以及确认你就读于认可的奥克兰院校。</li>
      <li>你就读的奥克兰区域，以及你确认自己在奥克兰就读的记录。</li>
      <li>你选择的显示名称，以及你填写的家乡国家（如有）。两者都会显示在你的帖子上。</li>
      <li>你发布的内容：留言板帖子、二手物品、照片、美食小贴士、活动和举报。</li>
      <li>你在帖子中填写的联系方式（邮箱、手机或社交媒体），以及谁申请查看过。</li>
    </ul>
    <h3>谁能看到</h3>
    <ul>
      <li>帖子、照片、活动、你的显示名称和家乡国家在本网站公开显示。</li>
      <li>帖子里的联系方式是隐藏的，只有你同意的同学和网站管理员能看到。</li>
      <li>你的登录邮箱不会公开显示。</li>
      <li>举报内容只有你和网站管理员能看到。</li>
    </ul>
    <h3>存放在哪里、保存多久</h3>
    <ul>
      <li>数据和照片存放在 Supabase 的韩国首尔数据中心，网站由 Vercel 托管。</li>
      <li>帖子及其照片会在 ${EXPIRY_DAYS} 天后自动删除，活动结束约一周后删除。</li>
      <li>你的账户会一直保留，直到你要求删除。</li>
    </ul>
    <h3>你的权利</h3>
    <p>根据新西兰《2020 年隐私法》，你可以随时要求查看、更正或删除你的信息。如需办理，请${contact}。我们不会出售你的数据，也不会用它来建立广告画像。</p>
    <p class="muted">声明版本 ${esc(PRIVACY_VERSION)}（如中英文有出入，以英文版为准）</p>`;
}

const institutionList = () => `<details class="domains"><summary>${t("Accepted student emails ({n} institutions)", { n: INSTITUTIONS.length })}</summary><ul>${
  INSTITUTIONS.map((i) => `<li><b>${esc(i.name)}</b> <span>${i.domains.map((d) => "@" + esc(d)).join(t(" or "))}</span></li>`).join("")
}</ul></details>`;

// Required on sign-up, and on the account page for anyone who joined before it existed.
const aucklandFields = (campus, checked, prefix) => `<div class="auckland-box">
    <div class="field"><label for="${prefix}Campus">${t("Where in Auckland do you study?")}</label>
      <select id="${prefix}Campus"><option value="">${t("Choose your campus area")}</option>${CAMPUSES.map((c) => `<option value="${esc(c)}"${c === campus ? " selected" : ""}>${esc(t(c))}</option>`).join("")}</select></div>
    <label class="consent"><input type="checkbox" id="${prefix}Auckland" ${checked ? "checked" : ""}>
      <span>${t("I confirm that I am currently studying at an institution in Auckland, New Zealand.")}</span></label>
  </div>`;

// ---------------------------------------------------------------- join / account (Story 6)
function renderJoin() {
  const box = $("#joinBox"), j = state.join;
  if (state.user) {
    const u = state.user;
    const akl = u.aucklandConfirmed
      ? `<p class="verified"><span class="tick" aria-hidden="true">✓</span>${t("Studying in Auckland: <b>{campus}</b>", { campus: esc(t(u.campus || "Confirmed")) })}</p>`
      : `<form id="aklForm" class="confirm-box" novalidate><h2>${t("Confirm you study in Auckland")}</h2>
          <p>${t("abroadboard is only for students in Auckland. Confirm this once to post, sell and request contact details.")}</p>
          ${aucklandFields(u.campus, false, "a")}<p class="err" id="aErr" hidden></p>
          <div class="actions"><button class="btn btn-primary" type="submit">${t("Confirm")}</button></div></form>`;
    box.innerHTML = `<h1>${t("Your account")}</h1><p>${t("Signed in as <b>{email}</b>{admin}. This name shows on your posts.", { email: esc(u.email), admin: u.isAdmin ? t(" (admin)") : "" })}</p>
      ${akl}
      <form id="profileForm" novalidate>
        <div class="row2">
          <div class="field"><label for="pName">${t("Display name")}</label><input id="pName" maxlength="40" value="${esc(u.name)}"></div>
          <div class="field"><label for="pCountry">${t("Home country")}</label><input id="pCountry" maxlength="40" value="${esc(u.country)}" placeholder="${t("Optional")}"></div>
        </div>
        <div class="actions"><button class="btn btn-ghost" type="button" id="signout2">${t("Sign out")}</button><button class="btn btn-primary" type="submit">${t("Save")}</button></div>
      </form>`;
    $("#signout2").onclick = async () => { await db.signOut(); toast("Signed out"); };
    $("#profileForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await db.updateProfile(u.id, { name: $("#pName").value.trim(), country: $("#pCountry").value.trim() });
        await refreshUser(); loadPosts(); loadMarket(); loadFood(); toast("Saved");
      } catch (err) { toast(err.message); }
    };
    const akf = $("#aklForm");
    if (akf) akf.onsubmit = async (e) => {
      e.preventDefault();
      const err = $("#aErr"), campus = $("#aCampus").value;
      const fail = (m) => { err.textContent = t(m); err.hidden = false; };
      if (!campus) return fail("Choose the area of Auckland you study in.");
      if (!$("#aAuckland").checked) return fail("Tick the box to confirm you study in Auckland.");
      try {
        await db.confirmAuckland(campus); await refreshUser(); toast("Thanks, you're all set to post");
        const next = state.afterJoin; state.afterJoin = null;
        if (next) { location.hash = "#" + next.view; setTimeout(() => openDialog(next.kind), 60); }
      } catch (ex) { fail(ex.message); }
    };
    return;
  }

  if (j.stage === "email") {
    const ready = j.consent && j.auckland && !j.busy;
    box.innerHTML = `<h1>${t("Join abroadboard")}</h1><p>${t(SIGNUP_CODE ? "Use your student email from an Auckland university or college, then enter your verification code to create your profile. There's no password to remember." : "Use your student email from an Auckland university or college. We'll email you a one-time code to type in here, so there's no password to remember.")}</p>
      <form id="joinForm" novalidate>
        <div class="field"><label for="jEmail">${t("Student email")}</label><input id="jEmail" type="email" autocomplete="email" placeholder="you@aucklanduni.ac.nz" value="${esc(j.email)}">
          ${institutionList()}</div>
        ${aucklandFields(j.campus, j.auckland, "j")}
        <div class="row2">
          <div class="field"><label for="jName">${t("Display name")}</label><input id="jName" maxlength="40" placeholder="${t("e.g. Mei")}" value="${esc(j.name)}"></div>
          <div class="field"><label for="jCountry">${t("Home country")}</label><input id="jCountry" maxlength="40" placeholder="${t("Optional")}" value="${esc(j.country)}"></div>
        </div>
        <div class="privacy-box" id="privacyBox"><h2>${t("Privacy notice")}</h2>${privacyNotice()}</div>
        <label class="consent"><input type="checkbox" id="jConsent" ${j.consent ? "checked" : ""}>
          <span>${t("I have read the privacy notice and agree to abroadboard collecting and using my information as described.")}</span></label>
        ${j.error ? `<p class="err">${esc(t(j.error))}</p>` : ""}
        <div class="actions"><button class="btn btn-primary" type="submit" id="jSubmit" ${ready ? "" : "disabled"}>${t(j.busy ? "Sending…" : SIGNUP_CODE ? "Sign up" : "Email me a sign-in code")}</button></div>
      </form>`;
    const sync = () => { j.consent = $("#jConsent").checked; j.auckland = $("#jAuckland").checked; $("#jSubmit").disabled = j.busy || !j.consent || !j.auckland; };
    $("#jConsent").onchange = sync; $("#jAuckland").onchange = sync;
    $("#jCampus").onchange = (e) => { j.campus = e.target.value; };
    $("#joinForm").onsubmit = async (e) => {
      e.preventDefault();
      Object.assign(j, { email: $("#jEmail").value.trim(), name: $("#jName").value.trim(), country: $("#jCountry").value.trim(),
        campus: $("#jCampus").value, auckland: $("#jAuckland").checked, consent: $("#jConsent").checked, error: "" });
      const stop = (msg, focus) => { j.error = msg; renderJoin(); $(focus).focus(); };
      if (!isStudentEmail(j.email)) return stop("That email isn't from an accepted institution. Open the list under the email box to see which addresses work.", "#jEmail");
      if (!j.campus) return stop("Choose the area of Auckland you study in.", "#jCampus");
      if (!j.auckland) return stop("Tick the box to confirm you study in Auckland.", "#jAuckland");
      if (!j.consent) return stop("Tick the box to agree to the privacy notice before joining.", "#jConsent");
      j.busy = true; renderJoin();
      savePending({ email: j.email, name: j.name, country: j.country, campus: j.campus });
      try { await db.sendCode(j.email, { campus: j.campus }); j.stage = "code"; }
      catch (err) { j.error = err.message; }
      j.busy = false; renderJoin();
      $(j.stage === "code" ? "#jCode" : "#jEmail")?.focus();
    };
  } else {
    const intro = SIGNUP_CODE
      ? t("Type your verification code to sign in as <b>{email}</b>. New students get a profile straight away.", { email: esc(j.email) })
      : t("We emailed a sign-in code to <b>{email}</b>. Type it below to sign in. It can take a minute to arrive and may land in junk mail.", { email: esc(j.email) })
        + (db.mode === "demo" ? `<br><span class="muted">${t("Demo mode: any 6 digits will work.")}</span>` : "");
    box.innerHTML = `<h1>${t(SIGNUP_CODE ? "Enter your verification code" : "Enter your code")}</h1><p>${intro}</p>
      <form id="codeForm" novalidate>
        <div class="field"><label for="jCode">${t(SIGNUP_CODE ? "Verification code" : "Sign-in code")}</label><input id="jCode" class="code-input" inputmode="numeric" maxlength="8" placeholder="123456" autocomplete="one-time-code"></div>
        ${j.error ? `<p class="err">${esc(t(j.error))}</p>` : ""}
        ${SIGNUP_CODE ? "" : `<p class="resend">${t("Didn't get it?")} <button class="link-btn" type="button" id="jResend">${t("Send a new code")}</button></p>`}
        <div class="actions"><button class="btn btn-ghost" type="button" id="jBack">${t("Use a different email")}</button><button class="btn btn-primary" type="submit" ${j.busy ? "disabled" : ""}>${t(j.busy ? "Checking…" : "Sign in")}</button></div>
      </form>`;
    $("#jBack").onclick = () => { j.stage = "email"; j.error = ""; renderJoin(); };
    if (!SIGNUP_CODE) $("#jResend").onclick = async () => {
      try { await db.sendCode(j.email, { campus: j.campus }); j.error = ""; renderJoin(); toast("We sent a new code"); }
      catch (err) { j.error = err.message; renderJoin(); }
    };
    $("#jCode").oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, ""); };
    $("#codeForm").onsubmit = async (e) => {
      e.preventDefault();
      const code = $("#jCode").value.trim();
      if (!/^\d{5,8}$/.test(code)) { j.error = SIGNUP_CODE ? "Enter your verification code." : "Enter the code from the email (6 digits or more)."; renderJoin(); $("#jCode").focus(); return; }
      j.busy = true; j.error = ""; renderJoin();
      try {
        await db.verifyCode(j.email, code);
        try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        const u = await db.currentUser();
        if (u && (j.name || j.country)) await db.updateProfile(u.id, { name: j.name, country: j.country });
        if (u && !u.aucklandConfirmed && j.campus && j.auckland) await db.confirmAuckland(j.campus);
        state.join = freshJoin();
        await refreshUser(); loadReports(); loadContacts();
        toast("Email verified. Welcome to abroadboard!");
        const next = state.afterJoin; state.afterJoin = null;
        if (next) { location.hash = "#" + next.view; setTimeout(() => openDialog(next.kind), 60); }
        else location.hash = "#board";
      } catch (err) { j.busy = false; j.error = err.message; renderJoin(); }
    };
  }
}

// ---------------------------------------------------------------- photos in the create dialog
// Resize big photos in the browser (max 1600 px, JPEG) so they upload and load quickly.
async function prepPhoto(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

async function addPhotos(files) {
  const err = $("#fErr");
  const fail = (m, vars) => { err.textContent = t(m, vars); err.hidden = false; };
  err.hidden = true;
  for (const f of files) {
    if (state.photos.length >= MAX_PHOTOS) { fail("You can add up to {n} photos.", { n: MAX_PHOTOS }); break; }
    if (!/\.jpe?g$/i.test(f.name) || (f.type && f.type !== "image/jpeg")) { fail("Photos must be .jpg or .jpeg files."); continue; }
    if (f.size > MAX_PHOTO_MB * 1024 * 1024) { fail("Each photo must be {n} MB or smaller.", { n: MAX_PHOTO_MB }); continue; }
    const blob = await prepPhoto(f);
    state.photos.push({ blob, url: URL.createObjectURL(blob) });
  }
  renderPhotoPreview();
}

function renderPhotoPreview() {
  const box = $("#photoPreview");
  if (!box) return;
  box.innerHTML = state.photos.map((p, i) => `<div class="thumb"><img src="${p.url}" alt=""><button type="button" class="x" data-unphoto="${i}" aria-label="${t("Remove photo")}">×</button></div>`).join("");
  $("#photoCount").textContent = t("{n} of {max} added", { n: state.photos.length, max: MAX_PHOTOS });
  $("#fPhotosBtn").hidden = state.photos.length >= MAX_PHOTOS;
}

function clearPhotos() {
  state.photos.forEach((p) => URL.revokeObjectURL(p.url));
  state.photos = [];
}

// ---------------------------------------------------------------- create dialogs (Stories 2, 4, 7, 16, 18)
const dlg = $("#dlg"), form = $("#dlgForm");
const field = (id, label, input, hint = "") => `<div class="field"><label for="${id}">${t(label)}</label>${input}${hint ? `<span class="hint">${t(hint)}</span>` : ""}</div>`;
const options = (map) => Object.entries(map).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join("");

const photoField = () => `<div class="field"><span class="label">${t("Photos (optional)")}</span>
    <div class="photo-pick">
      <label class="btn btn-ghost btn-sm" id="fPhotosBtn">${t("+ Add photos")}<input id="fPhotos" type="file" accept=".jpg,.jpeg,image/jpeg" multiple hidden></label>
      <span class="hint" id="photoCount"></span>
    </div>
    <div class="photo-preview" id="photoPreview"></div>
    <span class="hint">${t("Up to {n} photos, .jpg or .jpeg, {mb} MB each.", { n: MAX_PHOTOS, mb: MAX_PHOTO_MB })}</span></div>`;

const contactFields = () => {
  const row = (m, type, placeholder, value = "") => `<div class="method">
      <label class="consent"><input type="checkbox" data-method="${m}" ${value ? "checked" : ""}><span>${t(METHODS[m])}</span></label>
      <input id="fc_${m}" type="${type}" maxlength="120" aria-label="${t(METHODS[m])}" placeholder="${t(placeholder)}" value="${esc(value)}" ${value ? "" : "disabled"}>
    </div>`;
  return `<fieldset class="contact-pick"><legend>${t("How should people contact you?")}</legend>
    <p class="hint">${t("Your details stay hidden. People tap “Request contact details” and you choose who sees them.")}</p>
    ${row("email", "email", "you@example.com", state.user.email)}
    ${row("mobile", "tel", "e.g. 021 123 4567")}
    ${row("social", "text", "e.g. Instagram @mei.akl or WeChat ID")}
  </fieldset>`;
};

const audienceFields = () => `<details class="more-box"><summary>${t("Who is this for? (optional)")}</summary>
    <div class="row2">${field("fGender", "Gender", `<select id="fGender">${options(GENDERS)}</select>`)}
    ${field("fSleeper", "Heavy or light sleeper", `<select id="fSleeper">${options(SLEEPERS)}</select>`)}</div>
    ${field("fNote", "Anything else", `<input id="fNote" maxlength="80" placeholder="${t("e.g. non-smoker, vegetarian, pet-friendly")}">`)}
  </details>`;

function openDialog(kind) {
  const view = { post: "board", market: "market", event: "events", food: "food" }[kind];
  if (!state.user) {
    state.afterJoin = { kind, view };
    location.hash = "#join";
    toast("Sign in with your student email to post");
    return;
  }
  if (!state.user.aucklandConfirmed) {
    state.afterJoin = { kind, view };
    location.hash = "#join";
    toast(NOT_CONFIRMED);
    return;
  }
  clearPhotos();
  let html;
  if (kind === "post") {
    html = `<h2>${t("New post")}</h2>
      <div class="guide">${t("<b>What to include:</b> what you're looking for, when and where. Never share your home address or passport details.")}</div>
      ${field("fTitle", "Title", `<input id="fTitle" maxlength="120" placeholder="${t("e.g. Looking for badminton partners")}">`)}
      <div class="row2">${field("fCat", "Category", `<select id="fCat">${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(t(c))}</option>`).join("")}<option value="__custom">${t("Other…")}</option></select>`)}
      ${field("fCustom", "Custom category", `<input id="fCustom" maxlength="30" placeholder="${t("e.g. Sports")}" disabled>`)}</div>
      ${field("fBody", "Details", `<textarea id="fBody" maxlength="2000"></textarea>`)}
      ${audienceFields()}
      ${contactFields()}
      ${photoField()}`;
  } else if (kind === "market") {
    html = `<h2>${t("Sell something")}</h2>
      <div class="guide">${t("<b>Tip:</b> a clear photo and an honest condition sell faster. Meet in a public place on or near campus.")}</div>
      ${field("fTitle", "What are you selling?", `<input id="fTitle" maxlength="120" placeholder="${t("e.g. IKEA desk, white, 120 cm")}">`)}
      <div class="row2">${field("fCat", "Category", `<select id="fCat">${MARKET_CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(t(c))}</option>`).join("")}</select>`)}
      ${field("fCond", "Condition", `<select id="fCond">${CONDITIONS.map((c) => `<option value="${esc(c)}"${c === "Good" ? " selected" : ""}>${esc(t(c))}</option>`).join("")}</select>`)}</div>
      ${field("fPrice", "Price", `<input id="fPrice" maxlength="30" placeholder="${t("e.g. $40, or Free")}">`)}
      ${field("fBody", "Details", `<textarea id="fBody" maxlength="2000" placeholder="${t("Size, age, pick-up area, when you're free")}"></textarea>`)}
      ${photoField()}
      ${audienceFields()}
      ${contactFields()}`;
  } else if (kind === "event") {
    html = `<h2>${t("Post an event")}</h2>
      ${field("fTitle", "Event name", `<input id="fTitle" maxlength="80">`)}
      <div class="row2">${field("fDate", "Date", `<input id="fDate" type="date" min="${todayISO()}">`)}${field("fVenue", "Where", `<input id="fVenue" maxlength="80">`)}</div>
      ${field("fBody", "Short description", `<textarea id="fBody" maxlength="400" style="min-height:80px"></textarea>`)}
      <div class="checkout"><div class="line"><span>${t("Event listing")}</span><span>$${EVENT_FEE_NZD.toFixed(2)}</span></div><div class="line total"><span>${t("Total (NZD)")}</span><span>$${EVENT_FEE_NZD.toFixed(2)}</span></div>
      <p style="margin-top:8px;color:var(--muted);font-size:13px">${t("Test payment: no money is taken yet. Stripe (test mode) can be connected in a later sprint.")}</p></div>`;
  } else {
    html = `<h2>${t("Share a food tip")}</h2>
      ${field("fTitle", "Place or idea", `<input id="fTitle" maxlength="120" placeholder="${t("e.g. $6 bento near the Quad")}">`)}
      ${field("fBody", "Why it's good", `<textarea id="fBody" maxlength="2000" style="min-height:80px"></textarea>`)}
      ${field("fPrice", "Rough cost", `<input id="fPrice" maxlength="30" placeholder="${t("e.g. ~$8")}">`)}
      ${photoField()}`;
  }
  form.innerHTML = html + `<p class="err" id="fErr" hidden></p><div class="actions"><button class="btn btn-ghost" type="button" id="fCancel">${t("Cancel")}</button><button class="btn btn-primary" type="submit" id="fSubmit">${kind === "event" ? t("Pay ${fee} and publish", { fee: EVENT_FEE_NZD }) : t("Publish")}</button></div>`;
  form.dataset.kind = kind;
  $("#fCancel").onclick = () => dlg.close();
  const cat = $("#fCat");
  if (cat && kind === "post") cat.onchange = () => { const c = $("#fCustom"); c.disabled = cat.value !== "__custom"; if (!c.disabled) c.focus(); };
  const pick = $("#fPhotos");
  if (pick) { pick.onchange = async () => { await addPhotos([...pick.files]); pick.value = ""; }; renderPhotoPreview(); }
  form.querySelectorAll("[data-method]").forEach((cb) => (cb.onchange = () => {
    const input = $("#fc_" + cb.dataset.method); input.disabled = !cb.checked; if (cb.checked) input.focus();
  }));
  dlg.showModal();
  $("#fTitle").focus();
}
dlg.addEventListener("close", clearPhotos);
form.addEventListener("click", (e) => {
  const x = e.target.closest("[data-unphoto]");
  if (!x) return;
  const [p] = state.photos.splice(Number(x.dataset.unphoto), 1);
  if (p) URL.revokeObjectURL(p.url);
  renderPhotoPreview();
});

// Reads the contact section of the dialog. Returns a message key on error.
function readContacts() {
  const contacts = {};
  for (const cb of form.querySelectorAll("[data-method]")) if (cb.checked) contacts[cb.dataset.method] = $("#fc_" + cb.dataset.method).value.trim();
  if (!Object.keys(contacts).length) return { error: "Pick at least one way for people to contact you." };
  if (Object.values(contacts).some((v) => !v)) return { error: "Fill in the contact details you ticked." };
  if (contacts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts.email)) return { error: "That email address doesn't look right." };
  return { contacts };
}
const readAudience = () => ({ audienceGender: $("#fGender").value, audienceSleeper: $("#fSleeper").value, audienceNote: $("#fNote").value.trim() });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const kind = form.dataset.kind, v = (id) => ($(id)?.value || "").trim(), err = $("#fErr");
  const fail = (m) => { err.textContent = t(m); err.hidden = false; };
  const required = kind === "event" ? ["#fTitle", "#fDate", "#fVenue", "#fBody"] : kind === "market" ? ["#fTitle", "#fPrice", "#fBody"] : ["#fTitle", "#fBody"];
  if (required.some((id) => !v(id))) return fail(kind === "market" && !v("#fPrice") && v("#fTitle") && v("#fBody") ? "Add a price, or write Free." : "Fill in every field before publishing.");

  const btn = $("#fSubmit"), label = btn.textContent;
  const busy = (on) => { btn.disabled = on; btn.textContent = on ? t("Publishing…") : label; };
  const blobs = state.photos.map((p) => p.blob);
  try {
    if (kind === "post" || kind === "market") {
      const { contacts, error } = readContacts();
      if (error) return fail(error);
      let category = v("#fCat");
      if (category === "__custom") { category = v("#fCustom"); if (!category) return fail("Type a custom category or pick one from the list."); }
      busy(true);
      const base = { category, title: v("#fTitle"), body: v("#fBody"), contacts, ...readAudience() };
      if (kind === "post") {
        await db.createPost({ ...base, section: "board" }, blobs);
        state.filter = "All"; dlg.close(); toast("Published to the board"); loadPosts();
      } else {
        await db.createPost({ ...base, section: "market", price: v("#fPrice"), condition: v("#fCond") }, blobs);
        state.marketFilter = "All"; dlg.close(); toast("Your item is listed"); loadMarket();
      }
      loadContacts();
    } else if (kind === "event") {
      if (v("#fDate") < todayISO()) return fail("Pick today or a date in the future.");
      busy(true);
      await db.createEvent({ title: v("#fTitle"), date: v("#fDate"), venue: v("#fVenue"), blurb: v("#fBody") });
      dlg.close(); toast("Event published"); loadEvents();
    } else {
      busy(true);
      await db.createPost({ section: "food", category: "Tip", title: v("#fTitle"), body: v("#fBody"), price: v("#fPrice") }, blobs);
      dlg.close(); toast("Tip shared"); loadFood();
    }
  } catch (ex) { busy(false); fail(ex.message); }
});

// ---------------------------------------------------------------- photo viewer
const photoDlg = $("#photoDlg");
let viewing = null; // { images, i }
function showPhoto() {
  const img = $("#photoDlgImg"), { images, i } = viewing;
  img.classList.remove("loaded");
  img.src = images[i];
  $("#photoNext").hidden = images.length < 2;
  markLoaded(photoDlg);
}
function openPhoto(ref) {
  const [id, i] = ref.split(":").map(Number);
  const p = allPosts().find((x) => x.id === id);
  if (!p?.images?.[i]) return;
  viewing = { images: p.images, i };
  $("#photoDlgImg").alt = p.title;
  showPhoto();
  photoDlg.showModal();
}
photoDlg.addEventListener("click", (e) => {
  if (e.target.closest("#photoNext")) { viewing.i = (viewing.i + 1) % viewing.images.length; showPhoto(); }
  else if (e.target === photoDlg || e.target.closest("[data-close]")) photoDlg.close();
});

// ---------------------------------------------------------------- clicks
document.addEventListener("click", async (e) => {
  if (e.target.closest("#dlgForm")) return;
  const el = e.target.closest("[data-cat],[data-report],[data-clear],[data-del],[data-del-confirm],[data-del-cancel],[data-new],[data-photo],[data-request],[data-answer]");
  if (!el) return;
  if (el.tagName === "A") e.preventDefault(); // intro links that open "New post"
  const d = el.dataset;
  try {
    if (d.cat !== undefined) {
      if (el.closest("#view-market")) { state.marketFilter = d.cat; renderMarket(); }
      else { state.filter = d.cat; renderBoard(); }
    }
    else if (d.new) openDialog(d.new);
    else if (d.photo) openPhoto(d.photo);
    else if (d.request) {
      if (!state.user) { location.hash = "#join"; toast("Sign in to request contact details"); return; }
      if (!state.user.aucklandConfirmed) { location.hash = "#join"; toast(NOT_CONFIRMED); return; }
      el.disabled = true;
      await db.requestContact(Number(d.request)); await loadContacts(); toast("Request sent");
    }
    else if (d.answer) {
      const [id, status] = d.answer.split(":");
      el.disabled = true;
      await db.answerRequest(Number(id), status); await loadContacts();
      toast(status === "approved" ? "Details shared" : "Request declined");
    }
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
      else { await db.deletePost(Number(id)); await Promise.all([loadPosts(), loadMarket(), loadFood(), loadReports()]); }
      toast("Deleted");
    }
  } catch (ex) { state.confirmDelete = null; rerenderLists(); toast(ex.message); }
});

$("#q").addEventListener("input", (e) => { state.query = e.target.value; renderBoard(); });
$("#mq").addEventListener("input", (e) => { state.marketQuery = e.target.value; renderMarket(); });

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

// ---------------------------------------------------------------- language (English / 中文)
function renderLang() {
  const b = $("#langBtn");
  const zh = getLang() === "zh";
  b.textContent = zh ? "English" : "中文";
  b.lang = zh ? "en" : "zh-Hans";
  b.setAttribute("aria-label", zh ? "Switch to English" : "切换到中文");
  $("#privacyPage").innerHTML = privacyNotice();
}
$("#langBtn").addEventListener("click", () => {
  setLang(getLang() === "zh" ? "en" : "zh");
  renderLang();
  if (dlg.open) dlg.close();
  if (db) { renderWho(); renderJoin(); rerenderLists(); }
});

// ---------------------------------------------------------------- start
async function start() {
  route();
  applyStatic();
  renderLang();
  try { db = await createBackend(); }
  catch (e) {
    $("#feedList").innerHTML = `<div class="error-box"><b>${t("The site couldn't start.")}</b> ${esc(t(e.message))}</div>`;
    return;
  }
  if (db.mode === "demo") {
    $("#modeBar").hidden = false;
    $("#adminToggle").onclick = async () => {
      if (!state.user) { location.hash = "#join"; toast("Sign in first, then switch to admin view"); return; }
      db.setAdmin(!state.user?.isAdmin); await refreshUser(); await loadReports(); await loadContacts(); toast(state.user?.isAdmin ? "Admin view on" : "Student view"); };
    $("#resetDemo").onclick = async () => { db.reset(); state.filter = "All"; state.marketFilter = "All"; toast("Demo data reset"); await loadAll(); };
  }
  db.onAuthChange(async () => { await refreshUser(); loadReports(); loadContacts(); });
  await refreshUser();
  await loadAll();
}
start();
