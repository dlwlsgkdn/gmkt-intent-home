// Paste this entire file into the Figma MCP `use_figma` tool.
// Target file used during this run: 6wlsRxCPmVLQg5L2mzUvM1
// It creates an editable component breakdown for gmarket-advanced-clean-home
// using the actual clean beauty mockup tokens and copy from the local codebase.

const RUN_ID = "gmkt-clean-home-breakdown-v1";
const PAGE_NAME = "gmarket-advanced-clean-home / component breakdown";

function rgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

function solid(hex, opacity = 1) {
  return { type: "SOLID", color: rgb(hex), opacity };
}

function shadow(y = 18, blur = 48, opacity = 0.14) {
  return [{
    type: "DROP_SHADOW",
    color: { r: 31 / 255, g: 41 / 255, b: 51 / 255, a: opacity },
    offset: { x: 0, y },
    radius: blur,
    spread: -24,
    visible: true,
    blendMode: "NORMAL",
  }];
}

const token = {
  ink: "#1f2933",
  muted: "#7b8490",
  soft: "#f6f8fa",
  paper: "#ffffff",
  line: "#d9e0e8",
  rose: "#6f8399",
  plum: "#34465a",
  blush: "#eef3f7",
  slate100: "#f1f5f9",
  red: "#d94c52",
  high: "#b94a48",
  medium: "#b9795f",
  low: "#5f7465",
};

const createdNodeIds = [];
const mutatedNodeIds = [];

async function chooseFonts() {
  const fonts = await figma.listAvailableFontsAsync();
  const families = new Set(fonts.map((f) => f.fontName.family));
  const family = families.has("Pretendard") ? "Pretendard" : families.has("Inter") ? "Inter" : fonts[0].fontName.family;
  const styles = fonts.filter((f) => f.fontName.family === family).map((f) => f.fontName.style);
  function pick(candidates) {
    return candidates.find((s) => styles.includes(s)) || styles[0] || "Regular";
  }
  const regular = pick(["Regular", "Book", "Light"]);
  const medium = pick(["Medium", "Semi Bold", "Semibold", "Regular"]);
  const bold = pick(["Bold", "Semi Bold", "Semibold", "Medium"]);
  await Promise.all([
    figma.loadFontAsync({ family, style: regular }),
    figma.loadFontAsync({ family, style: medium }),
    figma.loadFontAsync({ family, style: bold }),
  ]);
  return { family, regular, medium, bold };
}

const font = await chooseFonts();

function tag(node, key, phase = "breakdown") {
  node.setSharedPluginData("dsb", "run_id", RUN_ID);
  node.setSharedPluginData("dsb", "phase", phase);
  node.setSharedPluginData("dsb", "key", key);
  return node;
}

function setFrame(node, name, x, y, w, h, fill = token.paper) {
  node.name = name;
  node.x = x;
  node.y = y;
  node.resize(w, h);
  node.fills = [solid(fill)];
  return node;
}

function text(characters, opts = {}) {
  const t = figma.createText();
  t.name = opts.name || characters.slice(0, 40);
  t.fontName = { family: font.family, style: opts.style || font.regular };
  t.fontSize = opts.size || 14;
  t.lineHeight = opts.lineHeight ? { unit: "PIXELS", value: opts.lineHeight } : { unit: "AUTO" };
  t.letterSpacing = { unit: "PIXELS", value: 0 };
  t.fills = [solid(opts.color || token.ink, opts.opacity || 1)];
  t.characters = characters;
  if (opts.width) t.resize(opts.width, opts.height || Math.max(24, (opts.size || 14) * 1.5));
  if (opts.align) t.textAlignHorizontal = opts.align;
  createdNodeIds.push(t.id);
  return t;
}

function line(w, color = token.line, opacity = 1) {
  const r = figma.createRectangle();
  r.name = "Divider";
  r.resize(w, 1);
  r.fills = [solid(color, opacity)];
  createdNodeIds.push(r.id);
  return r;
}

function pill(label, state = "Default") {
  const c = figma.createComponent();
  c.name = `State=${state}`;
  c.layoutMode = "HORIZONTAL";
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  c.counterAxisAlignItems = "CENTER";
  c.primaryAxisAlignItems = "CENTER";
  c.paddingLeft = 12;
  c.paddingRight = 12;
  c.resize(100, 34);
  c.cornerRadius = 999;
  c.strokes = [solid(state === "Hover" ? token.rose : token.plum, state === "Hover" ? 0.5 : 0.16)];
  c.strokeWeight = 1;
  c.fills = [solid(state === "Hover" ? "#f5f8fb" : token.paper, 0.82)];
  const labelNode = text(label, { size: 13, style: font.medium, color: state === "Hover" ? token.ink : token.plum });
  c.appendChild(labelNode);
  labelNode.layoutSizingHorizontal = "HUG";
  labelNode.layoutSizingVertical = "HUG";
  tag(c, `component/tag-chip/${state}`, "components");
  createdNodeIds.push(c.id);
  return c;
}

function iconButton(label, iconText, state = "Default") {
  const c = figma.createComponent();
  c.name = `State=${state}`;
  c.layoutMode = "HORIZONTAL";
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.counterAxisAlignItems = "CENTER";
  c.primaryAxisAlignItems = "CENTER";
  c.resize(44, 44);
  c.cornerRadius = 999;
  c.fills = [solid(state === "Active" ? token.ink : "#d8dee6")];
  c.strokes = [solid(token.ink, 0.12)];
  c.strokeWeight = 1;
  const mark = text(iconText, { name: label, size: 18, style: font.medium, color: token.paper, align: "CENTER" });
  mark.resize(24, 24);
  c.appendChild(mark);
  tag(c, `component/icon-button/${label}/${state}`, "components");
  createdNodeIds.push(c.id);
  return c;
}

function button(label, style = "Primary", state = "Default", width = 180) {
  const c = figma.createComponent();
  c.name = `Style=${style}, State=${state}`;
  c.layoutMode = "HORIZONTAL";
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.counterAxisAlignItems = "CENTER";
  c.primaryAxisAlignItems = "CENTER";
  c.paddingLeft = 18;
  c.paddingRight = 18;
  c.itemSpacing = 8;
  c.resize(width, 50);
  c.cornerRadius = 6;
  const isGhost = style === "Ghost";
  c.fills = [solid(isGhost ? token.paper : state === "Disabled" ? token.line : token.ink, isGhost ? 0.7 : 1)];
  c.strokes = [solid(token.ink, isGhost ? 0.18 : 0.9)];
  c.strokeWeight = 1;
  c.opacity = state === "Disabled" ? 0.45 : 1;
  const labelNode = text(label, { size: 14, style: font.medium, color: isGhost ? token.ink : token.paper });
  c.appendChild(labelNode);
  tag(c, `component/button/${style}/${state}`, "components");
  createdNodeIds.push(c.id);
  return c;
}

function infoCard(title, sub, state = "Default") {
  const c = figma.createComponent();
  c.name = `State=${state}`;
  c.layoutMode = "VERTICAL";
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.counterAxisAlignItems = "MIN";
  c.primaryAxisAlignItems = "CENTER";
  c.paddingLeft = 17;
  c.paddingRight = 17;
  c.paddingTop = 16;
  c.paddingBottom = 16;
  c.itemSpacing = 6;
  c.resize(176, 78);
  c.cornerRadius = 6;
  c.fills = [solid(state === "Selected" ? token.paper : token.paper, state === "Selected" ? 1 : 0.58)];
  c.strokes = [solid(state === "Selected" ? token.ink : token.plum, state === "Selected" ? 1 : 0.15)];
  c.strokeWeight = state === "Selected" ? 1.5 : 1;
  c.appendChild(text(title, { size: 15, style: font.medium, color: token.ink }));
  c.appendChild(text(sub, { size: 12, style: font.regular, color: token.muted }));
  tag(c, `component/info-card/${state}`, "components");
  createdNodeIds.push(c.id);
  return c;
}

function imageHashInventory() {
  const out = [];
  for (const page of figma.root.children) {
    const stack = [...page.children];
    while (stack.length) {
      const n = stack.pop();
      if ("children" in n) stack.push(...n.children);
      if (Array.isArray(n.fills)) {
        const imageFill = n.fills.find((f) => f.type === "IMAGE" && f.imageHash);
        if (imageFill) out.push({ name: n.name, hash: imageFill.imageHash, width: n.width, height: n.height });
      }
    }
  }
  return out;
}

const images = imageHashInventory();
function findImageHash(needle, fallbackIndex = 0) {
  const exact = images.find((i) => i.name.includes(needle));
  return exact?.hash || images[fallbackIndex]?.hash || null;
}

function imageRect(name, w, h, hash, radius = 6) {
  const r = figma.createRectangle();
  r.name = name;
  r.resize(w, h);
  r.cornerRadius = radius;
  r.fills = hash ? [{ type: "IMAGE", imageHash: hash, scaleMode: "FILL" }] : [solid(token.blush)];
  createdNodeIds.push(r.id);
  return r;
}

function storyCard(kind, title, eyebrow, desc, hash, w, h, feature = false) {
  const c = figma.createComponent();
  c.name = `Type=${kind}`;
  c.resize(w, h);
  c.clipsContent = true;
  c.cornerRadius = 0;
  c.fills = [solid(token.blush)];
  const img = imageRect("media", w, h, hash, 0);
  c.appendChild(img);
  const overlay = figma.createRectangle();
  overlay.name = "gradient overlay";
  overlay.resize(w, h);
  overlay.fills = [{
    type: "GRADIENT_LINEAR",
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { ...rgb(token.ink), a: 0.02 } },
      { position: 0.72, color: { ...rgb(token.ink), a: 0.42 } },
      { position: 1, color: { ...rgb(token.ink), a: 0.74 } },
    ],
  }];
  c.appendChild(overlay);
  const body = figma.createFrame();
  body.name = "copy";
  body.x = 18;
  body.y = h - (feature ? 108 : 64);
  body.resize(w - 36, feature ? 90 : 46);
  body.layoutMode = "VERTICAL";
  body.primaryAxisSizingMode = "AUTO";
  body.counterAxisSizingMode = "FIXED";
  body.itemSpacing = 6;
  body.fills = [];
  body.appendChild(text(eyebrow, { size: 11, style: font.medium, color: "#edf2f7", opacity: 0.78 }));
  body.appendChild(text(title, { size: feature ? 28 : 18, style: font.medium, color: token.paper, lineHeight: feature ? 34 : 22, width: w - 36 }));
  if (desc) body.appendChild(text(desc, { size: 13, style: font.regular, color: token.paper, opacity: 0.76, width: w - 36 }));
  c.appendChild(body);
  tag(c, `component/story-card/${kind}`, "components");
  createdNodeIds.push(c.id);
  return c;
}

function productCard(state = "Default", hash = null) {
  const c = figma.createComponent();
  c.name = `State=${state}`;
  c.layoutMode = "VERTICAL";
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.resize(224, 338);
  c.cornerRadius = 6;
  c.clipsContent = true;
  c.fills = [solid(token.paper, 0.76)];
  c.strokes = [solid(state === "In Cart" ? token.ink : token.plum, state === "In Cart" ? 1 : 0.13)];
  c.strokeWeight = 1;
  const img = imageRect("product image", 224, 176, hash, 0);
  c.appendChild(img);
  const body = figma.createFrame();
  body.name = "body";
  body.layoutMode = "VERTICAL";
  body.primaryAxisSizingMode = "AUTO";
  body.counterAxisSizingMode = "FIXED";
  body.resize(224, 160);
  body.paddingLeft = 16;
  body.paddingRight = 16;
  body.paddingTop = 16;
  body.paddingBottom = 16;
  body.itemSpacing = 10;
  body.fills = [];
  body.appendChild(text("AI 매칭 베이스 쿠션", { size: 14, style: font.medium, color: token.ink, width: 180 }));
  body.appendChild(text("32,900원", { size: 18, style: font.medium, color: token.plum }));
  const row = figma.createFrame();
  row.name = "actions";
  row.layoutMode = "HORIZONTAL";
  row.primaryAxisSizingMode = "AUTO";
  row.counterAxisSizingMode = "FIXED";
  row.itemSpacing = 8;
  row.fills = [];
  const detail = button("상세보기", "Primary", "Default", 106);
  detail.resize(106, 38);
  const cart = button(state === "In Cart" ? "담았어요" : "담기", state === "External" ? "Ghost" : "Ghost", state === "External" ? "Disabled" : "Default", 74);
  cart.resize(74, 38);
  row.appendChild(detail.createInstance());
  row.appendChild(cart.createInstance());
  body.appendChild(row);
  c.appendChild(body);
  tag(c, `component/product-card/${state}`, "components");
  createdNodeIds.push(c.id);
  return c;
}

function modalCard(type = "Keyword") {
  const c = figma.createComponent();
  c.name = `Type=${type}`;
  c.layoutMode = "VERTICAL";
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  c.resize(type === "Ingredient" ? 720 : 460, 100);
  c.paddingTop = 24;
  c.paddingBottom = 24;
  c.paddingLeft = 24;
  c.paddingRight = 24;
  c.itemSpacing = 16;
  c.cornerRadius = 6;
  c.fills = [solid(token.paper, 0.96)];
  c.strokes = [solid(token.plum, 0.14)];
  c.effects = shadow(24, 70, 0.16);
  const head = figma.createFrame();
  head.name = "head";
  head.layoutMode = "HORIZONTAL";
  head.primaryAxisSizingMode = "FIXED";
  head.counterAxisSizingMode = "AUTO";
  head.primaryAxisAlignItems = "SPACE_BETWEEN";
  head.counterAxisAlignItems = "CENTER";
  head.resize(type === "Ingredient" ? 672 : 412, 24);
  head.fills = [];
  head.appendChild(text(type === "Ingredient" ? "Ingredient Alert" : "Keyword", { size: 10, style: font.medium, color: token.muted }));
  head.appendChild(text("x", { size: 16, style: font.medium, color: token.muted }));
  c.appendChild(head);
  c.appendChild(text(type === "Ingredient" ? "위험 성분 알림" : "키워드 설명", { size: 24, style: font.medium, color: token.ink }));
  c.appendChild(text(type === "Ingredient" ? "민감 피부가 먼저 확인하면 좋은 성분만 따로 모았어요." : "선택한 키워드가 플랜에서 어떤 의미인지 요약합니다.", { size: 14, style: font.regular, color: token.muted, width: type === "Ingredient" ? 640 : 380, lineHeight: 22 }));
  if (type === "Ingredient") {
    ["에탄올/변성알코올   High", "멘톨/강한 쿨링 성분   Medium", "판테놀/세라마이드/시카   Low"].forEach((row) => {
      const item = figma.createFrame();
      item.name = "table row";
      item.layoutMode = "HORIZONTAL";
      item.primaryAxisSizingMode = "FIXED";
      item.counterAxisSizingMode = "AUTO";
      item.primaryAxisAlignItems = "SPACE_BETWEEN";
      item.resize(640, 34);
      item.fills = [solid(token.soft)];
      item.cornerRadius = 4;
      item.paddingLeft = 12;
      item.paddingRight = 12;
      item.appendChild(text(row, { size: 12, style: font.regular, color: token.plum }));
      c.appendChild(item);
    });
  }
  tag(c, `component/modal-card/${type}`, "components");
  createdNodeIds.push(c.id);
  return c;
}

function planChat() {
  const c = figma.createComponent();
  c.name = "Plan AI Chat";
  c.layoutMode = "VERTICAL";
  c.primaryAxisSizingMode = "AUTO";
  c.counterAxisSizingMode = "FIXED";
  c.resize(360, 100);
  c.cornerRadius = 24;
  c.clipsContent = true;
  c.fills = [solid(token.paper, 0.94)];
  c.strokes = [solid(token.plum, 0.14)];
  c.effects = shadow(24, 70, 0.16);
  const header = figma.createFrame();
  header.name = "header";
  header.layoutMode = "HORIZONTAL";
  header.primaryAxisSizingMode = "FIXED";
  header.counterAxisSizingMode = "AUTO";
  header.primaryAxisAlignItems = "SPACE_BETWEEN";
  header.paddingLeft = 16;
  header.paddingRight = 16;
  header.paddingTop = 14;
  header.paddingBottom = 14;
  header.resize(360, 64);
  header.fills = [solid(token.paper)];
  const titleWrap = figma.createFrame();
  titleWrap.name = "title";
  titleWrap.layoutMode = "VERTICAL";
  titleWrap.primaryAxisSizingMode = "AUTO";
  titleWrap.counterAxisSizingMode = "AUTO";
  titleWrap.itemSpacing = 4;
  titleWrap.fills = [];
  titleWrap.appendChild(text("Plan AI", { size: 10, style: font.medium, color: token.muted }));
  titleWrap.appendChild(text("계획 조정 채팅", { size: 15, style: font.medium, color: token.ink }));
  header.appendChild(titleWrap);
  header.appendChild(text("-", { size: 18, style: font.medium, color: token.ink }));
  c.appendChild(header);
  const history = figma.createFrame();
  history.name = "message history";
  history.layoutMode = "VERTICAL";
  history.primaryAxisSizingMode = "AUTO";
  history.counterAxisSizingMode = "FIXED";
  history.paddingLeft = 14;
  history.paddingRight = 14;
  history.paddingTop = 14;
  history.paddingBottom = 12;
  history.itemSpacing = 10;
  history.resize(360, 170);
  history.fills = [];
  const assistantBubble = figma.createFrame();
  assistantBubble.name = "assistant bubble";
  assistantBubble.layoutMode = "VERTICAL";
  assistantBubble.primaryAxisSizingMode = "AUTO";
  assistantBubble.counterAxisSizingMode = "FIXED";
  assistantBubble.resize(250, 50);
  assistantBubble.paddingLeft = 12;
  assistantBubble.paddingRight = 12;
  assistantBubble.paddingTop = 10;
  assistantBubble.paddingBottom = 10;
  assistantBubble.cornerRadius = 16;
  assistantBubble.fills = [solid(token.soft)];
  assistantBubble.appendChild(text("민감피부 기준을 2단계에 추가했어요.", { size: 13, color: token.ink, width: 220, lineHeight: 20 }));
  history.appendChild(assistantBubble);
  c.appendChild(history);
  const quick = figma.createFrame();
  quick.name = "quick actions";
  quick.layoutMode = "HORIZONTAL";
  quick.primaryAxisSizingMode = "AUTO";
  quick.counterAxisSizingMode = "FIXED";
  quick.paddingLeft = 14;
  quick.paddingRight = 14;
  quick.itemSpacing = 7;
  quick.resize(360, 42);
  quick.fills = [];
  ["예산 낮추기", "민감피부 기준", "선물용 포인트"].forEach((q) => quick.appendChild(pill(q).createInstance()));
  c.appendChild(quick);
  tag(c, "component/plan-ai-chat", "components");
  createdNodeIds.push(c.id);
  return c;
}

function sidebarEmpty() {
  const c = figma.createComponent();
  c.name = "Shopping Thread Sidebar / Empty";
  c.layoutMode = "VERTICAL";
  c.primaryAxisSizingMode = "FIXED";
  c.counterAxisSizingMode = "FIXED";
  c.resize(320, 656);
  c.fills = [solid(token.paper, 0.96)];
  c.strokes = [solid(token.ink, 0.1)];
  c.strokeWeight = 1;
  const head = figma.createFrame();
  head.name = "tabs";
  head.layoutMode = "HORIZONTAL";
  head.primaryAxisSizingMode = "FIXED";
  head.counterAxisSizingMode = "FIXED";
  head.counterAxisAlignItems = "CENTER";
  head.paddingLeft = 14;
  head.paddingRight = 14;
  head.itemSpacing = 8;
  head.resize(320, 70);
  head.fills = [solid(token.paper, 0.76)];
  head.appendChild(text("쇼핑 쓰레드", { size: 14, style: font.medium, color: token.ink }));
  head.appendChild(text("+", { size: 18, style: font.medium, color: token.plum }));
  c.appendChild(head);
  const empty = figma.createFrame();
  empty.name = "empty state";
  empty.layoutMode = "VERTICAL";
  empty.primaryAxisSizingMode = "AUTO";
  empty.counterAxisSizingMode = "FIXED";
  empty.primaryAxisAlignItems = "CENTER";
  empty.counterAxisAlignItems = "CENTER";
  empty.resize(292, 116);
  empty.x = 14;
  empty.paddingTop = 28;
  empty.paddingBottom = 28;
  empty.itemSpacing = 8;
  empty.cornerRadius = 6;
  empty.fills = [solid(token.soft, 0.64)];
  empty.strokes = [solid(token.plum, 0.14)];
  empty.dashPattern = [4, 4];
  empty.appendChild(text("아직 담은 상품이 없어요.", { size: 13, color: token.muted, align: "CENTER" }));
  empty.appendChild(text("상품을 보고 담기를 누르면 목적별로 모아볼 수 있어요.", { size: 12, color: token.muted, width: 180, align: "CENTER", lineHeight: 18 }));
  c.appendChild(empty);
  tag(c, "component/sidebar-empty", "components");
  createdNodeIds.push(c.id);
  return c;
}

function searchHero() {
  const f = figma.createFrame();
  f.name = "Screen Section / Home Search Hero";
  f.resize(760, 720);
  f.fills = [];
  const greeting = text("유진님, 오늘은 피부결이 먼저 보이는 베이스 루틴을 가볍게 정리해볼까요?", {
    size: 32,
    style: font.regular,
    color: token.ink,
    width: 724,
    lineHeight: 43,
  });
  greeting.x = 0;
  greeting.y = 210;
  f.appendChild(greeting);
  const input = figma.createFrame();
  input.name = "Search Field / underline";
  input.resize(760, 62);
  input.x = 0;
  input.y = 326;
  input.fills = [];
  input.appendChild(text("예: 출근 전에 10분 안에 안 무너지는 데일리 메이크업", { size: 18, color: "#9aa4b1", width: 680 }));
  const bottom = line(760, token.ink, 0.58);
  bottom.y = 61;
  input.appendChild(bottom);
  const searchButton = iconButton("검색", "⌕", "Disabled").createInstance();
  searchButton.x = 716;
  searchButton.y = 9;
  input.appendChild(searchButton);
  f.appendChild(input);
  const tags = figma.createFrame();
  tags.name = "Tag Row";
  tags.layoutMode = "HORIZONTAL";
  tags.primaryAxisSizingMode = "AUTO";
  tags.counterAxisSizingMode = "AUTO";
  tags.counterAxisAlignItems = "CENTER";
  tags.itemSpacing = 8;
  tags.x = 28;
  tags.y = 426;
  tags.fills = [];
  ["#출근_10분룩", "#AI_페이스룩", "#립스틱_전색발색", "#성분_궁합체크", "#여행파우치"].forEach((label) => tags.appendChild(pill(label).createInstance()));
  f.appendChild(tags);
  tag(f, "section/home-search-hero", "sections");
  createdNodeIds.push(f.id);
  return f;
}

function surveyPanel() {
  const f = figma.createFrame();
  f.name = "Screen Section / Survey";
  f.layoutMode = "VERTICAL";
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "FIXED";
  f.resize(860, 100);
  f.paddingTop = 40;
  f.paddingBottom = 40;
  f.itemSpacing = 26;
  f.fills = [solid(token.paper)];
  f.appendChild(text("Personal Brief", { size: 11, style: font.medium, color: token.muted }));
  f.appendChild(text("상황에 맞는 계획을 위해\n몇 가지만 알려주세요", { size: 42, style: font.regular, color: token.ink, width: 720, lineHeight: 52 }));
  f.appendChild(text("피부 타입, 무드, 예산을 가볍게 고르면 지금 목적에 맞는 뷰티 플랜을 정리해드려요.", { size: 15, color: token.muted, width: 540, lineHeight: 26 }));
  const progress = figma.createFrame();
  progress.name = "Survey Progress";
  progress.layoutMode = "VERTICAL";
  progress.primaryAxisSizingMode = "AUTO";
  progress.counterAxisSizingMode = "FIXED";
  progress.resize(860, 34);
  progress.itemSpacing = 10;
  progress.fills = [];
  progress.appendChild(text("1 / 4", { size: 12, color: token.muted, align: "RIGHT", width: 860 }));
  const track = figma.createFrame();
  track.name = "track";
  track.resize(860, 3);
  track.fills = [solid(token.plum, 0.12)];
  const fill = figma.createRectangle();
  fill.name = "fill";
  fill.resize(215, 3);
  fill.fills = [solid(token.ink)];
  track.appendChild(fill);
  progress.appendChild(track);
  f.appendChild(progress);
  const cards = figma.createFrame();
  cards.name = "Answer Cards";
  cards.layoutMode = "HORIZONTAL";
  cards.itemSpacing = 10;
  cards.primaryAxisSizingMode = "AUTO";
  cards.counterAxisSizingMode = "AUTO";
  cards.fills = [];
  [["건성", "속당김"], ["복합성", "T존 유분"], ["민감성", "성분 주의"], ["지성", "피지 관리"]].forEach((c, i) => cards.appendChild(infoCard(c[0], c[1], i === 2 ? "Selected" : "Default").createInstance()));
  f.appendChild(cards);
  const nav = figma.createFrame();
  nav.name = "Survey Nav";
  nav.layoutMode = "HORIZONTAL";
  nav.itemSpacing = 10;
  nav.primaryAxisSizingMode = "AUTO";
  nav.counterAxisSizingMode = "AUTO";
  nav.fills = [];
  nav.appendChild(button("이전", "Ghost", "Default", 120).createInstance());
  nav.appendChild(button("다음", "Primary", "Default", 240).createInstance());
  f.appendChild(nav);
  tag(f, "section/survey", "sections");
  createdNodeIds.push(f.id);
  return f;
}

function checkoutPanel() {
  const f = figma.createComponent();
  f.name = "Checkout / Order Form";
  f.layoutMode = "VERTICAL";
  f.primaryAxisSizingMode = "AUTO";
  f.counterAxisSizingMode = "FIXED";
  f.resize(560, 100);
  f.paddingLeft = 24;
  f.paddingRight = 24;
  f.paddingTop = 24;
  f.paddingBottom = 24;
  f.itemSpacing = 16;
  f.cornerRadius = 28;
  f.fills = [solid(token.paper)];
  f.strokes = [solid(token.plum, 0.1)];
  f.appendChild(text("Order", { size: 11, style: font.medium, color: token.plum }));
  f.appendChild(text("배송지 정보", { size: 22, style: font.medium, color: token.ink }));
  ["김지마켓", "010-1234-1234", "서울특별시 강남구 테헤란로 152"].forEach((value) => {
    const input = figma.createFrame();
    input.name = "input";
    input.resize(512, 48);
    input.cornerRadius = 16;
    input.fills = [solid(token.paper)];
    input.strokes = [solid(token.line)];
    input.paddingLeft = 14;
    input.paddingRight = 14;
    input.paddingTop = 14;
    input.layoutMode = "HORIZONTAL";
    input.appendChild(text(value, { size: 14, color: token.ink }));
    f.appendChild(input);
  });
  f.appendChild(button("결제하기", "Primary", "Default", 512).createInstance());
  tag(f, "component/checkout-order-form", "components");
  createdNodeIds.push(f.id);
  return f;
}

let page = figma.root.children.find((p) => p.name === PAGE_NAME);
if (!page) {
  page = figma.createPage();
  page.name = PAGE_NAME;
}
await figma.setCurrentPageAsync(page);

// Remove only nodes from this generated run on this page.
const prior = page
  .findAllWithCriteria({ sharedPluginData: { namespace: "dsb", keys: ["run_id"] } })
  .filter((n) => n.getSharedPluginData("dsb", "run_id") === RUN_ID);
for (const n of prior) n.remove();

page.backgrounds = [solid(token.soft)];

const board = figma.createFrame();
setFrame(board, "Gmarket Clean Home / Editable Component Breakdown", 40, 40, 1680, 2600, token.soft);
board.layoutMode = "VERTICAL";
board.primaryAxisSizingMode = "AUTO";
board.counterAxisSizingMode = "FIXED";
board.paddingTop = 48;
board.paddingBottom = 64;
board.paddingLeft = 48;
board.paddingRight = 48;
board.itemSpacing = 36;
tag(board, "board/root", "structure");
page.appendChild(board);
createdNodeIds.push(board.id);

const cover = figma.createFrame();
cover.name = "00 / Scope";
cover.layoutMode = "VERTICAL";
cover.primaryAxisSizingMode = "AUTO";
cover.counterAxisSizingMode = "FIXED";
cover.resize(1584, 100);
cover.paddingTop = 32;
cover.paddingBottom = 32;
cover.paddingLeft = 32;
cover.paddingRight = 32;
cover.itemSpacing = 12;
cover.cornerRadius = 6;
cover.fills = [solid(token.paper)];
cover.strokes = [solid(token.plum, 0.12)];
cover.appendChild(text("gmarket-advanced-clean-home", { size: 32, style: font.medium, color: token.ink }));
cover.appendChild(text("Actual clean beauty mockup style: paper background, ink typography, thin borders, restrained radius, image-led editorial cards.", { size: 14, color: token.muted, width: 920, lineHeight: 22 }));
cover.appendChild(text(`Captured image fills available: ${images.length}. Source components: search hero, tag chips, webzine stories, sidebar, survey, plan chat, product cards, modals, checkout and delivery/order panels.`, { size: 12, color: token.muted, width: 1200, lineHeight: 20 }));
board.appendChild(cover);

const foundation = figma.createFrame();
foundation.name = "01 / Foundations";
foundation.layoutMode = "VERTICAL";
foundation.primaryAxisSizingMode = "AUTO";
foundation.counterAxisSizingMode = "FIXED";
foundation.resize(1584, 100);
foundation.paddingTop = 28;
foundation.paddingBottom = 28;
foundation.paddingLeft = 28;
foundation.paddingRight = 28;
foundation.itemSpacing = 20;
foundation.cornerRadius = 6;
foundation.fills = [solid(token.paper)];
foundation.strokes = [solid(token.plum, 0.12)];
foundation.appendChild(text("Foundations", { size: 24, style: font.medium, color: token.ink }));
const swatches = figma.createFrame();
swatches.name = "Color Tokens";
swatches.layoutMode = "HORIZONTAL";
swatches.primaryAxisSizingMode = "AUTO";
swatches.counterAxisSizingMode = "AUTO";
swatches.itemSpacing = 12;
swatches.fills = [];
Object.entries(token).slice(0, 12).forEach(([name, hex]) => {
  const s = figma.createFrame();
  s.name = `--beauty-${name}`;
  s.layoutMode = "VERTICAL";
  s.primaryAxisSizingMode = "AUTO";
  s.counterAxisSizingMode = "FIXED";
  s.resize(116, 120);
  s.cornerRadius = 6;
  s.fills = [solid(token.soft)];
  s.paddingTop = 8;
  s.paddingLeft = 8;
  s.paddingRight = 8;
  s.paddingBottom = 8;
  s.itemSpacing = 8;
  const chip = figma.createRectangle();
  chip.name = hex;
  chip.resize(100, 54);
  chip.cornerRadius = 4;
  chip.fills = [solid(hex)];
  s.appendChild(chip);
  s.appendChild(text(name, { size: 11, style: font.medium, color: token.ink }));
  s.appendChild(text(hex, { size: 10, color: token.muted }));
  swatches.appendChild(s);
});
foundation.appendChild(swatches);
board.appendChild(foundation);

const atoms = figma.createFrame();
atoms.name = "02 / Atoms and Controls";
atoms.layoutMode = "HORIZONTAL";
atoms.primaryAxisSizingMode = "AUTO";
atoms.counterAxisSizingMode = "AUTO";
atoms.itemSpacing = 28;
atoms.fills = [];
atoms.appendChild(pill("#출근_10분룩").createInstance());
atoms.appendChild(pill("#출근_10분룩", "Hover").createInstance());
atoms.appendChild(iconButton("검색", "⌕", "Disabled").createInstance());
atoms.appendChild(iconButton("검색", "⌕", "Active").createInstance());
atoms.appendChild(button("다음", "Primary").createInstance());
atoms.appendChild(button("이전", "Ghost").createInstance());
atoms.appendChild(infoCard("민감성", "성분 주의", "Default").createInstance());
atoms.appendChild(infoCard("민감성", "성분 주의", "Selected").createInstance());
board.appendChild(atoms);

const homeSection = figma.createFrame();
homeSection.name = "03 / Home Screen Sections";
homeSection.layoutMode = "HORIZONTAL";
homeSection.primaryAxisSizingMode = "AUTO";
homeSection.counterAxisSizingMode = "AUTO";
homeSection.itemSpacing = 28;
homeSection.fills = [];
homeSection.appendChild(searchHero());
const webzine = figma.createFrame();
webzine.name = "Webzine Stories";
webzine.layoutMode = "HORIZONTAL";
webzine.primaryAxisSizingMode = "AUTO";
webzine.counterAxisSizingMode = "AUTO";
webzine.itemSpacing = 16;
webzine.fills = [];
webzine.appendChild(storyCard("Feature", "속광은 남기고 유분만 덜어내는 베이스", "Base Notes", "최근 쓰레드에서 반복된 키워드: 무너짐, 들뜸, 얇은 커버.", findImageHash("피부 표현", 0), 600, 396, true).createInstance());
const stack = figma.createFrame();
stack.name = "Small stories";
stack.layoutMode = "VERTICAL";
stack.primaryAxisSizingMode = "AUTO";
stack.counterAxisSizingMode = "AUTO";
stack.itemSpacing = 16;
stack.fills = [];
stack.appendChild(storyCard("Small", "맑은 로즈 한 끗", "Color Mood", "", findImageHash("로즈", 1), 364, 190).createInstance());
stack.appendChild(storyCard("Small", "1박 2일 파우치 최소 구성", "Pouch Edit", "", findImageHash("여행", 2), 364, 190).createInstance());
webzine.appendChild(stack);
homeSection.appendChild(webzine);
board.appendChild(homeSection);

const flowSection = figma.createFrame();
flowSection.name = "04 / Flow Components";
flowSection.layoutMode = "HORIZONTAL";
flowSection.primaryAxisSizingMode = "AUTO";
flowSection.counterAxisSizingMode = "AUTO";
flowSection.itemSpacing = 28;
flowSection.fills = [];
flowSection.appendChild(sidebarEmpty().createInstance());
flowSection.appendChild(surveyPanel());
flowSection.appendChild(planChat().createInstance());
board.appendChild(flowSection);

const commerce = figma.createFrame();
commerce.name = "05 / Commerce and Overlays";
commerce.layoutMode = "HORIZONTAL";
commerce.primaryAxisSizingMode = "AUTO";
commerce.counterAxisSizingMode = "AUTO";
commerce.itemSpacing = 28;
commerce.fills = [];
commerce.appendChild(productCard("Default", findImageHash("피부", 0)).createInstance());
commerce.appendChild(productCard("In Cart", findImageHash("로즈", 1)).createInstance());
commerce.appendChild(productCard("External", findImageHash("여행", 2)).createInstance());
commerce.appendChild(modalCard("Keyword").createInstance());
commerce.appendChild(modalCard("Ingredient").createInstance());
commerce.appendChild(checkoutPanel().createInstance());
board.appendChild(commerce);

// Create named component sets for the three most reused controls.
const tagSet = figma.combineAsVariants([pill("#태그", "Default"), pill("#태그", "Hover")], page);
tagSet.name = "Tag Chip";
tagSet.x = 40;
tagSet.y = board.y + board.height + 80;
tag(tagSet, "component-set/tag-chip", "components");
createdNodeIds.push(tagSet.id);

const infoSet = figma.combineAsVariants([infoCard("답변", "설명", "Default"), infoCard("답변", "설명", "Selected")], page);
infoSet.name = "Info Card";
infoSet.x = 300;
infoSet.y = tagSet.y;
tag(infoSet, "component-set/info-card", "components");
createdNodeIds.push(infoSet.id);

const productSet = figma.combineAsVariants([
  productCard("Default", findImageHash("피부", 0)),
  productCard("In Cart", findImageHash("로즈", 1)),
  productCard("External", findImageHash("여행", 2)),
], page);
productSet.name = "Product Card";
productSet.x = 760;
productSet.y = tagSet.y;
tag(productSet, "component-set/product-card", "components");
createdNodeIds.push(productSet.id);

figma.viewport.scrollAndZoomIntoView([board]);

return {
  success: true,
  pageId: page.id,
  rootBoardId: board.id,
  componentSets: {
    tagChip: tagSet.id,
    infoCard: infoSet.id,
    productCard: productSet.id,
  },
  capturedImageFillsFound: images.length,
  createdNodeIds,
  mutatedNodeIds,
};
