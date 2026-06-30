const state = {
  tabId: null,
  tabUrl: "",
  items: [],
  bookRollMaterials: {},
  selectedUrls: new Set()
};

const BOOKROLL_LESSON_BY_ID = {
  "1ac3be7681281ac437d8414a45525a1c32dd90fc5470138651aaac2cae147f14": "1",
  d0b7faf361050bc749a229f0a8a0f408a4a51333782b0960cf6a88f10222455c: "2",
  c2365ea569480b3c4c271c97de3d2b7e70a498153aa50cd5f6cf5308ec05d1b0: "3"
};

const elements = {
  summary: document.querySelector("#summary"),
  scanButton: document.querySelector("#scanButton"),
  pdfFilter: document.querySelector("#pdfFilter"),
  imageFilter: document.querySelector("#imageFilter"),
  searchInput: document.querySelector("#searchInput"),
  bookRollTools: document.querySelector("#bookRollTools"),
  bookRollSummary: document.querySelector("#bookRollSummary"),
  bookRollCollectButton: document.querySelector("#bookRollCollectButton"),
  bookRollPdfButton: document.querySelector("#bookRollPdfButton"),
  emptyState: document.querySelector("#emptyState"),
  candidateList: document.querySelector("#candidateList"),
  selectAll: document.querySelector("#selectAll"),
  downloadSelectedButton: document.querySelector("#downloadSelectedButton")
};

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab.id;
  state.tabUrl = tab.url || "";
  await loadBookRollMaterials();

  elements.scanButton.addEventListener("click", scanCurrentPage);
  elements.pdfFilter.addEventListener("change", render);
  elements.imageFilter.addEventListener("change", render);
  elements.searchInput.addEventListener("input", render);
  elements.selectAll.addEventListener("change", toggleSelectAll);
  elements.downloadSelectedButton.addEventListener("click", downloadSelected);
  elements.bookRollCollectButton.addEventListener("click", collectAllBookRollSlides);
  elements.bookRollPdfButton.addEventListener("click", downloadBookRollPdf);

  await scanCurrentPage();
  setInterval(loadCandidates, 1500);
}

async function scanCurrentPage() {
  setSummary("Scanning current tab...");

  try {
    await chrome.tabs.sendMessage(state.tabId, { type: "scan-page" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      files: ["src/content.js"]
    });
  }

  await loadCandidates();
}

async function loadCandidates() {
  await refreshActiveTab();
  await loadBookRollMaterials();
  const response = await chrome.runtime.sendMessage({
    type: "get-candidates",
    tabId: state.tabId
  });

  state.items = dedupeAndSort(response.items || []);
  render();
}

async function loadBookRollMaterials() {
  const stored = await chrome.storage.local.get({ bookRollMaterials: {} });
  state.bookRollMaterials = stored.bookRollMaterials || {};
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id !== state.tabId) {
    return;
  }

  state.tabUrl = tab.url || state.tabUrl;
}

function render() {
  const visibleItems = filteredItems();
  elements.candidateList.textContent = "";
  elements.emptyState.hidden = visibleItems.length > 0;
  setSummary(`${visibleItems.length} shown, ${state.items.length} total`);

  for (const item of visibleItems) {
    elements.candidateList.appendChild(renderCandidate(item));
  }

  syncBulkControls(visibleItems);
  syncBookRollTools();
}

function renderCandidate(item) {
  const row = document.createElement("li");
  row.className = "candidate";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedUrls.has(item.url);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selectedUrls.add(item.url);
    } else {
      state.selectedUrls.delete(item.url);
    }
    syncBulkControls(filteredItems());
  });

  const details = document.createElement("div");
  const preview = document.createElement("div");
  preview.className = "preview";

  if (item.type === "pdf") {
    preview.textContent = "PDF";
  } else {
    const image = document.createElement("img");
    image.src = item.url;
    image.alt = "";
    image.loading = "lazy";
    preview.appendChild(image);
  }

  const name = document.createElement("p");
  name.className = "candidateName";
  name.textContent = item.filename || item.url;

  const url = document.createElement("div");
  url.className = "candidateUrl";
  url.textContent = displayUrl(item.url);

  const meta = document.createElement("div");
  meta.className = "candidateMeta";
  meta.append(createPill(item.type.toUpperCase()));
  meta.append(createPill(item.source));
  if (item.size) {
    meta.append(createPill(formatBytes(item.size)));
  }
  if (item.title) {
    meta.append(createPill(item.title));
  }
  if (item.method && item.method !== "GET") {
    meta.append(createPill(item.method));
  }

  details.append(preview, name, url, meta);

  const button = document.createElement("button");
  button.className = "downloadButton";
  button.type = "button";
  button.textContent = "Download";
  button.addEventListener("click", () => downloadItem(item));

  const actions = document.createElement("div");
  actions.className = "candidateActions";

  const openButton = document.createElement("button");
  openButton.className = "secondaryButton";
  openButton.type = "button";
  openButton.textContent = "Open";
  openButton.title = "Open with the current Chrome login session";
  openButton.addEventListener("click", () => chrome.tabs.create({ url: item.url, active: false }));

  actions.append(button, openButton);
  row.append(checkbox, details, actions);
  return row;
}

function createPill(text) {
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = text;
  return pill;
}

function filteredItems() {
  const query = elements.searchInput.value.trim().toLowerCase();

  return state.items.filter((item) => {
    const isPdf = item.type === "pdf";
    const isImage = !isPdf;
    const typeMatches = (isPdf && elements.pdfFilter.checked) || (isImage && elements.imageFilter.checked);
    const queryMatches = !query || `${item.filename} ${displayUrl(item.url)} ${item.title}`.toLowerCase().includes(query);
    return typeMatches && queryMatches;
  });
}

function syncBulkControls(visibleItems) {
  const selectedVisibleCount = visibleItems.filter((item) => state.selectedUrls.has(item.url)).length;

  elements.selectAll.checked = visibleItems.length > 0 && selectedVisibleCount === visibleItems.length;
  elements.selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleItems.length;
  elements.downloadSelectedButton.disabled = state.selectedUrls.size === 0;
}

function toggleSelectAll() {
  const visibleItems = filteredItems();

  if (elements.selectAll.checked) {
    for (const item of visibleItems) {
      state.selectedUrls.add(item.url);
    }
  } else {
    for (const item of visibleItems) {
      state.selectedUrls.delete(item.url);
    }
  }

  render();
}

async function downloadSelected() {
  const items = state.items.filter((item) => state.selectedUrls.has(item.url));

  for (const item of items) {
    await downloadItem(item);
  }
}

async function downloadBookRollPdf() {
  const slides = bookRollSlides();

  if (slides.length === 0) {
    setSummary("No BookRoll slides collected yet");
    return;
  }

  try {
    elements.bookRollPdfButton.disabled = true;
    setSummary(`Building PDF from ${slides.length} BookRoll slides...`);
    const images = await Promise.all(slides.map(loadImageForPdf));
    const pdfBlob = buildPdfFromImages(images);
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const filename = `${bookRollPdfBaseName()}.pdf`;

    await chrome.downloads.download({
      url: pdfUrl,
      filename,
      saveAs: true,
      conflictAction: "uniquify"
    });

    setTimeout(() => URL.revokeObjectURL(pdfUrl), 30000);
    setSummary(`Started PDF download: ${filename}`);
  } catch (error) {
    setSummary(error.message || "Failed to build BookRoll PDF");
  } finally {
    syncBookRollTools();
  }
}

async function collectAllBookRollSlides() {
  if (!isBookRollUrl(state.tabUrl)) {
    setSummary("This is not a BookRoll page");
    return;
  }

  try {
    elements.bookRollCollectButton.disabled = true;
    elements.bookRollPdfButton.disabled = true;
    setSummary("Collecting all BookRoll slides...");
    state.items = state.items.filter((item) => !isBookRollCandidate(item) || !isSameBookRollDocument(item.pageUrl, state.tabUrl));
    render();

    await chrome.runtime.sendMessage({
      type: "clear-bookroll-candidates",
      tabId: state.tabId,
      pageUrl: state.tabUrl
    });

    let response;
    try {
      response = await chrome.tabs.sendMessage(state.tabId, { type: "bookroll-collect-all" });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: state.tabId },
        files: ["src/content.js"]
      });
      response = await chrome.tabs.sendMessage(state.tabId, { type: "bookroll-collect-all" });
    }
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Failed to collect BookRoll slides");
    }

    await loadCandidates();
    const slides = bookRollSlides();
    setSummary(`Collected ${slides.length} BookRoll slides`);

    if (slides.length > 0) {
      await downloadBookRollPdf();
    }
  } catch (error) {
    setSummary(error.message || "Failed to collect BookRoll slides");
  } finally {
    syncBookRollTools();
  }
}

async function downloadItem(item) {
  const response = await chrome.runtime.sendMessage({
    type: "download",
    item,
    options: {
      saveAs: true
    }
  });

  if (!response.ok) {
    setSummary(response.error || "Download failed");
    return;
  }

  setSummary(`Started download: ${item.filename}`);
}

function dedupeAndSort(items) {
  const map = new Map();

  for (const item of items) {
    if (!item || !item.url) {
      continue;
    }
    map.set(item.url, item);
  }

  return [...map.values()].sort((a, b) => {
    if ((a.source || "").includes("canvas") && !(b.source || "").includes("canvas")) {
      return -1;
    }
    if (!(a.source || "").includes("canvas") && (b.source || "").includes("canvas")) {
      return 1;
    }
    if ((b.discoveredAt || 0) !== (a.discoveredAt || 0)) {
      return (b.discoveredAt || 0) - (a.discoveredAt || 0);
    }
    if (a.type === "pdf" && b.type !== "pdf") {
      return -1;
    }
    if (a.type !== "pdf" && b.type === "pdf") {
      return 1;
    }
    return (a.filename || a.url).localeCompare(b.filename || b.url);
  });
}

function syncBookRollTools() {
  const isBookRoll = isBookRollUrl(state.tabUrl);
  const slides = bookRollSlides();

  elements.bookRollTools.hidden = !isBookRoll;
  elements.bookRollSummary.textContent =
    slides.length === 0 ? "No BookRoll slides collected yet." : `${slides.length} collected slides`;
  elements.bookRollCollectButton.disabled = !isBookRoll;
  elements.bookRollPdfButton.disabled = slides.length === 0;
}

function bookRollSlides() {
  const map = new Map();

  for (const item of state.items) {
    if (!isBookRollCandidate(item)) {
      continue;
    }
    if (!isSameBookRollDocument(item.pageUrl, state.tabUrl)) {
      continue;
    }
    map.set(bookRollSlideKey(item), item);
  }

  return [...map.values()].sort((a, b) => {
    const aPage = bookRollPageNumber(a);
    const bPage = bookRollPageNumber(b);

    if (aPage !== bPage) {
      return aPage - bPage;
    }

    return (a.discoveredAt || 0) - (b.discoveredAt || 0);
  });
}

function isBookRollCandidate(item) {
  return (
    item &&
    item.type !== "pdf" &&
    (item.source || "").includes("bookroll-canvas") &&
    item.url &&
    item.url.startsWith("data:image/")
  );
}

function bookRollSlideKey(item) {
  const pageNumber = bookRollPageNumber(item);
  return pageNumber > 0 ? `page-${pageNumber}` : item.url;
}

function bookRollPageNumber(item) {
  const text = `${item.filename || ""} ${item.title || ""}`;
  const match = text.match(/(?:^|[-\s])(\d+)of(\d+)(?:[-\s.]|$)/i) || text.match(/\b(\d+)\s*\/\s*(\d+)\b/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function isBookRollUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "bookroll.let.media.kyoto-u.ac.jp" && parsed.pathname.startsWith("/bookroll/vue/");
  } catch {
    return false;
  }
}

function isSameBookRollDocument(firstUrl, secondUrl) {
  return bookRollDocumentKey(firstUrl) === bookRollDocumentKey(secondUrl);
}

function bookRollDocumentKey(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const vueIndex = segments.indexOf("vue");

    if (vueIndex >= 0) {
      return segments.slice(0, vueIndex + 3).join("/");
    }

    return parsed.pathname;
  } catch {
    return url || "";
  }
}

function bookRollPdfBaseName() {
  const material = bookRollStoredMaterial();
  const subject = material && material.subject ? sanitizeLabel(material.subject) : bookRollTitleLabel();
  const lessonNumber = bookRollLessonNumberLabel();
  return `bookroll-${subject}-${lessonNumber}`;
}

async function loadImageForPdf(item) {
  const image = await loadImage(item.url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const bytes = await canvasToJpegBytes(canvas);

  return {
    width: canvas.width,
    height: canvas.height,
    bytes
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      if (image.decode) {
        await image.decode().catch(() => {});
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("Failed to load a BookRoll slide image"));
    image.src = url;
  });
}

function canvasToJpegBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode a BookRoll slide image"));
        return;
      }

      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(() => reject(new Error("Failed to read a BookRoll slide image")));
    }, "image/jpeg", 0.92);
  });
}

function buildPdfFromImages(images) {
  if (images.length === 0) {
    throw new Error("No BookRoll slides collected yet");
  }

  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let length = 0;

  const appendText = (text) => appendBytes(encoder.encode(text));
  const appendBytes = (bytes) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const addObject = (objectNumber, bodyParts) => {
    offsets[objectNumber] = length;
    appendText(`${objectNumber} 0 obj\n`);
    for (const part of bodyParts) {
      if (typeof part === "string") {
        appendText(part);
      } else {
        appendBytes(part);
      }
    }
    appendText("\nendobj\n");
  };

  appendText("%PDF-1.4\n");

  const pageObjectNumbers = images.map((_, index) => 3 + index * 3);
  addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  addObject(2, [`<< /Type /Pages /Count ${images.length} /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(" ")}] >>`]);

  images.forEach((image, index) => {
    const pageObject = 3 + index * 3;
    const contentObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const width = Math.max(1, Math.round(image.width));
    const height = Math.max(1, Math.round(image.height));
    const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im${index + 1} Do\nQ\n`;

    addObject(pageObject, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im${index + 1} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`
    ]);
    addObject(contentObject, [`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`]);
    addObject(imageObject, [
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      image.bytes,
      "\nendstream"
    ]);
  });

  const xrefOffset = length;
  appendText(`xref\n0 ${offsets.length}\n`);
  appendText("0000000000 65535 f \n");
  for (let index = 1; index < offsets.length; index += 1) {
    appendText(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

function bookRollTitleLabel() {
  const firstSlide = bookRollSlides()[0];
  const source = firstSlide ? firstSlide.lessonTitle || `${firstSlide.filename} ${firstSlide.title}` : document.title;
  const cleaned = source
    .replace(/\bbookroll\b/gi, "")
    .replace(/\b\d+of\d+\b/gi, "")
    .replace(/\b\d{10,}\b/g, "")
    .replace(/\.(png|jpg|jpeg|pdf)\b/gi, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return cleaned || "lesson";
}

function bookRollLessonNumberLabel() {
  const material = bookRollStoredMaterial();
  if (material && material.lessonNumber) {
    return `lesson-${sanitizeLabel(material.lessonNumber)}`;
  }

  const firstSlide = bookRollSlides()[0];
  if (firstSlide && firstSlide.lessonNumber) {
    return `lesson-${sanitizeLabel(firstSlide.lessonNumber)}`;
  }

  const documentId = bookRollDocumentId(state.tabUrl);
  if (documentId && BOOKROLL_LESSON_BY_ID[documentId]) {
    return `lesson-${sanitizeLabel(BOOKROLL_LESSON_BY_ID[documentId])}`;
  }

  return "lesson";
}

function bookRollStoredMaterial() {
  const documentId = bookRollDocumentId(state.tabUrl);
  return documentId && state.bookRollMaterials ? state.bookRollMaterials[documentId] : null;
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

function sanitizeLabel(value) {
  return String(value)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "lesson";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function displayUrl(url) {
  if (!url || !url.startsWith("data:")) {
    return url;
  }

  const match = /^data:([^;,]+)[;,]/i.exec(url);
  const type = match ? match[1] : "data";
  return `${type} embedded data (${formatBytes(url.length)})`;
}

function setSummary(text) {
  elements.summary.textContent = text;
}
