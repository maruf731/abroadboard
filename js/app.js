// abroadboard UI. All data goes through ./data.js, so this file doesn't care
// whether Supabase is connected (live) or not (demo).

import { createBackend, isStudentEmail, todayISO } from "./data.js";
import { INSTITUTIONS, CAMPUSES, MAX_PHOTOS, MAX_PHOTO_MB, EXPIRY_DAYS, EVENT_FEE_NZD, PRIVACY_VERSION, PRIVACY_CONTACT, SIGNUP_CODE,
  CATEGORY_GROUPS, CATEGORIES, SPORTS, MAP_PLACES } from "./config.js";
import { t, getLang, setLang, locale, applyStatic, LANGS } from "./i18n.js";
import { search, suggest } from "./search.js";

const DAY = 864e5;
const MARKET_CATEGORIES = ["Furniture", "Electronics", "Books & study", "Kitchen", "Clothing", "Bikes & transport", "Other"];
const CONDITIONS = ["New", "Like new", "Good", "Fair"];
// Who a post is meant for. Stored as the key; shown as the label.
const GENDERS = { any: "Anyone", women: "Women", men: "Men" };
const SLEEPERS = { any: "Any", light: "Light sleepers", heavy: "Heavy sleepers" };
const METHODS = { email: "Email", mobile: "Mobile", social: "Social media" };
const VIEWS = ["board", "market", "events", "campus", "food", "faq", "contact", "admin", "join", "privacy"];
// Gender filter on the board (FC-36): which posts to show by who they're for.
const GENDER_FILTER = { all: "All posts", any: "Open to everyone", women: "Women", men: "Men" };
// Kinds of message students can send the admins (FC-37).
const THREAD_KINDS = { contact: "Question or feedback", complaint: "Complaint", report: "Report a post or a person", other: "Something else" };
const NOT_CONFIRMED = "Confirm that you study in Auckland (on your account page) before posting.";

const $ = (s) => document.querySelector(s);
// Sample posts and events have Mandarin in i18n.js (keyed by their English text);
// anything students write themselves is shown as written.
const tx = (s) => esc(s ? t(s) : s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const freshJoin = () => ({ mode: "signup", stage: "email", email: "", name: "", country: "", campus: "", interests: [], auckland: false, consent: false, error: "", busy: false });
const state = {
  user: null,
  posts: null, market: null, food: null, events: null, // null = still loading
  reports: [],
  contactInfo: { requests: [], contacts: {} },
  errors: {},
  filter: "All", sport: "All", gender: "all", onlyMine: false, query: "",
  categoryRequests: [], // approved ones add categories; admins see all
  notifications: [],
  threads: null, // messages with the admins; null = not loaded
  adminTab: "messages",
  jumpTo: null, // post id to scroll to (from a notification link)
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
  await Promise.all([loadCategories(), loadPosts(), loadMarket(), loadFood(), loadEvents(), loadReports(), loadContacts(), loadNotifications(), loadThreads()]);
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
const loadCategories = () => run("categories", async () => { state.categoryRequests = await db.listCategoryRequests(); })
  .then(() => { renderBoard(); renderAdmin(); });
const loadNotifications = () => run("notifications", async () => { state.notifications = await db.listNotifications(); })
  .then(renderBell);
const loadThreads = () => run("threads", async () => { state.threads = await db.listThreads(); })
  .then(() => { renderContact(); renderAdmin(); });
// Signed-in data that changes with the account.
const loadMine = () => Promise.all([loadReports(), loadContacts(), loadNotifications(), loadThreads(), loadCategories()]);

// Approved category requests become extra categories (FC-44).
const extraCategories = () => state.categoryRequests.filter((r) => r.status === "approved" && !CATEGORIES.includes(r.name)).map((r) => r.name);
function categoryGroups() {
  const extra = extraCategories();
  const groups = CATEGORY_GROUPS.filter((g) => g.group !== "Other");
  if (extra.length) groups.push({ group: "Added by students", categories: extra });
  return [...groups, ...CATEGORY_GROUPS.filter((g) => g.group === "Other")];
}
// <option>s grouped by <optgroup>; "Sports" etc. are shown translated.
const categoryOptions = (selected, withAll = false) =>
  (withAll ? `<option value="All"${selected === "All" ? " selected" : ""}>${t("All categories")}</option>` : "") +
  categoryGroups().map((g) => g.categories.length === 1 && g.categories[0] === g.group
    ? `<option value="${esc(g.group)}"${g.group === selected ? " selected" : ""}>${esc(t(g.group))}</option>`
    : `<optgroup label="${esc(t(g.group))}">${g.categories.map((c) => `<option value="${esc(c)}"${c === selected ? " selected" : ""}>${esc(t(c))}</option>`).join("")}</optgroup>`).join("");
const sportOptions = (selected, withAll = false) =>
  (withAll ? `<option value="All"${selected === "All" ? " selected" : ""}>${t("All sports")}</option>` : "") +
  SPORTS.map((x) => `<option value="${esc(x)}"${x === selected ? " selected" : ""}>${esc(t(x))}</option>`).join("");

// Grouped tick boxes for picking interests (sign-up and the preference center).
const interestPicker = (selected, prefix) => `<div class="interest-pick" id="${prefix}Interests">${categoryGroups().map((g) => `
    <fieldset><legend>${esc(t(g.group))}</legend>${g.categories.map((c) => `<label class="ichip"><input type="checkbox" value="${esc(c)}"${selected.includes(c) ? " checked" : ""}><span>${esc(t(c))}</span></label>`).join("")}</fieldset>`).join("")}
  </div>`;
const readInterests = (prefix) => [...document.querySelectorAll(`#${prefix}Interests input:checked`)].map((i) => i.value);

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
  if (p.name || p.country || p.interests?.length) { await db.updateProfile(user.id, { name: p.name, country: p.country, interests: p.interests?.length ? p.interests : undefined }); changed = true; }
  if (p.campus && !user.aucklandConfirmed) { await db.confirmAuckland(p.campus); changed = true; }
  return changed;
}

async function refreshUser() {
  state.user = await db.currentUser();
  if (state.user && (await applyPending(state.user).catch(() => false))) state.user = await db.currentUser();
  renderWho(); renderJoin(); rerenderLists(); renderContact(); renderAdmin(); renderBell();
}

// ---------------------------------------------------------------- header & footer
function renderWho() {
  const w = $("#who");
  if (state.user) {
    w.innerHTML = `<span>${t("Signed in as <b>{name}</b>", { name: esc(state.user.name) })}</span> <button class="link-btn" id="signout">${t("Sign out")}</button>`;
    $("#signout").onclick = async () => { await db.signOut(); toast("Signed out"); };
  } else {
    w.innerHTML = `<a class="btn btn-ghost btn-sm" href="#join" id="signinLink">${t("Sign in")}</a>`;
    $("#signinLink").onclick = () => { if (SIGNUP_CODE) { state.join.mode = "signin"; state.join.error = ""; renderJoin(); } };
  }
  $("#joinTab").textContent = t(state.user ? "My account" : "Join");
  $("#adminTab").hidden = !state.user?.isAdmin;
  $("#bellWrap").hidden = !state.user;
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
  if (p.audienceNote) bits.push(tx(p.audienceNote));
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
  if (!methods.length) return p.contact ? `<div class="contact-row"><span class="contact">${tx(p.contact)}</span></div>` : "";
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

const byline = (p) => `<span>${esc(p.authorName)}${p.authorCountry ? " · " + tx(p.authorCountry) : ""}</span><span>·</span><span>${timeAgo(p.createdAt)}</span>`;

function postCard(p) {
  const { total } = reportInfo(p.id);
  return `<article class="post${state.user?.isAdmin && total ? " is-reported" : ""}${state.jumpTo === p.id ? " is-target" : ""}" id="post-${p.id}">
    <div class="post-head"><span class="tag">${esc(t(p.category))}${p.sport ? ` · ${esc(t(p.sport))}` : ""}</span>${byline(p)}</div>
    <h3>${tx(p.title)}</h3>
    <p class="body">${tx(p.body)}</p>
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
  return `<article class="listing${state.user?.isAdmin && total ? " is-reported" : ""}" id="post-${p.id}">
    ${cover}
    <div class="listing-body">
      <div class="price-row"><span class="price">${(p.price ? tx(p.price) : t("Ask"))}</span>${p.condition ? `<span class="pill soft">${esc(t(p.condition))}</span>` : ""}</div>
      <h3>${tx(p.title)}</h3>
      <div class="post-head"><span class="tag">${esc(t(p.category))}</span>${byline(p)}</div>
      <p class="body">${tx(p.body)}</p>
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
// Everything a search can match on, in English and in the chosen language.
const searchText = (p) => [p.title, p.body, p.category, p.sport, p.audienceNote, p.price, p.authorName]
  .filter(Boolean).flatMap((x) => [x, t(x)]).join(" ");
const titleText = (p) => t(p.title);

// Suggestions under a search box (FC-43): a corrected spelling and matching titles.
function renderSuggest(box, list, query) {
  const el = $(box);
  const { didYouMean, titles } = query.trim().length >= 2
    ? suggest(list, query, searchText, titleText, [...CATEGORIES, ...SPORTS].flatMap((c) => [c, t(c)]))
    : { didYouMean: "", titles: [] };
  const exact = titles.length === 1 && titles[0].toLowerCase() === query.trim().toLowerCase();
  if (!didYouMean && (!titles.length || exact)) { el.hidden = true; el.innerHTML = ""; return; }
  el.innerHTML = (didYouMean ? `<button type="button" class="sugg dym" data-sugg="${esc(didYouMean)}"><span>${t("Did you mean <b>{q}</b>?", { q: esc(didYouMean) })}</span></button>` : "") +
    titles.map((x) => `<button type="button" class="sugg" data-sugg="${esc(x)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>${esc(x)}</button>`).join("");
  el.hidden = false;
}

// Ad slot (Story 5). Replace the inner HTML with your Google AdSense <ins> tag once approved.
const AD_SLOT = () => `<div class="ad" role="complementary" aria-label="${t("Advertisement")}"><div><small>${t("Advertisement")}</small><strong>${t("Google AdSense slot")}</strong></div><span class="dim">responsive · 728×90</span></div>`;

// ---------------------------------------------------------------- board
function renderBoard() {
  const feed = $("#feedList");
  if (state.errors.posts) { feed.innerHTML = `<div class="error-box"><b>${t("Couldn't load posts.")}</b> ${esc(t(state.errors.posts))}</div>`; return; }
  if (!state.posts) return;

  // Filters (FC-36, FC-40, FC-44): category, sport, who the post is for, and "Only your interests".
  const counts = {};
  state.posts.forEach((p) => (counts[p.category] = (counts[p.category] || 0) + 1));
  $("#catSel").innerHTML = categoryOptions(state.filter, true);
  [...$("#catSel").options].forEach((o) => { if (o.value !== "All") o.textContent += ` (${counts[o.value] || 0})`; });
  $("#sportPick").hidden = state.filter !== "Sports";
  $("#sportSel").innerHTML = sportOptions(state.sport, true);
  $("#genderSel").innerHTML = Object.entries(GENDER_FILTER).map(([k, v]) => `<option value="${k}"${k === state.gender ? " selected" : ""}>${esc(t(v))}</option>`).join("");
  const interests = state.user?.interests || [];
  $("#mineBtn").setAttribute("aria-pressed", String(state.onlyMine));

  let list = state.posts.filter((p) =>
    (state.filter === "All" || p.category === state.filter) &&
    (state.filter !== "Sports" || state.sport === "All" || p.sport === state.sport) &&
    (state.gender === "all" || (p.audienceGender || "any") === state.gender) &&
    (!state.onlyMine || interests.includes(p.category)));
  list.sort((a, b) => b.createdAt - a.createdAt); // newest first (Story 15)
  const found = search(list, state.query, searchText); // best matches first while searching
  list = found.items;

  const note = $("#filterNote");
  if (state.onlyMine && !interests.length) note.innerHTML = t("You haven't picked any interests yet. <a href=\"#join\">Choose them on My account</a>.");
  else if (found.close) note.innerHTML = t("No exact matches for “{q}”. Showing the closest posts.", { q: esc(state.query.trim()) });
  else if (state.onlyMine) note.innerHTML = t("Showing posts in your interests: {list}", { list: interests.map((c) => esc(t(c))).join(", ") });
  else note.innerHTML = "";

  feed.innerHTML = list.length
    ? list.map((p, i) => postCard(p) + (i === 2 ? AD_SLOT() : "")).join("") + (list.length <= 2 ? AD_SLOT() : "")
    : `<div class="empty">${t(state.posts.length ? "No posts match that. Try another category or search." : "No posts yet. Be the first to post!")}</div>${AD_SLOT()}`;
  markLoaded(feed);
  if (state.jumpTo && $(`#post-${state.jumpTo}`)) {
    const el = $(`#post-${state.jumpTo}`);
    state.jumpTo = null;
    requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

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
  const list = search(state.market.filter((p) => state.marketFilter === "All" || p.category === state.marketFilter)
    .sort((a, b) => b.createdAt - a.createdAt), state.marketQuery, searchText).items;
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
      <div><h3>${tx(e.title)}</h3><div class="meta">${d.toLocaleString(locale(), { weekday: "long" })} · ${tx(e.venue)} · ${t("hosted by {name}", { name: esc(e.hostName) })}</div><p>${tx(e.blurb)}</p>
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
    <h3>${tx(f.title)}</h3><p class="body">${tx(f.body)}</p>
    ${photos(f)}
    <div class="post-foot"><span class="price">${tx(f.price || "")}</span><span class="grow"></span>${deleteControl("post", f.id, f.authorId)}</div></article>`).join("");
  markLoaded(box);
}

const rerenderLists = () => { renderBoard(); renderMarket(); renderEvents(); renderFood(); };

// ---------------------------------------------------------------- privacy notice
// Each sentence goes through t(), so the notice follows the language menu.
// If a translation differs from the English, the English version applies.
function privacyNotice() {
  const contact = PRIVACY_CONTACT
    ? t("email {email}", { email: `<a href="mailto:${esc(PRIVACY_CONTACT)}">${esc(PRIVACY_CONTACT)}</a>` })
    : t("contact the abroadboard admins");
  const list = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  return `<h3>${t("What we collect")}</h3>
    ${list([
      t("Your student email address, used only to sign you in and to check that you study at an accepted Auckland institution."),
      t("The area of Auckland you study in, and your confirmation that you study in Auckland."),
      t("The display name you choose and, if you add it, your home country. Both appear on your posts."),
      t("The interests you pick, used to tailor the board and send you notifications."),
      t("What you post: board posts, items for sale, photos, food tips, events and reports."),
      t("The contact details you add to a post (email, mobile or social media), and who asked to see them."),
      t("Messages you send the abroadboard team, and category requests."),
    ])}
    <h3>${t("Who can see it")}</h3>
    ${list([
      t("Posts, photos, events, your display name and home country are public on this site."),
      t("Contact details on a post are hidden. Only students you approve, and the site admins, can see them."),
      t("Your sign-in email address and your interests are never shown publicly."),
      t("Reports and messages to the team are seen only by you and the site admins."),
    ])}
    <h3>${t("Where it's kept and for how long")}</h3>
    ${list([
      t("Data and photos are stored with Supabase in its Seoul, South Korea region. The site is hosted by Vercel."),
      t("Posts and their photos are deleted automatically after {days} days, and events about a week after they happen.", { days: EXPIRY_DAYS }),
      t("Your account stays until you ask us to delete it."),
    ])}
    <h3>${t("Your rights")}</h3>
    <p>${t("Under the New Zealand Privacy Act 2020 you can ask to see, correct or delete your information at any time. To do that, {contact}. We don't sell your data or use it for advertising profiles.", { contact })}</p>
    <p class="muted">${t("Notice version {v}", { v: esc(PRIVACY_VERSION) })}${getLang() === "en" ? "" : " " + t("(If this translation differs from the English, the English version applies.)")}</p>`;
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
      </form>
      <form id="prefForm" class="pref-box" novalidate>
        <h2>${t("Your interests")}</h2>
        <p>${t("Choose the categories you care about. The board's <b>Only your interests</b> button shows just these, and the bell tells you when someone posts in one.")}</p>
        ${interestPicker(u.interests || [], "p")}
        <label class="consent"><input type="checkbox" id="pNotify" ${u.notifyInterests !== false ? "checked" : ""}><span>${t("Notify me about new posts in my interests")}</span></label>
        <div class="actions"><button class="btn btn-primary" type="submit">${t("Save interests")}</button></div>
      </form>
      <section class="pref-box" id="notifBox"><h2>${t("Notifications")}</h2><div id="notifList"></div></section>`;
    $("#prefForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await db.updateProfile(u.id, { interests: readInterests("p"), notifyInterests: $("#pNotify").checked });
        await refreshUser(); loadNotifications(); toast("Interests saved");
      } catch (err) { toast(err.message); }
    };
    renderNotifList($("#notifList"));
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

  // Sign up / Sign in switch (sign-in is only offered while the shared code is on).
  const modeTabs = SIGNUP_CODE ? `<div class="mode-tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${j.mode !== "signin"}" data-mode="signup">${t("Sign up")}</button>
      <button type="button" role="tab" aria-selected="${j.mode === "signin"}" data-mode="signin">${t("Sign in")}</button></div>` : "";
  const bindTabs = () => box.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => {
    j.mode = b.dataset.mode; j.stage = "email"; j.error = ""; renderJoin(); $("#jEmail")?.focus();
  }));

  if (SIGNUP_CODE && j.mode === "signin") {
    box.innerHTML = `${modeTabs}<h1>${t("Welcome back")}</h1><p>${t("Sign in with the student email you joined with and your password.")}</p>
      <form id="signinForm" novalidate>
        <div class="field"><label for="jEmail">${t("Student email")}</label><input id="jEmail" type="email" autocomplete="username" placeholder="you@aucklanduni.ac.nz" value="${esc(j.email)}"></div>
        <div class="field"><label for="jPassword">${t("Password")}</label><input id="jPassword" type="password" autocomplete="current-password" inputmode="numeric" maxlength="20"></div>
        ${j.error ? `<p class="err">${esc(t(j.error))}</p>` : ""}
        <div class="actions"><button class="btn btn-primary" type="submit" ${j.busy ? "disabled" : ""}>${t(j.busy ? "Checking…" : "Sign in")}</button></div>
      </form>`;
    bindTabs();
    $("#signinForm").onsubmit = async (e) => {
      e.preventDefault();
      j.email = $("#jEmail").value.trim();
      const password = $("#jPassword").value.trim();
      if (!j.email || !password) { j.error = "Enter your email and password."; renderJoin(); return; }
      j.busy = true; j.error = ""; renderJoin();
      try {
        await db.signIn(j.email, password);
        state.join = freshJoin();
        await refreshUser(); loadMine();
        toast("Welcome back!");
        const next = state.afterJoin; state.afterJoin = null;
        if (next && state.user?.aucklandConfirmed) { location.hash = "#" + next.view; setTimeout(() => openDialog(next.kind), 60); }
        else if (state.user?.aucklandConfirmed) location.hash = "#board";
      } catch (err) { j.busy = false; j.error = err.message; renderJoin(); $("#jPassword")?.focus(); }
    };
    return;
  }

  if (j.stage === "email") {
    const ready = j.consent && j.auckland && !j.busy;
    box.innerHTML = `${modeTabs}<h1>${t("Join abroadboard")}</h1><p>${t(SIGNUP_CODE ? "Use your student email from an Auckland university or college, then enter your verification code to create your profile. There's no password to remember." : "Use your student email from an Auckland university or college. We'll email you a one-time code to type in here, so there's no password to remember.")}</p>
      <form id="joinForm" novalidate>
        <div class="field"><label for="jEmail">${t("Student email")}</label><input id="jEmail" type="email" autocomplete="email" placeholder="you@aucklanduni.ac.nz" value="${esc(j.email)}">
          ${institutionList()}</div>
        ${aucklandFields(j.campus, j.auckland, "j")}
        <div class="row2">
          <div class="field"><label for="jName">${t("Display name")}</label><input id="jName" maxlength="40" placeholder="${t("e.g. Mei")}" value="${esc(j.name)}"></div>
          <div class="field"><label for="jCountry">${t("Home country")}</label><input id="jCountry" maxlength="40" placeholder="${t("Optional")}" value="${esc(j.country)}"></div>
        </div>
        <div class="field"><span class="label">${t("What are you interested in?")}</span>
          <span class="hint">${t("Pick as many as you like. We'll notify you about new posts in these categories, and you can change them any time.")}</span>
          ${interestPicker(j.interests, "j")}</div>
        <div class="privacy-box" id="privacyBox"><h2>${t("Privacy notice")}</h2>${privacyNotice()}</div>
        <label class="consent"><input type="checkbox" id="jConsent" ${j.consent ? "checked" : ""}>
          <span>${t("I have read the privacy notice and agree to abroadboard collecting and using my information as described.")}</span></label>
        ${j.error ? `<p class="err">${esc(t(j.error))}</p>` : ""}
        <div class="actions"><button class="btn btn-primary" type="submit" id="jSubmit" ${ready ? "" : "disabled"}>${t(j.busy ? "Sending…" : SIGNUP_CODE ? "Sign up" : "Email me a sign-in code")}</button></div>
      </form>`;
    bindTabs();
    const sync = () => { j.consent = $("#jConsent").checked; j.auckland = $("#jAuckland").checked; $("#jSubmit").disabled = j.busy || !j.consent || !j.auckland; };
    $("#jConsent").onchange = sync; $("#jAuckland").onchange = sync;
    $("#jCampus").onchange = (e) => { j.campus = e.target.value; };
    $("#joinForm").onsubmit = async (e) => {
      e.preventDefault();
      Object.assign(j, { email: $("#jEmail").value.trim(), name: $("#jName").value.trim(), country: $("#jCountry").value.trim(),
        campus: $("#jCampus").value, auckland: $("#jAuckland").checked, consent: $("#jConsent").checked, interests: readInterests("j"), error: "" });
      const stop = (msg, focus) => { j.error = msg; renderJoin(); $(focus).focus(); };
      if (!isStudentEmail(j.email)) return stop("That email isn't from an accepted institution. Open the list under the email box to see which addresses work.", "#jEmail");
      if (!j.campus) return stop("Choose the area of Auckland you study in.", "#jCampus");
      if (!j.auckland) return stop("Tick the box to confirm you study in Auckland.", "#jAuckland");
      if (!j.consent) return stop("Tick the box to agree to the privacy notice before joining.", "#jConsent");
      j.busy = true; renderJoin();
      savePending({ email: j.email, name: j.name, country: j.country, campus: j.campus, interests: j.interests });
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
        if (u && (j.name || j.country || j.interests.length))
          await db.updateProfile(u.id, { name: j.name, country: j.country, interests: j.interests.length ? j.interests : undefined });
        if (u && !u.aucklandConfirmed && j.campus && j.auckland) await db.confirmAuckland(j.campus);
        state.join = freshJoin();
        await refreshUser(); loadMine();
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
  if (dlg.open) dlg.close();
  const view = { post: "board", market: "market", event: "events", food: "food", category: "board" }[kind];
  if (!state.user) {
    state.afterJoin = { kind, view };
    location.hash = "#join";
    toast("Sign in with your student email to post");
    return;
  }
  if (!state.user.aucklandConfirmed && kind !== "category") {
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
      <div class="row2">${field("fCat", "Category", `<select id="fCat">${categoryOptions(state.filter !== "All" ? state.filter : "Coffee and chat")}</select>`)}
      <div id="fSportBox" ${state.filter === "Sports" ? "" : "hidden"}>${field("fSport", "Sport", `<select id="fSport">${sportOptions(state.sport !== "All" ? state.sport : "")}</select>`)}</div></div>
      <p class="hint">${t("No category that fits? Pick Other, or")} <a href="#board" data-new="category">${t("request a new category")}</a>.</p>
      ${field("fBody", "Details", `<textarea id="fBody" maxlength="2000"></textarea>`)}
      ${audienceFields()}
      ${contactFields()}
      ${photoField()}`;
  } else if (kind === "category") {
    html = `<h2>${t("Request a category")}</h2>
      <div class="guide">${t("Tell us what's missing. An admin will check your request, and you'll get a notification when it's approved or declined.")}</div>
      ${field("fTitle", "Category name", `<input id="fTitle" maxlength="30" placeholder="${t("e.g. Music and jamming")}">`)}
      ${field("fBody", "Why is it useful? (optional)", `<textarea id="fBody" maxlength="300" style="min-height:80px"></textarea>`)}`;
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
  form.innerHTML = html + `<p class="err" id="fErr" hidden></p><div class="actions"><button class="btn btn-ghost" type="button" id="fCancel">${t("Cancel")}</button><button class="btn btn-primary" type="submit" id="fSubmit">${kind === "event" ? t("Pay ${fee} and publish", { fee: EVENT_FEE_NZD }) : kind === "category" ? t("Send request") : t("Publish")}</button></div>`;
  form.dataset.kind = kind;
  $("#fCancel").onclick = () => dlg.close();
  const cat = $("#fCat");
  if (cat && kind === "post") cat.onchange = () => { $("#fSportBox").hidden = cat.value !== "Sports"; };
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
  const nw = e.target.closest("[data-new]");
  if (nw) { e.preventDefault(); openDialog(nw.dataset.new); return; }
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
  const required = kind === "event" ? ["#fTitle", "#fDate", "#fVenue", "#fBody"] : kind === "market" ? ["#fTitle", "#fPrice", "#fBody"] : kind === "category" ? ["#fTitle"] : ["#fTitle", "#fBody"];
  if (required.some((id) => !v(id))) return fail(kind === "market" && !v("#fPrice") && v("#fTitle") && v("#fBody") ? "Add a price, or write Free." : "Fill in every field before publishing.");

  const btn = $("#fSubmit"), label = btn.textContent;
  const busy = (on) => { btn.disabled = on; btn.textContent = on ? t("Publishing…") : label; };
  const blobs = state.photos.map((p) => p.blob);
  try {
    if (kind === "post" || kind === "market") {
      const { contacts, error } = readContacts();
      if (error) return fail(error);
      const category = v("#fCat");
      busy(true);
      const base = { category, sport: kind === "post" && category === "Sports" ? v("#fSport") : null,
        title: v("#fTitle"), body: v("#fBody"), contacts, ...readAudience() };
      if (kind === "post") {
        await db.createPost({ ...base, section: "board" }, blobs);
        state.filter = "All"; state.onlyMine = false; dlg.close(); toast("Published to the board"); loadPosts();
      } else {
        await db.createPost({ ...base, section: "market", price: v("#fPrice"), condition: v("#fCond") }, blobs);
        state.marketFilter = "All"; dlg.close(); toast("Your item is listed"); loadMarket();
      }
      loadContacts();
    } else if (kind === "category") {
      const name = v("#fTitle");
      if (name.length < 2) return fail("Type a category name.");
      const all = [...CATEGORIES, ...state.categoryRequests.map((r) => r.name)].map((c) => c.toLowerCase());
      if (all.includes(name.toLowerCase())) return fail("That category already exists or has already been requested.");
      busy(true);
      await db.requestCategory(name, v("#fBody"));
      dlg.close(); toast("Thanks. An admin will review your request."); loadCategories();
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
  const el = e.target.closest("[data-cat],[data-report],[data-clear],[data-del],[data-del-confirm],[data-del-cancel],[data-new],[data-photo],[data-request],[data-answer],[data-sugg],[data-notif],[data-notif-read],[data-notif-clear],[data-thread-status],[data-cat-answer]");
  if (!el) return;
  const d = el.dataset;
  if (el.tagName === "A" && d.notif === undefined) e.preventDefault(); // intro links that open "New post"
  try {
    if (d.cat !== undefined) {
      if (el.closest("#view-market")) { state.marketFilter = d.cat; renderMarket(); }
      else { state.filter = d.cat; renderBoard(); }
    }
    else if (d.new) openDialog(d.new);
    else if (d.sugg !== undefined) {
      const market = !!el.closest("#view-market"), input = $(market ? "#mq" : "#q");
      input.value = d.sugg;
      if (market) { state.marketQuery = d.sugg; renderMarket(); $("#mqSuggest").hidden = true; }
      else { state.query = d.sugg; renderBoard(); $("#qSuggest").hidden = true; }
      input.focus();
    }
    else if (d.notif) { toggleBell(false); markAllRead(); /* the link itself navigates */ }
    else if (d.notifRead !== undefined) markAllRead();
    else if (d.notifClear !== undefined) { await db.clearNotifications(); await loadNotifications(); }
    else if (d.threadStatus) {
      const [id, status] = d.threadStatus.split(":");
      await db.setThreadStatus(Number(id), status); await loadThreads(); toast(status === "closed" ? "Marked as resolved" : "Reopened");
    }
    else if (d.catAnswer) {
      const [id, status] = d.catAnswer.split(":");
      el.disabled = true;
      await db.answerCategoryRequest(Number(id), status); await loadCategories(); toast(status === "approved" ? "Category approved" : "Request declined");
    }
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

$("#q").addEventListener("input", (e) => { state.query = e.target.value; renderBoard(); renderSuggest("#qSuggest", state.posts || [], state.query); });
$("#mq").addEventListener("input", (e) => { state.marketQuery = e.target.value; renderMarket(); renderSuggest("#mqSuggest", state.market || [], state.marketQuery); });
// Hide suggestions when focus leaves the search box (but not when a suggestion is clicked).
["#q", "#mq"].forEach((id) => $(id).addEventListener("blur", () => setTimeout(() => {
  const box = $(id + "Suggest"); if (!box.contains(document.activeElement)) box.hidden = true;
}, 150)));
$("#catSel").addEventListener("change", (e) => { state.filter = e.target.value; state.sport = "All"; renderBoard(); });
$("#sportSel").addEventListener("change", (e) => { state.sport = e.target.value; renderBoard(); });
$("#genderSel").addEventListener("change", (e) => { state.gender = e.target.value; renderBoard(); });
$("#mineBtn").addEventListener("click", () => {
  if (!state.user) { location.hash = "#join"; toast("Sign in to see posts in your interests"); return; }
  state.onlyMine = !state.onlyMine; renderBoard();
});

// ---------------------------------------------------------------- notifications (FC-35)
function notifText(n) {
  if (n.kind === "post") return t("New post in <b>{cat}</b>: {title}", { cat: esc(t(n.detail)), title: esc(t(n.title)) });
  if (n.kind === "reply") return t("An admin replied to your message: {title}", { title: esc(n.title) });
  if (n.kind === "category") return n.detail === "approved"
    ? t("Your category <b>{name}</b> was approved", { name: esc(n.title) })
    : t("Your category <b>{name}</b> was declined", { name: esc(n.title) });
  return esc(n.title);
}
const notifLink = (n) => (n.kind === "post" && n.postId ? `#post-${n.postId}` : n.kind === "reply" ? "#contact" : "#board");

function renderNotifList(box) {
  if (!box) return;
  const list = state.notifications;
  box.innerHTML = list.length
    ? `<ul class="notifs">${list.map((n) => `<li class="${n.read ? "" : "unread"}"><a href="${notifLink(n)}" data-notif="${n.id}">${notifText(n)}</a><span class="muted small">${timeAgo(n.createdAt)}</span></li>`).join("")}</ul>
       <div class="notif-actions"><button class="link-btn" type="button" data-notif-read>${t("Mark all as read")}</button><button class="link-btn" type="button" data-notif-clear>${t("Clear all")}</button></div>`
    : `<p class="muted">${t("No notifications yet. Pick some interests and we'll tell you when someone posts in them.")}</p>`;
}

function renderBell() {
  if (!db) return;
  const unread = state.notifications.filter((n) => !n.read).length;
  const badge = $("#bellCount");
  badge.hidden = !unread; badge.textContent = unread > 9 ? "9+" : String(unread);
  $("#bellBtn").setAttribute("aria-label", unread ? t("Notifications, {n} new", { n: unread }) : t("Notifications"));
  const panel = $("#bellPanel");
  if (!panel.hidden) { panel.innerHTML = `<h4>${t("Notifications")}</h4><div></div>`; renderNotifList(panel.lastElementChild); }
  renderNotifList($("#notifList"));
}
function toggleBell(open) {
  const panel = $("#bellPanel");
  panel.hidden = !open;
  $("#bellBtn").setAttribute("aria-expanded", String(open));
  if (open) renderBell();
}
$("#bellBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleBell($("#bellPanel").hidden); });
document.addEventListener("click", (e) => { if (!e.target.closest("#bellWrap")) toggleBell(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { toggleBell(false); $("#qSuggest").hidden = true; $("#mqSuggest").hidden = true; } });

async function markAllRead() {
  if (!state.notifications.some((n) => !n.read)) return;
  state.notifications.forEach((n) => (n.read = true));
  renderBell();
  try { await db.markNotificationsRead(); } catch { /* shown as read anyway */ }
}

// ---------------------------------------------------------------- contact the admins (FC-37)
const kindLabel = (k) => t(THREAD_KINDS[k] || k);
function threadCard(th, admin) {
  const last = th.messages[th.messages.length - 1];
  const waiting = th.status === "open" && last && !last.fromAdmin;
  const state_ = th.status === "closed" ? `<span class="pill soft">${t("Closed")}</span>`
    : waiting ? `<span class="pill warn">${t(admin ? "Needs a reply" : "Waiting for an admin")}</span>` : `<span class="pill ok">${t("Admin replied")}</span>`;
  return `<article class="thread" id="thread-${th.id}">
    <div class="post-head"><span class="tag">${esc(kindLabel(th.kind))}</span>${admin ? `<span>${esc(th.userName)}${th.userCountry ? " · " + esc(th.userCountry) : ""}</span><span>·</span>` : ""}<span>${timeAgo(th.updatedAt)}</span><span class="grow"></span>${state_}</div>
    <h3>${esc(th.subject)}</h3>
    <ol class="msgs">${th.messages.map((m) => `<li class="${m.fromAdmin ? "from-admin" : "from-student"}"><span class="who-said">${m.fromAdmin ? t("abroadboard team") : admin ? esc(th.userName) : t("You")} · ${timeAgo(m.createdAt)}</span><p>${esc(m.body)}</p></li>`).join("")}</ol>
    <form class="reply-form" data-reply="${th.id}" novalidate>
      <label class="sr-only" for="r${th.id}">${t("Write a reply")}</label>
      <textarea id="r${th.id}" maxlength="2000" placeholder="${t(admin ? "Write a reply to the student" : "Add to this conversation")}"></textarea>
      <div class="actions">${admin ? `<button class="btn btn-ghost btn-sm" type="button" data-thread-status="${th.id}:${th.status === "closed" ? "open" : "closed"}">${t(th.status === "closed" ? "Reopen" : "Mark as resolved")}</button>` : ""}
        <button class="btn btn-primary btn-sm" type="submit">${t(admin ? "Send reply" : "Send")}</button></div>
    </form>
  </article>`;
}

function renderContact() {
  const box = $("#contactBox");
  if (!box || !db) return;
  if (!state.user) {
    box.innerHTML = `<div class="panel"><h2>${t("Sign in to message the team")}</h2><p>${t("Messages are linked to your profile so we can reply to you here.")}</p>
      <div class="actions" style="justify-content:flex-start"><a class="btn btn-primary" href="#join" id="contactSignin">${t("Sign in")}</a></div></div>`;
    $("#contactSignin").onclick = () => { if (SIGNUP_CODE) { state.join.mode = "signin"; renderJoin(); } };
    return;
  }
  const mine = (state.threads || []).filter((x) => x.userId === state.user.id);
  box.innerHTML = `<form id="newThread" class="panel thread-new" novalidate>
      <h2>${t("New message")}</h2>
      <div class="row2">${field("tKind", "What is it about?", `<select id="tKind">${Object.entries(THREAD_KINDS).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join("")}</select>`)}
      ${field("tSubject", "Subject", `<input id="tSubject" maxlength="120" placeholder="${t("e.g. A post asked me for money")}">`)}</div>
      ${field("tBody", "Message", `<textarea id="tBody" maxlength="2000" placeholder="${t("Tell us what happened. If it's about a post, include its title.")}"></textarea>`)}
      <p class="err" id="tErr" hidden></p>
      <div class="actions"><button class="btn btn-primary" type="submit">${t("Send message")}</button></div>
    </form>
    <h2 class="sub-h">${t("Your messages")}</h2>
    ${state.errors.threads ? `<div class="error-box">${esc(t(state.errors.threads))}</div>` : ""}
    ${mine.length ? mine.map((x) => threadCard(x, false)).join("") : `<p class="muted">${t("You haven't sent any messages yet.")}</p>`}`;
  $("#newThread").onsubmit = async (e) => {
    e.preventDefault();
    const err = $("#tErr"), subject = $("#tSubject").value.trim(), body = $("#tBody").value.trim();
    if (!subject || !body) { err.textContent = t("Add a subject and a message."); err.hidden = false; return; }
    e.submitter && (e.submitter.disabled = true);
    try { await db.startThread($("#tKind").value, subject, body); toast("Message sent. We'll reply here."); await loadThreads(); }
    catch (ex) { err.textContent = t(ex.message); err.hidden = false; if (e.submitter) e.submitter.disabled = false; }
  };
}

// ---------------------------------------------------------------- admin page
function renderAdmin() {
  const box = $("#adminBox");
  if (!box || !db) return;
  const threads = state.threads || [];
  const needReply = threads.filter((x) => x.status === "open" && !x.messages[x.messages.length - 1]?.fromAdmin).length;
  const pending = state.categoryRequests.filter((r) => r.status === "pending");
  $("#adminTab").innerHTML = esc(t("Admin")) + (needReply + pending.length ? ` <span class="badge inline">${needReply + pending.length}</span>` : "");
  document.querySelectorAll("[data-admin-tab]").forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset.adminTab === state.adminTab));
    const n = b.dataset.adminTab === "messages" ? needReply : pending.length;
    b.innerHTML = esc(t(b.dataset.adminTab === "messages" ? "Messages" : "Category requests")) + (n ? ` <span class="badge inline">${n}</span>` : "");
  });
  if (!state.user?.isAdmin) { box.innerHTML = `<p class="empty">${t("Only admins can see this page.")}</p>`; return; }
  if (state.adminTab === "messages") {
    const sorted = [...threads].sort((a, b) => (a.status === "closed") - (b.status === "closed") || b.updatedAt - a.updatedAt);
    box.innerHTML = sorted.length ? sorted.map((x) => threadCard(x, true)).join("") : `<p class="empty">${t("No messages from students yet.")}</p>`;
  } else {
    const row = (r) => `<li class="req"><span><b>${esc(r.name)}</b> · ${esc(r.requesterName)}${r.reason ? `<br><span class="muted small">${esc(r.reason)}</span>` : ""}</span>
      <span class="req-btns">${r.status === "pending"
        ? `<button class="btn btn-primary btn-sm" data-cat-answer="${r.id}:approved">${t("Approve")}</button><button class="btn btn-ghost btn-sm" data-cat-answer="${r.id}:declined">${t("Decline")}</button>`
        : `<span class="pill ${r.status === "approved" ? "ok" : "soft"}">${t(r.status === "approved" ? "Approved" : "Declined")}</span>`}</span></li>`;
    const done = state.categoryRequests.filter((r) => r.status !== "pending");
    box.innerHTML = `<h2 class="sub-h">${t("Waiting for review")}</h2>
      ${pending.length ? `<ul class="requests">${pending.map(row).join("")}</ul>` : `<p class="muted">${t("No category requests waiting.")}</p>`}
      ${done.length ? `<h2 class="sub-h">${t("Answered")}</h2><ul class="requests">${done.map(row).join("")}</ul>` : ""}`;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-admin-tab]");
  if (b) { state.adminTab = b.dataset.adminTab; renderAdmin(); }
});
document.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-reply]");
  if (!f) return;
  e.preventDefault();
  const body = f.querySelector("textarea").value.trim();
  if (!body) return;
  const btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try { await db.replyThread(Number(f.dataset.reply), body); toast("Sent"); await loadThreads(); }
  catch (ex) { btn.disabled = false; toast(ex.message); }
});

// ---------------------------------------------------------------- campus map (FC-38)
let mapPlace = 0;
function renderMap() {
  const q = encodeURIComponent(MAP_PLACES[mapPlace].query);
  const frame = $("#mapFrame");
  const src = `https://maps.google.com/maps?q=${q}&z=16&hl=${getLang() === "zh" ? "zh-CN" : getLang()}&output=embed`;
  if (frame.getAttribute("src") !== src) frame.setAttribute("src", src);
  frame.title = t("Map of {place}", { place: t(MAP_PLACES[mapPlace].name) });
  $("#mapOpen").href = `https://www.google.com/maps/search/?api=1&query=${q}`;
  $("#mapPlaces").innerHTML = MAP_PLACES.map((p, i) => `<button type="button" class="chip" aria-pressed="${i === mapPlace}" data-place="${i}">${esc(t(p.name))}</button>`).join("");
}
$("#mapPlaces").addEventListener("click", (e) => {
  const b = e.target.closest("[data-place]");
  if (b) { mapPlace = Number(b.dataset.place); renderMap(); }
});

// ---------------------------------------------------------------- light / dark theme (FC-32)
const THEME_KEY = "abroadboard-theme";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");
function renderTheme() {
  const dark = currentTheme() === "dark";
  const b = $("#themeBtn");
  b.innerHTML = dark
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
  const label = t(dark ? "Switch to light theme" : "Switch to dark theme");
  b.setAttribute("aria-label", label); b.title = label;
  document.querySelector('meta[name="theme-color"]').content = dark ? "#1C0413" : "#45062E";
}
$("#themeBtn").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked */ }
  renderTheme();
});
darkQuery.addEventListener?.("change", renderTheme);

// ---------------------------------------------------------------- routing
function route() {
  const v = location.hash.slice(1);
  const post = /^post-(\d+)$/.exec(v);
  if (post) {
    // Link from a notification: show the board with that post in view.
    const id = Number(post[1]);
    const inMarket = state.market?.some((p) => p.id === id);
    if (!inMarket) Object.assign(state, { filter: "All", sport: "All", gender: "all", onlyMine: false, query: "" });
    else Object.assign(state, { marketFilter: "All", marketQuery: "" });
    $(inMarket ? "#mq" : "#q").value = "";
    state.jumpTo = id;
    showView(inMarket ? "market" : "board");
    if (inMarket) { renderMarket(); $(`#post-${id}`)?.scrollIntoView({ block: "center" }); state.jumpTo = null; }
    else renderBoard();
    if (state.jumpTo && state.posts) { toast("That post has expired or been removed."); state.jumpTo = null; }
    return;
  }
  showView(VIEWS.includes(v) ? v : "board");
}
function showView(view) {
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "view-" + view));
  document.querySelectorAll("nav.tabs a").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#post-")) window.scrollTo(0, 0); route(); });

// ---------------------------------------------------------------- language menu (FC-31)
function renderLang() {
  const sel = $("#langSel");
  sel.innerHTML = LANGS.map((l) => `<option value="${l.code}" lang="${l.html}"${l.code === getLang() ? " selected" : ""}>${l.label}</option>`).join("");
  sel.setAttribute("aria-label", t("Language"));
  $("#privacyPage").innerHTML = privacyNotice();
  renderTheme(); renderMap();
}
$("#langSel").addEventListener("change", (e) => {
  setLang(e.target.value);
  renderLang();
  if (dlg.open) dlg.close();
  if (db) { renderWho(); renderJoin(); rerenderLists(); renderContact(); renderAdmin(); renderBell(); }
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
      db.setAdmin(!state.user?.isAdmin); await refreshUser(); await loadMine(); toast(state.user?.isAdmin ? "Admin view on" : "Student view"); };
    $("#resetDemo").onclick = async () => { db.reset(); state.filter = "All"; state.marketFilter = "All"; toast("Demo data reset"); await loadAll(); };
  }
  db.onAuthChange(async () => { state.onlyMine = false; await refreshUser(); loadMine(); });
  await refreshUser();
  await loadAll();
  if (location.hash.startsWith("#post-")) route(); // a notification link opened in a new tab
  // Check for new notifications and messages every minute while signed in.
  setInterval(() => { if (state.user && !document.hidden) { loadNotifications(); loadThreads(); } }, 60000);
}
start();
