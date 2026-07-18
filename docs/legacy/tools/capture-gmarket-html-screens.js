const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, ".codex", "html-screenshots");
const PORT = Number(process.env.PORT || 41739);
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".webp": "image/webp",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const rawPath = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${PORT}`).pathname);
    const filePath = path.join(ROOT, rawPath === "/" ? "gmarket-advanced-clean-home.html" : rawPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function waitForApp(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    document.getElementById("page-loading-overlay")?.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
  });
}

async function smartShot(page, name, selector) {
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  const filePath = path.join(OUT_DIR, `${name}.png`);
  const locator = selector ? page.locator(selector).first() : null;
  if (locator && (await locator.count()) && (await locator.isVisible().catch(() => false))) {
    try {
      await locator.screenshot({ path: filePath, timeout: 10000 });
      return filePath;
    } catch {
      // Fall through to viewport screenshot for transient states.
    }
  }
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

async function clickKeyword(page, index) {
  await page.locator(".suggestion-tag").nth(index).click();
  await page.waitForTimeout(1000);
}

async function answerSurvey(page) {
  for (let guard = 0; guard < 8; guard += 1) {
    const visibleInfo = await page.locator("#info-view:not(.hidden)").count();
    if (!visibleInfo) break;
    const selected = page.locator("#info-view button[data-choice-value]").first();
    if (await selected.count()) {
      await selected.click();
      await page.waitForTimeout(450);
      continue;
    }
    const sample = page.locator("#info-view button", { hasText: "샘플" }).first();
    if (await sample.count()) {
      await sample.click();
      await page.waitForTimeout(450);
      continue;
    }
    break;
  }
  const planButton = page.locator("#info-view button", { hasText: /플랜|Plan|추천|결과|완료/ }).last();
  if (await planButton.count()) {
    await planButton.click();
  } else {
    await page.evaluate(() => window.generatePlan?.());
  }
  await page.waitForTimeout(1200);
}

async function ensurePdpAndOrder(page) {
  await page.evaluate(() => {
    window.closePDP?.();
    const seenSteps = new Set();
    document.querySelectorAll("[data-cart-btn]").forEach((btn) => {
      const key = btn.getAttribute("data-cart-btn") || "";
      const match = key.match(/-(\d+)-(\d+)$/);
      const step = match?.[1];
      if (!step || seenSteps.has(step)) return;
      if (btn.disabled || btn.classList.contains("cart-add-btn--disabled")) return;
      btn.click();
      seenSteps.add(step);
    });
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    for (let step = 0; step < 6; step += 1) {
      for (let product = 0; product < 8; product += 1) {
        window.openPDP?.(step, product);
        const btn = document.getElementById("pdp-cart-btn");
        if (btn && !btn.disabled) return;
      }
    }
    window.openPDP?.(0, 0);
  });
  await page.waitForTimeout(900);
  const add = page.locator("#pdp-cart-btn").first();
  if (await add.count()) {
    await add.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => {
    window.closePDP?.();
    window.handleBottomCheckout?.();
  });
  await page.waitForTimeout(3000);
  if (!(await page.locator("#order-view:not(.hidden)").count())) {
    const buyAnyway = page.locator("#missing-toast button", { hasText: /그냥|구매/ }).last();
    if (await buyAnyway.count()) {
      await buyAnyway.click().catch(() => {});
      await page.waitForTimeout(3000);
    }
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const url = `http://127.0.0.1:${PORT}/gmarket-advanced-clean-home.html?reset=1`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForApp(page);

  const shots = [];
  shots.push({ key: "home", file: await smartShot(page, "01-home-html", "#home-view") });

  await clickKeyword(page, 0);
  shots.push({ key: "brief", file: await smartShot(page, "02-brief-html", "#info-view") });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForApp(page);
  await clickKeyword(page, 2);
  await page.waitForTimeout(3200);
  shots.push({ key: "plan", file: await smartShot(page, "03-plan-html", "#solution-view") });

  await page.evaluate(() => window.openPDP?.(0, 0));
  await page.waitForTimeout(1200);
  shots.push({ key: "pdp", file: await smartShot(page, "04-pdp-html", "#pdp-floating-card") });

  await ensurePdpAndOrder(page);
  shots.push({ key: "checkout", file: await smartShot(page, "05-checkout-html", "#order-view") });

  await page.evaluate(() => window.submitOrder?.());
  await page.waitForTimeout(3200);
  shots.push({ key: "complete", file: await smartShot(page, "06-complete-html", "#order-complete-view") });

  await page.evaluate(() => window.openOrderClaimFlow?.());
  await page.waitForTimeout(1400);
  shots.push({ key: "claim", file: await smartShot(page, "07-claim-html", "#order-claim-view") });

  shots.push({ key: "skip", file: path.join(OUT_DIR, "03-plan-html.png") });

  const meta = await page.evaluate(() => ({
    title: document.title,
    href: location.href,
    width: innerWidth,
    height: innerHeight,
    tags: [...document.querySelectorAll(".suggestion-tag")].map((el) => el.textContent.trim()),
  }));

  await browser.close();
  server.close();
  const result = {
    ok: true,
    source: "gmarket-advanced-clean-home.html",
    url,
    outDir: OUT_DIR,
    shots,
    meta,
    errors: errors.slice(0, 20),
  };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
