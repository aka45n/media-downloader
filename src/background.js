const MEDIA_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "bmp",
  "tif",
  "tiff"
];

const MAX_ITEMS_PER_TAB = 400;
const candidatesByTab = new Map();

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open && tab.id >= 0) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  candidatesByTab.delete(tabId);
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url || details.url.startsWith("chrome-extension://")) {
      return;
    }

    const headers = details.responseHeaders || [];
    const contentTypeHeader = headers.find((header) => header.name.toLowerCase() === "content-type");
    const contentLengthHeader = headers.find((header) => header.name.toLowerCase() === "content-length");
    const contentType = contentTypeHeader ? contentTypeHeader.value.toLowerCase() : "";
    const fileType = detectFileType(details.url, contentType);

    if (!fileType) {
      return;
    }

    if (looksLikeSiteDecoration(details.url)) {
      return;
    }

    addCandidate(details.tabId, {
      url: details.url,
      type: fileType,
      source: "network",
      method: details.method,
      statusCode: details.statusCode,
      contentType,
      size: contentLengthHeader ? Number(contentLengthHeader.value) : null,
      filename: filenameFromUrl(details.url),
      pageUrl: details.documentUrl || details.initiator || ""
    });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "content-candidates" && sender.tab && sender.tab.id >= 0) {
    for (const item of message.items || []) {
      addCandidate(sender.tab.id, item);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "get-candidates") {
    sendResponse({
      ok: true,
      items: getCandidates(message.tabId)
    });
    return false;
  }

  if (message.type === "clear-candidates") {
    candidatesByTab.delete(message.tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "clear-bookroll-candidates") {
    clearBookRollCandidates(message.tabId, message.pageUrl);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "download") {
    downloadCandidate(message.item, message.options)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

function addCandidate(tabId, item) {
  const normalized = normalizeCandidate(item);
  if (!normalized) {
    return;
  }

  const items = candidatesByTab.get(tabId) || [];
  const existingIndex = items.findIndex((candidate) => candidate.url === normalized.url);

  if (existingIndex >= 0) {
    items[existingIndex] = mergeCandidate(items[existingIndex], normalized);
  } else {
    items.unshift(normalized);
  }

  candidatesByTab.set(tabId, items.slice(0, MAX_ITEMS_PER_TAB));
}

function getCandidates(tabId) {
  return candidatesByTab.get(tabId) || [];
}

function clearBookRollCandidates(tabId, pageUrl = "") {
  const items = candidatesByTab.get(tabId) || [];
  const keptItems = items.filter((item) => {
    const isBookRollCanvas = (item.source || "").includes("bookroll-canvas");
    if (!isBookRollCanvas) {
      return true;
    }

    return pageUrl && item.pageUrl && bookRollDocumentKey(item.pageUrl) !== bookRollDocumentKey(pageUrl);
  });

  candidatesByTab.set(tabId, keptItems);
}

function normalizeCandidate(item) {
  if (!item || !item.url) {
    return null;
  }

  const type = item.type || detectFileType(item.url, item.contentType || "");
  if (!type) {
    return null;
  }

  if (looksLikeSiteDecoration(item.url, item.filename || item.title || "")) {
    return null;
  }

  return {
    id: stableId(item.url),
    url: item.url,
    type,
    source: item.source || "page",
    method: item.method || "GET",
    statusCode: item.statusCode || null,
    filename: item.filename || filenameFromUrl(item.url),
    size: Number.isFinite(item.size) ? item.size : null,
    contentType: item.contentType || "",
    pageUrl: item.pageUrl || "",
    title: item.title || "",
    lessonTitle: item.lessonTitle || "",
    lessonNumber: item.lessonNumber || "",
    discoveredAt: Date.now()
  };
}

function mergeCandidate(oldItem, newItem) {
  return {
    ...oldItem,
    ...newItem,
    source: oldItem.source === newItem.source ? oldItem.source : `${oldItem.source}, ${newItem.source}`,
    title: oldItem.title || newItem.title,
    lessonTitle: oldItem.lessonTitle || newItem.lessonTitle,
    lessonNumber: oldItem.lessonNumber || newItem.lessonNumber,
    filename: oldItem.filename || newItem.filename,
    size: oldItem.size || newItem.size,
    contentType: oldItem.contentType || newItem.contentType,
    discoveredAt: Math.max(oldItem.discoveredAt || 0, newItem.discoveredAt || 0)
  };
}

function bookRollDocumentKey(pageUrl) {
  try {
    const parsed = new URL(pageUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const vueIndex = segments.indexOf("vue");

    if (vueIndex >= 0) {
      return segments.slice(0, vueIndex + 3).join("/");
    }

    return parsed.pathname;
  } catch {
    return pageUrl || "";
  }
}

async function downloadCandidate(item, options = {}) {
  const normalized = normalizeCandidate(item);
  if (!normalized) {
    throw new Error("Download item is not a supported PDF or image URL.");
  }

  return chrome.downloads.download({
    url: normalized.url,
    filename: sanitizeFilename(normalized.filename),
    headers: downloadHeaders(normalized),
    saveAs: Boolean(options.saveAs),
    conflictAction: "uniquify"
  });
}

function downloadHeaders(item) {
  if (item.url.startsWith("data:") || !item.pageUrl || !/^https?:\/\//i.test(item.pageUrl)) {
    return [];
  }

  return [
    {
      name: "Referer",
      value: item.pageUrl
    }
  ];
}

function detectFileType(url, contentType = "") {
  const dataType = dataUrlMediaType(url);
  if (dataType) {
    return dataType;
  }

  if (contentType.includes("application/pdf")) {
    return "pdf";
  }

  if (contentType.startsWith("image/")) {
    const subtype = contentType.split(";")[0].split("/")[1] || "image";
    return subtype === "jpeg" ? "jpg" : subtype;
  }

  const extension = extensionFromUrl(url);
  return MEDIA_EXTENSIONS.includes(extension) ? extension : "";
}

function extensionFromUrl(url) {
  const dataType = dataUrlMediaType(url);
  if (dataType) {
    return dataType;
  }

  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function filenameFromUrl(url) {
  const dataType = dataUrlMediaType(url);
  if (dataType) {
    return `embedded-image-${Date.now()}.${dataType}`;
  }

  try {
    const parsed = new URL(url);
    const lastSegment = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (lastSegment && lastSegment.includes(".")) {
      return lastSegment;
    }

    const type = detectFileType(url);
    return `download-${Date.now()}${type ? `.${type}` : ""}`;
  } catch {
    return `download-${Date.now()}`;
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180) || `download-${Date.now()}`;
}

function looksLikeSiteDecoration(url, extra = "") {
  if (url.startsWith("data:")) {
    return false;
  }

  const haystack = `${url} ${filenameFromUrl(url)} ${extra}`.toLowerCase();
  return /\b(favicon|apple-touch-icon|site-icon|logo|brand|sprite)\b/.test(haystack);
}

function dataUrlMediaType(url) {
  const match = /^data:(image\/([a-z0-9.+-]+)|application\/pdf)[;,]/i.exec(url);
  if (!match) {
    return "";
  }

  if (match[1].toLowerCase() === "application/pdf") {
    return "pdf";
  }

  const subtype = match[2].toLowerCase();
  return subtype === "jpeg" ? "jpg" : subtype.replace("svg+xml", "svg");
}

function stableId(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `item-${Math.abs(hash)}`;
}
