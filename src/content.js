(function mediaFinderContent() {
  const MEDIA_PATTERN = /\.(pdf|png|jpe?g|gif|webp|avif|svg|bmp|tiff?)(?:[?#].*)?$/i;
  const DATA_MEDIA_PATTERN = /^data:(image\/([a-z0-9.+-]+)|application\/pdf)[;,]/i;
  const BOOKROLL_LESSON_BY_ID = {
    "1ac3be7681281ac437d8414a45525a1c32dd90fc5470138651aaac2cae147f14": "1",
    d0b7faf361050bc749a229f0a8a0f408a4a51333782b0960cf6a88f10222455c: "2",
    c2365ea569480b3c4c271c97de3d2b7e70a498153aa50cd5f6cf5308ec05d1b0: "3"
  };
  const isBookRoll = isBookRollPage();
  const canvasFingerprints = new WeakMap();
  let bookRollFingerprints = new WeakMap();
  let isExtensionAlive = true;
  let scanTimer = 0;
  let scanInterval = 0;
  let pageObserver = null;

  scanAndSend();
  rememberBookRollMaterialList();
  observePageChanges();
  scanInterval = setInterval(scanAndSend, 1200);

  if (runtimeIsAvailable()) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "scan-page") {
        const items = scanPage();
        sendCandidates(items);
        sendResponse({ ok: true, items });
      } else if (message && message.type === "bookroll-collect-all") {
        collectAllBookRollSlides()
          .then((items) => sendResponse({ ok: true, items }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      return false;
    });
  }

function observePageChanges() {
  pageObserver = new MutationObserver(() => {
    if (!isExtensionAlive) {
      stopScanning();
      return;
    }

    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAndSend, 350);
  });

  pageObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["src", "srcset", "href", "data", "style", "class"]
  });
}

function scanAndSend() {
  if (!runtimeIsAvailable()) {
    stopScanning();
    return;
  }

  const items = scanPage();
  sendCandidates(items);
}

function sendCandidates(items) {
  if (!runtimeIsAvailable()) {
    stopScanning();
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: "content-candidates", items }, () => {
      if (chrome.runtime.lastError) {
        stopScanning();
      }
    });
  } catch {
    stopScanning();
  }
}

function runtimeIsAvailable() {
  try {
    return isExtensionAlive && Boolean(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function stopScanning() {
  isExtensionAlive = false;
  clearTimeout(scanTimer);

  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = 0;
  }

  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }
}

function scanPage() {
  const candidates = new Map();

  collectAttributeUrls(candidates, "a[href]", "href", "link");
  collectAttributeUrls(candidates, "img[src]", "src", "image");
  collectAttributeUrls(candidates, "source[src]", "src", "source");
  collectAttributeUrls(candidates, "embed[src]", "src", "embed");
  collectAttributeUrls(candidates, "iframe[src]", "src", "iframe");
  collectAttributeUrls(candidates, "object[data]", "data", "object");
  collectSrcsetUrls(candidates);
  collectCssBackgroundUrls(candidates);
  collectInlineStyleUrls(candidates);
  if (isBookRoll) {
    collectBookRollCanvasImages(candidates);
  } else {
    collectCanvasImages(candidates);
  }

  return [...candidates.values()];
}

function rememberBookRollMaterialList() {
  if (location.hostname !== "bookroll.let.media.kyoto-u.ac.jp" || !location.pathname.startsWith("/bookroll/home/")) {
    return;
  }

  const materials = {};
  for (const link of document.querySelectorAll("a[href*='/bookroll/vue/'], a[href*='/bookroll/book/view'][href*='contents=']")) {
    const documentId = bookRollDocumentId(link.href);
    const label = link.textContent.trim();
    if (!documentId || !label) {
      continue;
    }

    materials[documentId] = parseBookRollMaterialLabel(label);
  }

  if (Object.keys(materials).length > 0 && runtimeIsAvailable() && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get({ bookRollMaterials: {} }, (stored) => {
        if (chrome.runtime.lastError || !runtimeIsAvailable()) {
          return;
        }

        chrome.storage.local.set({
          bookRollMaterials: {
            ...stored.bookRollMaterials,
            ...materials
          }
        });
      });
    } catch {
      stopScanning();
    }
  }
}

function isBookRollPage() {
  return (
    location.hostname === "bookroll.let.media.kyoto-u.ac.jp" &&
    location.pathname.startsWith("/bookroll/vue/")
  );
}

function collectAttributeUrls(candidates, selector, attribute, source) {
  for (const element of document.querySelectorAll(selector)) {
    const rawUrl = element.getAttribute(attribute);
    addUrl(candidates, rawUrl, source, element);
  }
}

function collectSrcsetUrls(candidates) {
  for (const element of document.querySelectorAll("[srcset]")) {
    for (const rawUrl of parseSrcset(element.getAttribute("srcset") || "")) {
      addUrl(candidates, rawUrl, "srcset", element);
    }
  }
}

function collectCssBackgroundUrls(candidates) {
  for (const element of document.querySelectorAll("body *")) {
    const style = getComputedStyle(element);
    addStyleUrls(candidates, style.backgroundImage, "css-background", element);
    addStyleUrls(candidates, style.content, "css-content", element);
  }
}

function collectInlineStyleUrls(candidates) {
  for (const element of document.querySelectorAll("[style]")) {
    addStyleUrls(candidates, element.getAttribute("style") || "", "inline-style", element);
  }
}

function collectCanvasImages(candidates) {
  for (const canvas of document.querySelectorAll("canvas")) {
    if (!isVisibleLargeElement(canvas)) {
      continue;
    }

    const fingerprint = canvasFingerprint(canvas);
    if (!fingerprint || canvasFingerprints.get(canvas) === fingerprint) {
      continue;
    }

    const dataUrl = canvasToPngDataUrl(canvas);
    if (!dataUrl) {
      continue;
    }

    canvasFingerprints.set(canvas, fingerprint);
    candidates.set(dataUrl, {
      id: stableId(dataUrl),
      url: dataUrl,
      source: "canvas",
      type: "png",
      filename: canvasFilename("canvas"),
      title: `${document.title || "canvas"} (${canvas.width}x${canvas.height})`,
      pageUrl: location.href,
      size: dataUrl.length
    });
  }
}

function collectBookRollCanvasImages(candidates) {
  const candidate = captureBookRollSlide({ allowSeen: false });
  if (!candidate) {
    return;
  }

  candidates.set(candidate.url, candidate);
}

async function collectAllBookRollSlides() {
  if (!isBookRoll) {
    throw new Error("This is not a BookRoll page");
  }

  bookRollFingerprints = new WeakMap();
  const total = bookRollTotalPages();
  if (!total) {
    throw new Error("Could not detect the BookRoll page count");
  }

  const collected = new Map();
  await moveToBookRollFirstPage();

  for (let expectedPage = 1; expectedPage <= total; expectedPage += 1) {
    await waitForBookRollPage(expectedPage);
    const item = await waitForBookRollSlide(expectedPage);
    if (item) {
      collected.set(bookRollSlideNumber(item) || expectedPage, item);
      sendCandidates([...collected.values()]);
    }

    if (collected.size >= total) {
      break;
    }

    if (expectedPage < total && !clickBookRollNext()) {
      break;
    }
  }

  return [...collected.entries()]
    .sort((first, second) => first[0] - second[0])
    .map((entry) => entry[1]);
}

async function waitForBookRollSlide(expectedPage) {
  const startedAt = Date.now();
  let item = captureBookRollSlide({ allowSeen: true });

  while (
    (!item || isMostlyBlankDataUrl(item.url) || (expectedPage && bookRollSlideNumber(item) !== expectedPage)) &&
    Date.now() - startedAt < 5000
  ) {
    await delay(250);
    item = captureBookRollSlide({ allowSeen: true });
  }

  return item;
}

function captureBookRollSlide({ allowSeen }) {
  const canvas = largestVisibleCanvas();
  if (!canvas) {
    return null;
  }

  const fingerprint = canvasFingerprint(canvas);
  if (!fingerprint || (!allowSeen && bookRollFingerprints.get(canvas) === fingerprint)) {
    return null;
  }

  if (isMostlyBlankCanvas(canvas)) {
    return null;
  }

  const dataUrl = canvasToPngDataUrl(canvas);
  if (!dataUrl || isMostlyBlankDataUrl(dataUrl)) {
    return null;
  }

  bookRollFingerprints.set(canvas, fingerprint);
  return {
    id: stableId(`bookroll:${dataUrl}`),
    url: dataUrl,
    source: "bookroll-canvas",
    type: "png",
    filename: canvasFilename("bookroll"),
    title: `BookRoll ${pageNumberLabel() || "slide"} (${canvas.width}x${canvas.height})`,
    lessonTitle: bookRollLessonTitle(),
    lessonNumber: bookRollLessonNumber(),
    pageUrl: location.href,
    size: dataUrl.length
  };
}

function bookRollTotalPages() {
  const visibleText = document.body ? document.body.innerText : "";
  const matches = [...visibleText.matchAll(/\b(\d+)\s*\/\s*(\d+)\b/g)]
    .map((match) => Number(match[2]))
    .filter(Number.isFinite);

  return matches.length ? Math.max(...matches) : 0;
}

function bookRollSlideNumber(item) {
  const match = `${item.filename || ""} ${item.title || ""}`.match(/\b(\d+)of(\d+)\b/i);
  return match ? Number(match[1]) : 0;
}

async function moveToBookRollFirstPage() {
  for (let attempt = 0; attempt < 80 && bookRollCurrentPage() > 1; attempt += 1) {
    if (!clickBookRollPrevious()) {
      break;
    }
    await delay(250);
  }

  await waitForBookRollPage(1);
}

async function waitForBookRollPage(pageNumber) {
  const startedAt = Date.now();

  while (bookRollCurrentPage() !== pageNumber && Date.now() - startedAt < 5000) {
    await delay(150);
  }

  await delay(450);
}

function bookRollCurrentPage() {
  const label = pageNumberLabel();
  const match = label.match(/^(\d+)of(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function bookRollLessonNumber() {
  const documentId = bookRollDocumentId(location.href);
  if (documentId && BOOKROLL_LESSON_BY_ID[documentId]) {
    return BOOKROLL_LESSON_BY_ID[documentId];
  }

  return "";
}

function parseBookRollMaterialLabel(label) {
  const trimmed = label.trim();
  const match = trimmed.match(/^(.*?)(?:\s*)(?:第?(\d+)回|([A-Za-z])0*([1-9]\d*)|0*([1-9]\d*))$/);
  const subject = match ? `${match[1] || ""}${match[3] || ""}`.trim() || trimmed : trimmed;
  const lessonNumber = match ? match[2] || match[4] || match[5] || "" : "";

  return {
    label: trimmed,
    subject: subject || trimmed,
    lessonNumber
  };
}

function bookRollDocumentId(url) {
  try {
    const parsed = new URL(url);
    const contents = parsed.searchParams.get("contents");
    if (contents) {
      return contents;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const vueIndex = segments.indexOf("vue");
    return vueIndex >= 0 && segments[vueIndex + 1] ? segments[vueIndex + 1] : "";
  } catch {
    return "";
  }
}

function bookRollLessonTitle() {
  const visibleText = document.body ? document.body.innerText : "";
  const lines = visibleText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const usefulLine =
    lines.find((line) => /Section|第|講|微分|積分|学|A|B|C/.test(line) && !/^\d+\s*\/\s*\d+$/.test(line)) ||
    document.title ||
    "BookRoll";

  return usefulLine.slice(0, 80);
}

function clickBookRollNext() {
  return clickBookRollArrow("next");
}

function clickBookRollPrevious() {
  return clickBookRollArrow("previous");
}

function clickBookRollArrow(direction) {
  const xPoints =
    direction === "next"
      ? [window.innerWidth - 36, window.innerWidth - 54, window.innerWidth - 80]
      : [36, 54, 80];
  const yPoints = [window.innerHeight / 2, window.innerHeight / 2 - 40, window.innerHeight / 2 + 40];

  for (const x of xPoints) {
    for (const y of yPoints) {
      const target = clickableFromPoint(x, y);
      if (target) {
        target.click();
        return true;
      }
    }
  }

  const keyboardEvent = new KeyboardEvent("keydown", {
    key: direction === "next" ? "ArrowRight" : "ArrowLeft",
    code: direction === "next" ? "ArrowRight" : "ArrowLeft",
    bubbles: true
  });
  document.dispatchEvent(keyboardEvent);
  window.dispatchEvent(keyboardEvent);
  return true;
}

function clickableFromPoint(x, y) {
  for (const element of document.elementsFromPoint(x, y)) {
    const target = bookRollClickableElement(element);
    if (target) {
      return target;
    }
  }

  return null;
}

function bookRollClickableElement(element) {
  if (!element) {
    return null;
  }

  const parent = element.closest("button,a,[role='button']");
  if (parent) {
    return parent;
  }

  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    element.onclick ||
    getComputedStyle(element).cursor === "pointer"
  ) {
    return element;
  }

  return null;
}

function isMostlyBlankCanvas(canvas) {
  try {
    const sample = document.createElement("canvas");
    sample.width = 32;
    sample.height = 32;
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    let nonWhitePixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      if (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245) {
        nonWhitePixels += 1;
      }
    }

    return nonWhitePixels < 8;
  } catch {
    return true;
  }
}

function isMostlyBlankDataUrl(dataUrl) {
  return dataUrl.length < 50000;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function largestVisibleCanvas() {
  return [...document.querySelectorAll("canvas")]
    .filter(isVisibleLargeElement)
    .sort((first, second) => {
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      return secondRect.width * secondRect.height - firstRect.width * firstRect.height;
    })[0];
}

function addStyleUrls(candidates, value, source, element) {
  for (const rawUrl of extractCssUrls(value)) {
    addUrl(candidates, rawUrl, source, element);
  }
}

function isVisibleLargeElement(element) {
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width || element.width || 0);
  const height = Math.round(rect.height || element.height || 0);

  if (width < 240 || height < 180 || width * height < 100000) {
    return false;
  }

  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth &&
    getComputedStyle(element).visibility !== "hidden" &&
    getComputedStyle(element).display !== "none"
  );
}

function canvasFingerprint(canvas) {
  try {
    const sample = document.createElement("canvas");
    sample.width = 16;
    sample.height = 16;
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let hash = `${canvas.width}x${canvas.height}`;

    for (let index = 0; index < pixels.length; index += 16) {
      hash += `:${pixels[index]}-${pixels[index + 1]}-${pixels[index + 2]}-${pixels[index + 3]}`;
    }

    return hash;
  } catch {
    return "";
  }
}

function canvasToPngDataUrl(canvas) {
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function canvasFilename(prefix) {
  const pageLabel = pageNumberLabel();
  const safeTitle = (document.title || "canvas")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "-")
    .slice(0, 60);

  return `${prefix}-${safeTitle}${pageLabel ? `-${pageLabel}` : ""}-${Date.now()}.png`;
}

function pageNumberLabel() {
  const visibleText = document.body ? document.body.innerText : "";
  const matches = [...visibleText.matchAll(/\b(\d+)\s*\/\s*(\d+)\b/g)]
    .map((match) => ({
      current: Number(match[1]),
      total: Number(match[2])
    }))
    .filter((item) => Number.isFinite(item.current) && Number.isFinite(item.total));

  if (matches.length === 0) {
    return "";
  }

  const pageMatch = matches.sort((first, second) => second.total - first.total || second.current - first.current)[0];
  return `${pageMatch.current}of${pageMatch.total}`;
}

function addUrl(candidates, rawUrl, source, element) {
  const url = absolutizeUrl(rawUrl);
  if (!url || !isMediaUrl(url) || looksLikeSiteDecoration(url, element)) {
    return;
  }

  candidates.set(url, {
    id: stableId(url),
    url,
    source,
    type: detectType(url),
    filename: filenameFromUrl(url),
    title: labelForElement(element),
    pageUrl: location.href
  });
}

function parseSrcset(value) {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function extractCssUrls(value) {
  const urls = [];
  const pattern = /url\((["']?)(.*?)\1\)/gi;
  let match = pattern.exec(value);

  while (match) {
    urls.push(match[2]);
    match = pattern.exec(value);
  }

  return urls;
}

function absolutizeUrl(rawUrl) {
  if (!rawUrl || rawUrl.startsWith("javascript:")) {
    return "";
  }

  if (rawUrl.startsWith("data:")) {
    return rawUrl;
  }

  try {
    return new URL(rawUrl, location.href).href;
  } catch {
    return "";
  }
}

function isMediaUrl(url) {
  return DATA_MEDIA_PATTERN.test(url) || MEDIA_PATTERN.test(url);
}

function looksLikeSiteDecoration(url, element) {
  const haystack = [
    url,
    filenameFromUrl(url),
    element ? element.className : "",
    element ? element.id : "",
    element ? element.getAttribute("alt") : "",
    element ? element.getAttribute("aria-label") : ""
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(favicon|apple-touch-icon|site-icon|logo|brand|sprite)\b/.test(haystack)) {
    return true;
  }

  if (element instanceof HTMLImageElement) {
    const width = element.naturalWidth || element.width;
    const height = element.naturalHeight || element.height;
    return width > 0 && height > 0 && width <= 96 && height <= 96;
  }

  return false;
}

function detectType(url) {
  const dataMatch = url.match(DATA_MEDIA_PATTERN);
  if (dataMatch) {
    if (dataMatch[1].toLowerCase() === "application/pdf") {
      return "pdf";
    }
    return dataMatch[2].replace("jpeg", "jpg").replace("svg+xml", "svg").toLowerCase();
  }

  const match = url.match(MEDIA_PATTERN);
  return match ? match[1].replace("jpeg", "jpg").toLowerCase() : "";
}

function filenameFromUrl(url) {
  if (url.startsWith("data:")) {
    return `embedded-image-${Date.now()}.${detectType(url) || "png"}`;
  }

  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || `download.${detectType(url)}`);
  } catch {
    return `download.${detectType(url)}`;
  }
}

function labelForElement(element) {
  if (!element) {
    return document.title || "";
  }

  return (
    element.getAttribute("alt") ||
    element.getAttribute("title") ||
    element.textContent.trim().slice(0, 120) ||
    document.title ||
    ""
  );
}

function stableId(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `item-${Math.abs(hash)}`;
}
})();
