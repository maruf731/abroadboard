// English / 简体中文 switch. English text is the key: t("Sign in") returns the
// Chinese when Mandarin is on, and the English otherwise. Anything missing from
// ZH simply stays in English. Posts and events that students write are not translated.
//
// Static text in index.html is marked with data-i18n (inner HTML is the key)
// and data-i18n-attr="placeholder,aria-label" (the attribute's English value is the key).

const KEY = "abroadboard-lang";
let lang = "en";
try { if (localStorage.getItem(KEY) === "zh") lang = "zh"; } catch { /* storage blocked */ }

export const getLang = () => lang;
export const locale = () => (lang === "zh" ? "zh-CN" : "en-NZ");

const norm = (s) => String(s).replace(/\s+/g, " ").trim();

export function t(en, vars = {}) {
  const s = lang === "zh" ? (ZH[norm(en)] ?? en) : en;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function setLang(next) {
  lang = next === "zh" ? "zh" : "en";
  try { localStorage.setItem(KEY, lang); } catch { /* storage blocked */ }
  applyStatic();
}

// Translate every marked element in the page. Safe to call repeatedly.
export function applyStatic(root = document) {
  document.documentElement.lang = lang === "zh" ? "zh-Hans" : "en-NZ";
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;
    el.innerHTML = lang === "zh" ? (ZH[norm(el.dataset.en)] ?? el.dataset.en) : el.dataset.en;
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr.split(",").forEach((attr) => {
      const store = "en" + attr.replace(/(^|-)(\w)/g, (m, d, c) => c.toUpperCase());
      if (el.dataset[store] === undefined) el.dataset[store] = el.getAttribute(attr) || "";
      el.setAttribute(attr, t(el.dataset[store]));
    });
  });
}

const ZH = {
  // ---- header, nav, footer
  "Board": "留言板",
  "Events": "活动",
  "Campus tips": "校园指南",
  "Food &amp; budget": "美食与省钱",
  "Food & budget": "美食与省钱",
  "Join": "加入",
  "My account": "我的账户",
  "Sign in": "登录",
  "Sign out": "退出登录",
  "Signed out": "已退出登录",
  "Signed in as <b>{name}</b>": "已登录：<b>{name}</b>",
  "Sections": "栏目",
  "abroadboard home": "abroadboard 首页",
  "Privacy": "隐私",
  "Admin": "管理员",
  "Switch to admin view (demo)": "切换到管理员视图（演示）",
  "Switch to student view (demo)": "切换到学生视图（演示）",
  "Reset demo data": "重置演示数据",
  "Sign in first, then switch to admin view": "请先登录，再切换到管理员视图",
  "Admin view on": "已开启管理员视图",
  "Student view": "学生视图",
  "Demo data reset": "演示数据已重置",
  "abroadboard · ENGGEN 731 Group 7 · University of Auckland student project": "abroadboard · ENGGEN 731 第 7 组 · 奥克兰大学学生项目",
  "<b>Demo mode</b><span>Posts are saved only in this browser. Add your Supabase keys to <code>js/config.js</code> to go live.</span>":
    "<b>演示模式</b><span>帖子只保存在此浏览器中。在 <code>js/config.js</code> 中填入 Supabase 密钥即可上线。</span>",
  "Read this page in": "阅读语言",

  // ---- board page
  "Find your people in Auckland": "在奥克兰找到你的朋友",
  "This board is all about making connections for <b>international university students in Auckland</b>! Scroll down to see who is looking for a coffee buddy, study partner, or weekend explore group. Or hit <a href=\"#board\" data-new=\"post\"><b>New Post</b></a> to put yourself out there.":
    "这个留言板专为<b>在奥克兰读大学的国际学生</b>建立联系！向下滚动，看看谁在找咖啡搭子、学习伙伴或周末探索小组。也可以点击<a href=\"#board\" data-new=\"post\"><b>发帖</b></a>，主动认识新朋友。",
  "Want to trade gear, find local events, get tips to navigate campus, or grab cheap eats? Use the top menu to jump straight to our <a href=\"#events\"><b>Events</b></a>, <a href=\"#market\"><b>Buy &amp; Sell</b></a>, <a href=\"#campus\"><b>Campus Tips</b></a>, and <a href=\"#food\"><b>Food &amp; Budget</b></a> boards!":
    "想交换二手物品、发现本地活动、了解校园攻略，或者找便宜好吃的？用顶部菜单直接进入<a href=\"#events\"><b>活动</b></a>、<a href=\"#market\"><b>买卖</b></a>、<a href=\"#campus\"><b>校园指南</b></a>和<a href=\"#food\"><b>美食与省钱</b></a>版块！",
  "+ New post": "+ 发帖",
  "Search posts": "搜索帖子",
  "Filter by category": "按类别筛选",
  "Loading posts…": "正在加载帖子…",
  "Local sponsor": "本地赞助商",
  "Your business here": "您的广告位",
  "Reach international students near campus. Banner slot, $200/month.": "触达校园附近的国际学生。横幅广告位，每月 $200。",
  "How the board works": "使用说明",
  "Only student emails from <a href=\"#join\">accepted Auckland institutions</a> can post.": "只有<a href=\"#join\">认可的奥克兰院校</a>的学生邮箱才能发帖。",
  "Posts are removed automatically after 21 days.": "帖子会在 21 天后自动删除。",
  "See something off? Tap <b>Report</b> and an admin will check it.": "看到不妥的内容？点击<b>举报</b>，管理员会处理。",
  "On the board now": "留言板概况",
  "Active posts": "当前帖子",
  "Upcoming events": "即将举行的活动",
  "Expiring in 3 days": "3 天内到期",
  "Reported posts to review": "待审核的举报",
  "All": "全部",
  "Meetups": "聚会",
  "Housing": "住房",
  "Buy & sell": "买卖",
  "Study buddies": "学习伙伴",
  "Help": "求助",
  "Tip": "小贴士",
  "Couldn't load posts.": "无法加载帖子。",
  "No posts match that. Try another category or search.": "没有符合条件的帖子。换个类别或关键词试试。",
  "No posts yet. Be the first to post!": "还没有帖子，来发第一帖吧！",
  "Advertisement": "广告",
  "Google AdSense slot": "Google AdSense 广告位",
  "Report": "举报",
  "Reported ×{n}": "被举报 ×{n}",
  "Clear reports": "清除举报",
  "Reported · admin notified": "已举报 · 已通知管理员",
  "Expires within a day": "一天内到期",
  "Expires in {n} days": "{n} 天后到期",
  "Delete": "删除",
  "Confirm delete": "确认删除",
  "Cancel": "取消",
  "Deleted": "已删除",
  "just now": "刚刚",
  "{n} min ago": "{n} 分钟前",
  "{n} h ago": "{n} 小时前",
  "yesterday": "昨天",
  "{n} days ago": "{n} 天前",
  "Sign in to report a post": "登录后才能举报",
  "Thanks. An admin will review this post.": "谢谢，管理员会审核这条帖子。",
  "Reports cleared": "举报已清除",

  // ---- events page
  "Local events": "本地活动",
  "Things happening around Auckland that are good for meeting people.": "奥克兰各地适合交朋友的活动。",
  "+ Post an event": "+ 发布活动",
  "<b>$5 NZD</b> per event listing. Fees help keep abroadboard free for everyone else.": "每条活动 <b>5 新西兰元</b>。这笔费用让 abroadboard 对其他人保持免费。",
  "Loading events…": "正在加载活动…",
  "Couldn't load events.": "无法加载活动。",
  "No upcoming events yet. Post the first one.": "暂时没有活动，来发布第一个吧。",
  "Waiting for payment": "等待付款",
  "hosted by {name}": "发起人：{name}",

  // ---- campus page
  "Getting around campus": "校园出行指南",
  "Five things we wish someone had told us in our first week at the City Campus.": "我们希望在城市校区第一周就有人告诉我们的五件事。",
  "Campus map placeholder": "校园地图占位",
  "Campus map goes here": "校园地图放在这里",
  "Add the official University of Auckland City Campus map with key buildings marked.": "请添加标注了主要建筑的奥克兰大学城市校区官方地图。",
  "<h3>Read room codes as building-room</h3><p>A room like <code class=\"room\">260-115</code> means building 260, room 115. Find the building number first, then the room.</p>":
    "<h3>教室编号是“楼号-房间号”</h3><p>例如 <code class=\"room\">260-115</code> 表示 260 号楼的 115 室。先找楼，再找房间。</p>",
  "<h3>Get an AT HOP card</h3><p>Auckland buses, trains and ferries use AT HOP. Apply for the tertiary concession to pay less per trip.</p>":
    "<h3>办一张 AT HOP 卡</h3><p>奥克兰的公交、火车和渡轮都用 AT HOP 卡。申请大学生优惠，每次出行更便宜。</p>",
  "<h3>Leave ten minutes between classes</h3><p>The campus sits on a hill and some buildings are a steep walk apart. Plan back-to-back classes with that in mind.</p>":
    "<h3>课与课之间留出十分钟</h3><p>校园建在山坡上，有些楼之间要走一段陡坡。安排连堂课时要考虑这一点。</p>",
  "<h3>Find a study spot early</h3><p>The General Library and Kate Edger Information Commons fill up fast in exam season. Pick a backup spot in week one.</p>":
    "<h3>尽早找好自习地点</h3><p>考试季总图书馆和 Kate Edger 信息共享空间很快就满。第一周就选好备用地点。</p>",
  "<h3>Use Albert Park as your meeting point</h3><p>It's right next to campus and easy to find, which makes it a good default when meeting someone from the board.</p>":
    "<h3>把 Albert Park 当作碰头地点</h3><p>它就在校园旁边，很好找，和留言板上认识的人见面时很合适。</p>",

  // ---- food page
  "Food &amp; budget tips": "美食与省钱小贴士",
  "Cheap, filling and actually nutritious. Share what you've found.": "便宜、管饱、还有营养。分享你的发现。",
  "+ Share a tip": "+ 分享小贴士",
  "Loading tips…": "正在加载小贴士…",
  "Couldn't load tips.": "无法加载小贴士。",
  "No tips yet. Share the first one.": "还没有小贴士，来分享第一条吧。",

  // ---- join / account
  "Your account": "你的账户",
  "Signed in as <b>{email}</b>{admin}. This name shows on your posts.": "已登录：<b>{email}</b>{admin}。下面的名字会显示在你的帖子上。",
  "(admin)": "（管理员）", // looked up trimmed, as " (admin)"
  "Display name": "显示名称",
  "Home country": "家乡国家",
  "Optional": "选填",
  "Save": "保存",
  "Saved": "已保存",
  "Join abroadboard": "加入 abroadboard",
  "Use your student email from an Auckland university or college. We'll email you a sign-in link, so there's no password to remember.":
    "请使用你在奥克兰大学或学院的学生邮箱。我们会发送登录链接，无需记住密码。",
  "Student email": "学生邮箱",
  "e.g. Mei": "例如 Mei",
  "Accepted student emails ({n} institutions)": "认可的学生邮箱（{n} 所院校）",
  "or": " 或 ", // looked up trimmed, as " or "
  "Privacy notice": "隐私声明",
  "I have read the privacy notice and agree to abroadboard collecting and using my information as described.":
    "我已阅读隐私声明，并同意 abroadboard 按上述方式收集和使用我的信息。",
  "Sending…": "发送中…",
  "I agree, send my sign-in link": "我同意，发送登录链接",
  "That email isn't from an accepted institution. Open the list under the email box to see which addresses work.":
    "这个邮箱不属于认可的院校。展开邮箱输入框下方的列表，查看可以使用的邮箱。",
  "Tick the box to agree to the privacy notice before joining.": "加入前请勾选同意隐私声明。",
  "Check your inbox": "请查收邮件",
  "We sent a 6-digit code to <b>{email}</b>. <br><span class='muted'>Demo mode: any 6 digits will work.</span>":
    "我们已向 <b>{email}</b> 发送 6 位验证码。<br><span class='muted'>演示模式：任意 6 位数字都可以。</span>",
  "We sent an email to <b>{email}</b>. <b>Open it and click the sign-in link</b>, and you'll come back here signed in. It can take a minute and may land in junk mail.":
    "我们已向 <b>{email}</b> 发送邮件。<b>打开邮件并点击登录链接</b>，你会回到这里并自动登录。邮件可能需要一分钟，也可能被归入垃圾邮件。",
  "Verification code": "验证码",
  "Got a 6-digit code instead? Enter it here": "收到的是 6 位验证码？在这里输入",
  "Use a different email": "换一个邮箱",
  "Checking…": "验证中…",
  "Verify and join": "验证并加入",
  "Enter the 6-digit code from the email.": "请输入邮件中的 6 位验证码。",
  "Email verified. Welcome to abroadboard!": "邮箱已验证，欢迎加入 abroadboard！",
  "Sign in with your student email to post": "请用学生邮箱登录后再发帖",

  // ---- dialogs
  "New post": "发帖",
  "<b>What to include:</b> what you're looking for, when and where, and the best way to reach you. Never share your home address or passport details.":
    "<b>建议写明：</b>你在找什么、时间地点，以及最好的联系方式。不要公开家庭住址或护照信息。",
  "Title": "标题",
  "e.g. Looking for badminton partners": "例如：找羽毛球搭子",
  "Category": "类别",
  "Other…": "其他…",
  "Custom category": "自定义类别",
  "e.g. Sports": "例如：运动",
  "Details": "详细内容",
  "How to contact you": "联系方式",
  "Shown publicly on your post": "会公开显示在你的帖子上",
  "Post an event": "发布活动",
  "Event name": "活动名称",
  "Date": "日期",
  "Where": "地点",
  "Short description": "简短介绍",
  "Event listing": "活动发布费",
  "Total (NZD)": "合计（新西兰元）",
  "Test payment: no money is taken yet. Stripe (test mode) can be connected in a later sprint.": "测试付款：目前不会真的扣款。之后可接入 Stripe（测试模式）。",
  "Share a food tip": "分享美食小贴士",
  "Place or idea": "地点或点子",
  "e.g. $6 bento near the Quad": "例如：Quad 附近 $6 的便当",
  "Why it's good": "推荐理由",
  "Rough cost": "大概花费",
  "e.g. ~$8": "例如：约 $8",
  "Pay ${fee} and publish": "支付 ${fee} 并发布",
  "Publish": "发布",
  "Fill in every field before publishing.": "发布前请填写所有内容。",
  "Type a custom category or pick one from the list.": "请输入自定义类别，或从列表中选择。",
  "Published to the board": "已发布到留言板",
  "Pick today or a date in the future.": "请选择今天或以后的日期。",
  "Event published": "活动已发布",
  "Tip shared": "小贴士已分享",

  // ---- Buy & sell
  "Buy &amp; sell": "买卖",
  "Pass on what you don't need and pick up what you do from students near you. Save money, earn a little, and keep good stuff out of landfill.": "把用不上的东西转给身边的同学，也能淘到你需要的。省钱、赚点零花钱，还能让好东西不被浪费。",
  "+ Sell something": "+ 出售物品",
  "Sell something": "出售物品",
  "Loading listings…": "正在加载物品…",
  "Search items": "搜索物品",
  "Couldn't load listings.": "无法加载物品。",
  "Nothing matches that. Try another category or search.": "没有符合条件的物品，换个类别或关键词试试。",
  "Nothing for sale yet. List the first item!": "还没有出售的物品，来发布第一件吧！",
  "Items for sale": "在售物品",
  "Ask": "面议",
  "Furniture": "家具",
  "Electronics": "电子产品",
  "Books & study": "书籍与学习用品",
  "Kitchen": "厨房用品",
  "Clothing": "衣物",
  "Bikes & transport": "自行车与交通",
  "Other": "其他",
  "New": "全新",
  "Like new": "几乎全新",
  "Good": "良好",
  "Fair": "一般",
  "<b>Tip:</b> a clear photo and an honest condition sell faster. Meet in a public place on or near campus.": "<b>小提示：</b>清晰的照片和如实的成色描述更容易卖出。请在校园内或附近的公共场所见面交易。",
  "What are you selling?": "你要卖什么？",
  "e.g. IKEA desk, white, 120 cm": "例如：IKEA 书桌，白色，120 厘米",
  "Condition": "成色",
  "Price": "价格",
  "e.g. $40, or Free": "例如：$40，或“免费”",
  "Size, age, pick-up area, when you're free": "尺寸、用了多久、取货地点、你什么时候有空",
  "Add a price, or write Free.": "请填写价格，或写“免费”。",
  "Your item is listed": "你的物品已上架",

  // ---- who a post is for
  "Who is this for? (optional)": "适合谁？（可选）",
  "For:": "适合：",
  "Gender": "性别",
  "Anyone": "不限",
  "Women": "女生",
  "Men": "男生",
  "Non-binary people": "非二元性别者",
  "Heavy or light sleeper": "睡眠深浅",
  "Any": "不限",
  "Light sleepers": "浅睡眠者",
  "Heavy sleepers": "深睡眠者",
  "Anything else": "其他要求",
  "e.g. non-smoker, vegetarian, pet-friendly": "例如：不吸烟、素食、可养宠物",

  // ---- private contact details
  "How should people contact you?": "别人如何联系你？",
  "Your details stay hidden. People tap “Request contact details” and you choose who sees them.": "你的联系方式会被隐藏。别人点击“申请联系方式”后，由你决定给谁看。",
  "Email": "邮箱",
  "Mobile": "手机",
  "Social media": "社交媒体",
  "e.g. 021 123 4567": "例如：021 123 4567",
  "e.g. Instagram @mei.akl or WeChat ID": "例如：Instagram @mei.akl 或微信号",
  "Pick at least one way for people to contact you.": "请至少选择一种联系方式。",
  "Fill in the contact details you ticked.": "请填写你勾选的联系方式。",
  "That email address doesn't look right.": "这个邮箱地址格式不对。",
  "Contact by:": "联系方式：",
  "Request contact details": "申请联系方式",
  "Sign in to request contact details": "登录后申请联系方式",
  "Sign in to request contact details.": "登录后申请联系方式。",
  "Request sent. Waiting for {name} to share.": "申请已发送，等待 {name} 分享。",
  "{name} didn't share their details for this post.": "{name} 没有分享这条帖子的联系方式。",
  "<b>{name}</b> asked for your contact details": "<b>{name}</b> 申请查看你的联系方式",
  "Share": "分享",
  "Decline": "拒绝",
  "Shared with {n} people": "已分享给 {n} 人",
  "Shared with 1 person": "已分享给 1 人",
  "No requests yet. Your details stay hidden until you share them.": "还没有人申请。在你分享之前，联系方式一直是隐藏的。",
  "Request sent": "申请已发送",
  "Details shared": "联系方式已分享",
  "Request declined": "已拒绝申请",

  // ---- photos
  "Photos (optional)": "照片（可选）",
  "+ Add photos": "+ 添加照片",
  "Up to {n} photos, .jpg or .jpeg, {mb} MB each.": "最多 {n} 张，.jpg 或 .jpeg 格式，每张不超过 {mb} MB。",
  "{n} of {max} added": "已添加 {n}/{max} 张",
  "Remove photo": "删除照片",
  "Open photo {n}": "查看第 {n} 张照片",
  "Photo": "照片",
  "Close": "关闭",
  "Next photo": "下一张",
  "You can add up to {n} photos.": "最多只能添加 {n} 张照片。",
  "Each photo must be {n} MB or smaller.": "每张照片不能超过 {n} MB。",
  "Each photo must be 5 MB or smaller.": "每张照片不能超过 5 MB。",
  "Photos must be .jpg or .jpeg files.": "照片必须是 .jpg 或 .jpeg 格式。",
  "Publishing…": "发布中…",
  "<b>What to include:</b> what you're looking for, when and where. Never share your home address or passport details.": "<b>建议写明：</b>你在找什么、时间和地点。请不要透露家庭住址或护照信息。",

  // ---- Auckland confirmation and sign-in code
  "Where in Auckland do you study?": "你在奥克兰哪个区域上学？",
  "Choose your campus area": "选择你的校区所在区域",
  "Auckland CBD (city centre)": "奥克兰市中心 (CBD)",
  "Grafton / Newmarket": "Grafton / Newmarket",
  "North Shore (Albany, Takapuna)": "北岸 (Albany、Takapuna)",
  "West Auckland (Henderson, Mt Albert)": "西奥克兰 (Henderson、Mt Albert)",
  "South Auckland (Manukau, Ōtāhuhu)": "南奥克兰 (Manukau、Ōtāhuhu)",
  "East Auckland (Botany, Howick)": "东奥克兰 (Botany、Howick)",
  "I confirm that I am currently studying at an institution in Auckland, New Zealand.": "我确认我目前在新西兰奥克兰的院校就读。",
  "Choose the area of Auckland you study in.": "请选择你在奥克兰就读的区域。",
  "Tick the box to confirm you study in Auckland.": "请勾选确认你在奥克兰就读。",
  "Confirm you study in Auckland": "确认你在奥克兰就读",
  "abroadboard is only for students in Auckland. Confirm this once to post, sell and request contact details.": "abroadboard 只面向奥克兰的学生。确认一次后即可发帖、出售物品和申请联系方式。",
  "Confirm": "确认",
  "Confirmed": "已确认",
  "Studying in Auckland: <b>{campus}</b>": "在奥克兰就读：<b>{campus}</b>",
  "Thanks, you're all set to post": "谢谢，现在可以发帖了",
  "Confirm that you study in Auckland (on your account page) before posting.": "发帖前请先（在账户页面）确认你在奥克兰就读。",
  "Use your student email from an Auckland university or college. We'll email you a one-time code to type in here, so there's no password to remember.": "请使用奥克兰大学或学院的学生邮箱。我们会把一次性验证码发到你的邮箱，在这里输入即可，无需记密码。",
  "Email me a sign-in code": "把登录验证码发到我的邮箱",
  "Enter your code": "输入验证码",
  "We emailed a sign-in code to <b>{email}</b>. Type it below to sign in. It can take a minute to arrive and may land in junk mail.": "我们已把登录验证码发送到 <b>{email}</b>。请在下方输入以登录。邮件可能需要一分钟左右，也可能在垃圾邮件中。",
  "Demo mode: any 6 digits will work.": "演示模式：任意 6 位数字都可以。",
  "Sign-in code": "登录验证码",
  "Didn't get it?": "没收到？",
  "Send a new code": "重新发送验证码",
  "We sent a new code": "新的验证码已发送",
  "Enter the code from the email (6 digits or more).": "请输入邮件中的验证码（6 位或以上数字）。",

  // ---- errors from js/data.js
  "The site couldn't start.": "网站无法启动。",
  "Use your student email from one of the Auckland institutions listed below.": "请使用下方所列奥克兰院校的学生邮箱。",
  "Only signed-in students with an accepted student email can do that.": "只有用认可的学生邮箱登录的学生才能这样做。",
  "Too many attempts. Wait a minute and try again.": "尝试次数过多，请稍等一分钟再试。",
  "That code is wrong or has expired. Request a new code and try again.": "验证码错误或已过期，请重新获取后再试。",
  "We couldn't send the email. The site's email service isn't set up yet (see README, step 4).": "邮件发送失败，网站的邮件服务尚未设置（见 README 第 4 步）。",
  "New sign-ups are switched off at the moment.": "目前暂停新用户注册。",
  "Can't reach the server. Check your internet connection and try again.": "无法连接服务器，请检查网络后重试。",
  "One of the fields is too long or empty. Shorten it and try again.": "有内容过长或为空，请修改后重试。",
  "Sign in with your student email first.": "请先用学生邮箱登录。",
  "You can only delete your own posts.": "你只能删除自己的帖子。",
  "You can only delete events you posted.": "你只能删除自己发布的活动。",
  "Privacy notice page": "隐私声明页面",
};
