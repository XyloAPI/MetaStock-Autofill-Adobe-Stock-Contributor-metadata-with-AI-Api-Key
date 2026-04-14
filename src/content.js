const ROOT_ID = "metastock-ai-root";
const PANEL_ID = "metastock-ai-panel";

const ADOBE = {
  grid: 'div.content-grid[data-t="assets-content-grid"]',
  tileWrapper: ".upload-tile__wrapper",
  cardImage: "img.upload-tile__thumbnail",
  activeWrapper: ".upload-tile__wrapper.active",
  title: 'textarea[data-t="asset-title-content-tagger"], textarea[aria-label="Content title"]',
  keywords: 'textarea[data-t="content-keywords-ui-textarea"], textarea[aria-label="Paste Keywords..."]',
  categorySelect: 'select[name="category"]',
  saveWork: '[data-t="save-work"], div.margin-left-small > button.button--action',
  originalNameText: '[data-t="asset-sidebar-footer"] .text-sregular',
  spinner: 'div[data-t="content-spinner-wrapper"]',
  keywordLoading: "div.keywords-input",
  sidebarThumbnail: '[data-t="asset-sidebar-header-thumbnail"] img, [data-t="asset-sidebar-header-thumbnail"]',
  genAi: "#content-tagger-generative-ai-checkbox",
  noReleases: 'input[data-t="has-release-no"]'
};

const SETTINGS_DEFAULTS = {
  keywordCount: 49,
  keywordLimitEnabled: true,
  titleMaxLength: 70,
  titleLimitEnabled: true,
  enableGenerativeAi: true
};

const state = {
  running: false,
  stopRequested: false,
  processed: 0,
  skipped: 0,
  total: 0,
  mode: "idle",
  currentFile: "",
  message: "Ready. Click Generate Current or Start Queue.",
  error: "",
  finishedAt: "",
  settings: { ...SETTINGS_DEFAULTS }
};

setupAutomationBridge();
void boot();

async function boot() {
  if (document.getElementById(ROOT_ID)) {
    return;
  }

  await stall(600);
  mountUi();
}

function mountUi() {
  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
  const logoUrl = runtime?.getURL ? runtime.getURL("src/assets/logo.png") : "";

  const root = document.createElement("section");
  root.id = ROOT_ID;
  root.innerHTML = `
    <section id="${PANEL_ID}">
      <header id="metastock-drag-handle">
        <div class="metastock-brand">
          ${logoUrl ? `<img src="${logoUrl}" alt="MetaStock logo" class="metastock-logo" />` : ""}
          <strong>AUTOMATION</strong>
        </div>
        <span class="metastock-badge" id="metastock-badge">Idle</span>
      </header>
      <h3>Ready</h3>
      <p id="metastock-ai-status">Ready</p>
      <div class="metastock-actions">
        <button id="metastock-ai-generate" type="button">Generate Current</button>
        <button id="metastock-ai-start-batch" type="button">Start Queue</button>
      </div>
      <div class="metastock-actions metastock-actions-secondary">
        <button id="metastock-ai-stop-batch" type="button" disabled>Stop</button>
      </div>
      <div class="metastock-progress-wrap">
        <span id="metastock-ai-progress">0 / 0</span>
        <span id="metastock-ai-selected-file" class="metastock-selected-file"></span>
      </div>
    </section>
  `;

  document.documentElement.appendChild(root);
  wireUi(root);
  enableDragging(root);
}

function wireUi(root) {
  const generateButton = root.querySelector("#metastock-ai-generate");
  const startBatchButton = root.querySelector("#metastock-ai-start-batch");
  const stopBatchButton = root.querySelector("#metastock-ai-stop-batch");
  const status = root.querySelector("#metastock-ai-status");
  const progress = root.querySelector("#metastock-ai-progress");
  const selectedFile = root.querySelector("#metastock-ai-selected-file");
  const badge = root.querySelector("#metastock-badge");

  generateButton.addEventListener("click", async () => {
    try {
      await runAutomation("current");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Generate current failed.";
      badge.textContent = "Error";
    } finally {
      applyAutomationUiState({ generateButton, startBatchButton, stopBatchButton, status, progress, selectedFile, badge });
    }
  });

  startBatchButton.addEventListener("click", async () => {
    try {
      await runAutomation("queue");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Queue failed to start.";
      badge.textContent = "Error";
    } finally {
      applyAutomationUiState({ generateButton, startBatchButton, stopBatchButton, status, progress, selectedFile, badge });
    }
  });

  stopBatchButton.addEventListener("click", () => {
    state.stopRequested = true;
    state.message = "Stop requested. Automation will stop after current file is done.";
    applyAutomationUiState({ generateButton, startBatchButton, stopBatchButton, status, progress, selectedFile, badge });
  });

  applyAutomationUiState({ generateButton, startBatchButton, stopBatchButton, status, progress, selectedFile, badge });
  setInterval(() => {
    applyAutomationUiState({ generateButton, startBatchButton, stopBatchButton, status, progress, selectedFile, badge });
  }, 700);
}

function setupAutomationBridge() {
  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;

  if (!runtime?.onMessage?.addListener) {
    return;
  }

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "metastock:start-automation") {
      if (state.running) {
        sendResponse({ ok: true, result: getAutomationSnapshot() });
        return false;
      }

      runAutomation(message.mode === "current" ? "current" : "queue")
        .catch((error) => {
          state.running = false;
          state.mode = "idle";
          state.error = error instanceof Error ? error.message : "Automation failed.";
          state.message = state.error;
          state.finishedAt = new Date().toISOString();
        });

      sendResponse({ ok: true, result: getAutomationSnapshot() });
      return false;
    }

    if (message?.type === "metastock:stop-automation") {
      state.stopRequested = true;
      state.message = "Stop requested. Automation will stop after current file is done.";
      sendResponse({ ok: true, result: getAutomationSnapshot() });
      return false;
    }

    if (message?.type === "metastock:get-automation-state") {
      sendResponse({ ok: true, result: getAutomationSnapshot() });
      return false;
    }

    return false;
  });
}

function getAutomationSnapshot() {
  return {
    running: state.running,
    stopRequested: state.stopRequested,
    processed: state.processed,
    skipped: state.skipped,
    total: state.total,
    mode: state.mode,
    currentFile: state.currentFile,
    message: state.message,
    error: state.error,
    finishedAt: state.finishedAt
  };
}

async function runAutomation(mode = "queue") {
  const latestSettings = await loadSettingsFromStorage();
  state.settings = { ...state.settings, ...latestSettings };

  const wrappers = getTileWrappers();
  if (!wrappers.length) {
    throw new Error("No Adobe Stock assets found on this page.");
  }

  const activeIndex = getActiveTileIndex();
  const indexes = mode === "current" ? [activeIndex >= 0 ? activeIndex : 0] : wrappers.map((_, index) => index);

  state.running = true;
  state.stopRequested = false;
  state.processed = 0;
  state.skipped = 0;
  state.total = indexes.length;
  state.mode = mode;
  state.error = "";
  state.currentFile = "";
  state.finishedAt = "";
  state.message = mode === "current" ? "Generate current started." : `Queue started for ${indexes.length} files.`;

  for (let step = 0; step < indexes.length; step += 1) {
    if (state.stopRequested) {
      break;
    }

    const index = indexes[step];
    let completed = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (state.stopRequested) {
        break;
      }

      try {
        await processOneAsset(index, step + 1, indexes.length);
        completed = true;
        break;
      } catch (error) {
        lastError = error;
        state.message = `Retry ${attempt}/3 failed on item ${step + 1}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        await stall(300 + attempt * 300);
      }
    }

    if (!completed) {
      state.skipped += 1;
      state.message = `Item ${step + 1}/${indexes.length} skipped: ${
        lastError instanceof Error ? lastError.message : "Failed to process"
      }`;
    }

    state.processed += 1;
  }

  state.running = false;
  state.mode = "idle";
  state.finishedAt = new Date().toISOString();

  if (state.stopRequested) {
    state.message = `Automation stopped. Done ${state.processed}/${state.total}, skipped ${state.skipped}.`;
    return;
  }

  state.message =
    state.total > 1
      ? `Queue complete. Processed ${state.processed}/${state.total}, skipped ${state.skipped}. Review and submit.`
      : "Generate current complete. Review and submit.";
}

async function processOneAsset(index, stepNumber, totalCount) {
  await selectAdobeTile(index);
  await stall(220);

  const payload = await collectCurrentPageContext("");
  state.currentFile = payload.filename || `Asset ${index + 1}`;
  state.message = `Generate ${stepNumber}/${totalCount}: ${state.currentFile}`;

  const metadata = await generateMetadata(payload);
  fillAdobeForm(metadata);
  await saveAdobeWorkIfNeeded();
}

async function collectCurrentPageContext(userNotes) {
  const titleField = document.querySelector(ADOBE.title);
  const keywordField = document.querySelector(ADOBE.keywords);
  const image = await getActiveImageInlineData();

  return {
    pageUrl: location.href,
    filename: getActiveFilename(),
    image,
    existingTitle: titleField?.value || "",
    existingKeywords: keywordField?.value || "",
    userNotes
  };
}

async function generateMetadata(payload) {
  const runtime = getRuntimeApi();
  const response = await runtime.sendMessage({
    type: "metastock:generate-metadata",
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to generate metadata.");
  }

  return response.result;
}

function fillAdobeForm(metadata) {
  const titleField = document.querySelector(ADOBE.title);
  const keywordField = document.querySelector(ADOBE.keywords);
  const categorySelect = document.querySelector(ADOBE.categorySelect);

  if (!titleField || !keywordField) {
    throw new Error("Adobe title/keywords textarea not found.");
  }

  // Force replace: clear existing values first to avoid Adobe UI state getting stuck
  // when the field already has metadata.
  forceReplaceFieldValue(titleField, metadata.title || "");
  forceReplaceFieldValue(
    keywordField,
    Array.isArray(metadata.keywords) ? metadata.keywords.join(", ") : ""
  );

  if (metadata.category && categorySelect) {
    setSelectByLabel(categorySelect, metadata.category);
  }

  applyAdobeDefaults();
}

function forceReplaceFieldValue(element, nextValue) {
  setNativeValue(element, "");
  setNativeValue(element, nextValue);
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function applyAdobeDefaults() {
  const genAi = document.querySelector(ADOBE.genAi);
  if (genAi) {
    if (state.settings.enableGenerativeAi && !genAi.checked) {
      genAi.click();
    }
    if (!state.settings.enableGenerativeAi && genAi.checked) {
      genAi.click();
    }
  }

  const noReleases = document.querySelector(ADOBE.noReleases);
  if (noReleases && !noReleases.checked) {
    noReleases.click();
  }
}

async function saveAdobeWorkIfNeeded() {
  const button = document.querySelector(ADOBE.saveWork);

  if (!button || button.disabled) {
    return;
  }

  button.click();
  await stall(400);

  let sawBusy = false;
  await waitFor(() => {
    const current = document.querySelector(ADOBE.saveWork);
    if (!current) {
      return true;
    }

    const label = normalizeText(current.textContent || "");
    if (current.disabled || label === "saving work...") {
      sawBusy = true;
      return false;
    }

    return sawBusy || !current.disabled;
  }, 12000).catch(() => {});
}

async function selectAdobeTile(index) {
  const wrappers = getTileWrappers();
  const wrapper = wrappers[index];

  if (!wrapper) {
    throw new Error(`Asset index ${index} not found.`);
  }

  wrapper.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const clickable =
    wrapper.querySelector(ADOBE.cardImage) ||
    wrapper.closest('[role="option"]') ||
    wrapper;

  let activated = false;
  for (let i = 0; i < 4; i += 1) {
    clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    clickable.click();
    clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    await stall(140);
    if (isWrapperActive(wrapper)) {
      activated = true;
      break;
    }
  }

  if (!activated) {
    await waitFor(() => isWrapperActive(wrapper) || getActiveTileIndex() === index, 5500);
  }

  await waitUntilPanelReady();
}

function isWrapperActive(wrapper) {
  if (!wrapper || !document.contains(wrapper)) {
    return false;
  }
  if (wrapper.classList.contains("active")) {
    return true;
  }
  const option = wrapper.closest('[role="option"]');
  return option?.getAttribute("aria-selected") === "true";
}

function getTileWrappers() {
  const grid = document.querySelector(ADOBE.grid);
  if (!grid) {
    return [];
  }
  return [...grid.querySelectorAll(ADOBE.tileWrapper)];
}

function getActiveTileIndex() {
  const wrappers = getTileWrappers();
  return wrappers.findIndex((wrapper) => wrapper.classList.contains("active"));
}

function getActiveFilename() {
  const footer = document.querySelector(ADOBE.originalNameText);
  const text = footer?.textContent || "";
  const match = text.match(/Original name\(s\):\s*(.+)$/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  const activeWrapper = document.querySelector(ADOBE.activeWrapper);
  const image = activeWrapper?.querySelector(ADOBE.cardImage);
  return image?.getAttribute("alt") || "";
}

async function waitUntilPanelReady() {
  await waitFor(() => Boolean(document.querySelector(ADOBE.title) && document.querySelector(ADOBE.keywords)), 5000);

  // Guard against infinite wait: some Adobe layouts keep keywords-input in DOM.
  const keywordWaitStart = Date.now();
  while (Date.now() - keywordWaitStart < 5000) {
    const loadingNode = document.querySelector(ADOBE.keywordLoading);
    if (!loadingNode) {
      break;
    }

    const isVisible = loadingNode.offsetParent !== null;
    const ariaBusy = loadingNode.getAttribute("aria-busy") === "true";
    const classBusy = /loading|spinner|busy/i.test(loadingNode.className || "");
    if (!isVisible && !ariaBusy && !classBusy) {
      break;
    }

    await stall(120);
  }

  const spinner = document.querySelector(ADOBE.spinner);
  if (spinner) {
    await waitFor(() => spinner.style.display !== "block", 5000).catch(() => {});
  }
}

async function getActiveImageInlineData() {
  const url = getActiveImageUrl();
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const dataUrl = await readBlobAsDataUrl(blob);
    const [, base64 = ""] = dataUrl.split(",", 2);
    return {
      inlineData: {
        mimeType: blob.type || "image/jpeg",
        data: base64
      }
    };
  } catch {
    return null;
  }
}

function getActiveImageUrl() {
  const sidebarThumbnail = document.querySelector(ADOBE.sidebarThumbnail);
  if (sidebarThumbnail && "src" in sidebarThumbnail && sidebarThumbnail.src) {
    return sidebarThumbnail.src;
  }

  const activeWrapper = document.querySelector(ADOBE.activeWrapper);
  const activeImage = activeWrapper?.querySelector(ADOBE.cardImage);
  if (activeImage?.src) {
    return activeImage.src;
  }

  const firstImage = document.querySelector(ADOBE.cardImage);
  return firstImage?.src || "";
}

function setNativeValue(element, value) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  element.textContent = String(value || "");
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectByLabel(select, labelText) {
  const normalizedTarget = normalizeText(labelText);
  const option = [...select.options].find((item) => normalizeText(item.textContent) === normalizedTarget);
  if (option) {
    setNativeValue(select, option.value);
  }
}

function applyAutomationUiState({ generateButton, startBatchButton, stopBatchButton, status, progress, selectedFile, badge }) {
  generateButton.disabled = state.running;
  startBatchButton.disabled = state.running;
  stopBatchButton.disabled = !state.running;
  status.textContent = compactStatusMessage(state.error || state.message || "Idle");
  progress.textContent = `${state.processed} / ${state.total}`;
  selectedFile.textContent = state.currentFile ? shortFileName(state.currentFile) : "";

  if (state.running) {
    badge.textContent = state.mode === "current" ? "Current" : "Queue";
    return;
  }

  if (state.error) {
    badge.textContent = "Error";
    return;
  }

  if (state.stopRequested) {
    badge.textContent = "Stopped";
    return;
  }

  if (state.total > 0 && state.processed >= state.total) {
    badge.textContent = "Done";
    return;
  }

  badge.textContent = "Idle";
}

function compactStatusMessage(message) {
  const text = normalizeText(message);
  if (!text) {
    return "Idle";
  }
  if (text.includes("queue complete")) {
    return `Done ${state.processed}/${state.total} · skip ${state.skipped}`;
  }
  if (text.includes("automation stopped")) {
    return `Stop ${state.processed}/${state.total}`;
  }
  if (text.includes("retry")) {
    return message.replace(/Retry\s*/i, "Retry ");
  }
  if (text.includes("generate")) {
    return message.length > 64 ? `${message.slice(0, 64)}…` : message;
  }
  return message.length > 64 ? `${message.slice(0, 64)}…` : message;
}

function shortFileName(value) {
  const name = String(value || "").trim();
  if (!name) {
    return "";
  }
  if (name.length <= 28) {
    return name;
  }
  return `${name.slice(0, 12)}…${name.slice(-12)}`;
}

function getRuntimeApi() {
  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
  if (!runtime?.sendMessage) {
    throw new Error("Chrome extension API is not available. Reload extension, then refresh Adobe page.");
  }
  return runtime;
}

function getStorageLocal() {
  return globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local || null;
}

async function loadSettingsFromStorage() {
  const storage = getStorageLocal();
  if (!storage?.get) {
    return { ...SETTINGS_DEFAULTS };
  }

  const loaded = await storage.get(SETTINGS_DEFAULTS);
  return {
    keywordCount: Math.min(49, Math.max(1, Number(loaded.keywordCount) || SETTINGS_DEFAULTS.keywordCount)),
    keywordLimitEnabled: Boolean(loaded.keywordLimitEnabled),
    titleMaxLength: Math.min(200, Math.max(20, Number(loaded.titleMaxLength) || SETTINGS_DEFAULTS.titleMaxLength)),
    titleLimitEnabled: Boolean(loaded.titleLimitEnabled),
    enableGenerativeAi: Boolean(loaded.enableGenerativeAi)
  };
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read asset thumbnail."));
    reader.readAsDataURL(blob);
  });
}

function stall(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await stall(100);
  }
  throw new Error("Timeout waiting for Adobe panel to be ready.");
}

function enableDragging(root) {
  const handle = root.querySelector("#metastock-drag-handle");
  if (!handle) {
    return;
  }

  const savedX = Number(localStorage.getItem("metastock_drag_x"));
  const savedY = Number(localStorage.getItem("metastock_drag_y"));

  if (Number.isFinite(savedX) && Number.isFinite(savedY)) {
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.left = `${savedX}px`;
    root.style.top = `${savedY}px`;
  }

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.style.cursor = "move";
  handle.addEventListener("mousedown", (event) => {
    dragging = true;
    const rect = root.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    root.style.right = "auto";
    root.style.bottom = "auto";
    event.preventDefault();
  });

  window.addEventListener("mousemove", (event) => {
    if (!dragging) {
      return;
    }

    const x = Math.max(8, Math.min(window.innerWidth - root.offsetWidth - 8, event.clientX - offsetX));
    const y = Math.max(8, Math.min(window.innerHeight - root.offsetHeight - 8, event.clientY - offsetY));
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) {
      return;
    }

    dragging = false;
    localStorage.setItem("metastock_drag_x", String(parseInt(root.style.left || "16", 10)));
    localStorage.setItem("metastock_drag_y", String(parseInt(root.style.top || "16", 10)));
  });
}
