const DEFAULT_SETTINGS = {
  provider: "gemini",
  apiKey: "",
  apiKeys: [],
  groqApiKey: "",
  groqApiKeys: [],
  model: "gemini-2.5-flash",
  language: "id",
  keywordCount: 49,
  keywordLimitEnabled: true,
  titleMaxLength: 70,
  titleLimitEnabled: true,
  enableGenerativeAi: true
};

const DEFAULT_MODELS_BY_PROVIDER = {
  gemini: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }
  ],
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
    { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" }
  ]
};

const form = document.getElementById("settings-form");
const status = document.getElementById("status");
const providerSelect = document.getElementById("provider");
const apiKeysFile = document.getElementById("apiKeysFile");
const apiKeysText = document.getElementById("apiKeysText");
const groqApiKeysText = document.getElementById("groqApiKeysText");
const modelSelect = document.getElementById("model");
const refreshModelsButton = document.getElementById("refresh-models");
const modelsStatus = document.getElementById("models-status");
const generateCurrentButton = document.getElementById("generate-current");
const startAutomationButton = document.getElementById("start-automation");
const stopAutomationButton = document.getElementById("stop-automation");
const automationStatus = document.getElementById("automation-status");
const automationBadge = document.getElementById("automation-badge");

let automationPollTimer = null;

renderModelOptions([], DEFAULT_SETTINGS.model, DEFAULT_SETTINGS.provider);
hydrate();
refreshAutomationState();
automationPollTimer = setInterval(refreshAutomationState, 1500);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = readSettingsForm();
  await setStorageValue(payload);
  status.textContent = `Settings saved. ${getActiveProviderKeyCount(payload)} active key(s) for provider ${payload.provider}.`;
});

providerSelect.addEventListener("change", () => {
  const provider = providerSelect.value === "groq" ? "groq" : "gemini";
  renderModelOptions([], getDefaultModelForProvider(provider), provider);
});

apiKeysFile.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];

  if (!file) {
    return;
  }

  const text = await file.text();
  const merged = [...new Set([...parseApiKeys(apiKeysText.value), ...parseApiKeys(text)])];
  apiKeysText.value = merged.join("\n");
  status.textContent = `Imported ${merged.length} unique key(s) from textarea + file.`;
  apiKeysFile.value = "";
});

refreshModelsButton.addEventListener("click", async () => {
  try {
    const provider = providerSelect.value === "groq" ? "groq" : "gemini";
    const apiKeys =
      provider === "groq"
        ? parseApiKeys(groqApiKeysText.value)
        : parseApiKeys(apiKeysText.value);

    if (!apiKeys.length) {
      modelsStatus.textContent = `Add at least one ${provider === "groq" ? "Groq" : "Gemini"} API key before refreshing models.`;
      return;
    }

    modelsStatus.textContent = `Loading models from ${provider === "groq" ? "Groq" : "Gemini"}...`;
    refreshModelsButton.disabled = true;

    if (provider === "groq") {
      await setStorageValue({
        provider,
        groqApiKey: apiKeys[0] || "",
        groqApiKeys: apiKeys
      });
    } else {
      await setStorageValue({
        provider,
        apiKey: apiKeys[0] || "",
        apiKeys
      });
    }

    const runtime = getRuntimeApi();
    const response = await runtime.sendMessage({
      type: "metastock:list-models"
    });
    
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load models.");
    }

    const models = response.result.models || [];
    const options = models.map((item) => ({
      value: item.name,
      label: item.displayName || item.name
    }));
    const selected = modelSelect.value || getDefaultModelForProvider(provider);

    renderModelOptions(options, selected, provider);
    const current = await getStorageApi().get({ availableModelsByProvider: {} });
    const availableModelsByProvider = {
      ...(current.availableModelsByProvider || {}),
      [provider]: models
    };
    await setStorageValue({
      availableModelsByProvider,
      availableModelsFetchedAt: response.result.fetchedAt,
      provider,
      model: modelSelect.value || selected
    });

    modelsStatus.textContent = `${provider === "groq" ? "Groq" : "Gemini"} models loaded: ${models.length} item(s).`;
  } catch (error) {
    modelsStatus.textContent = error instanceof Error ? error.message : "Failed to refresh models.";
  } finally {
    refreshModelsButton.disabled = false;
  }
});

generateCurrentButton.addEventListener("click", () => startAutomation("current"));
startAutomationButton.addEventListener("click", () => startAutomation("queue"));

stopAutomationButton.addEventListener("click", async () => {
  try {
    const tab = await getAdobeTab();
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "metastock:stop-automation"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to send stop.");
    }

    applyAutomationState(response.result);
  } catch (error) {
    automationStatus.textContent =
      error instanceof Error ? error.message : "Failed to send stop.";
    automationBadge.textContent = "Error";
    automationBadge.className = "automation-badge error";
  }
});

async function hydrate() {
  const storage = getStorageApi();
  const data = await storage.get({
    ...DEFAULT_SETTINGS,
    availableModels: [],
    availableModelsByProvider: {},
    availableModelsFetchedAt: ""
  });

  providerSelect.value = data.provider === "groq" ? "groq" : "gemini";

  if (Array.isArray(data.apiKeys) && data.apiKeys.length) {
    apiKeysText.value = data.apiKeys.join("\n");
  } else if (data.apiKey) {
    apiKeysText.value = data.apiKey;
  }
  if (Array.isArray(data.groqApiKeys) && data.groqApiKeys.length) {
    groqApiKeysText.value = data.groqApiKeys.join("\n");
  } else if (data.groqApiKey) {
    groqApiKeysText.value = data.groqApiKey;
  }

  for (const [key, value] of Object.entries(data)) {
    if (
      key === "provider" ||
      key === "apiKey" ||
      key === "apiKeys" ||
      key === "groqApiKey" ||
      key === "groqApiKeys" ||
      key === "availableModels" ||
      key === "availableModelsByProvider" ||
      key === "availableModelsFetchedAt"
    ) {
      continue;
    }

    const field = form.elements.namedItem(key);
    if (field) {
      if (field instanceof HTMLInputElement && field.type === "checkbox") {
        field.checked = Boolean(value);
      } else {
        field.value = String(value);
      }
    }
  }

  const provider = providerSelect.value === "groq" ? "groq" : "gemini";
  const normalizedByProvider = {
    ...(data.availableModelsByProvider || {})
  };
  if (!normalizedByProvider.gemini && Array.isArray(data.availableModels) && data.availableModels.length) {
    normalizedByProvider.gemini = data.availableModels;
  }
  const providerModels = Array.isArray(normalizedByProvider[provider])
    ? normalizedByProvider[provider]
    : [];
  const options = providerModels.map((item) => ({
    value: item.name,
    label: item.displayName || item.name
  }));

  renderModelOptions(options, data.model, provider);

  if (data.availableModelsFetchedAt) {
    const when = new Date(data.availableModelsFetchedAt);
    modelsStatus.textContent = `Model list last refreshed at ${when.toLocaleString()}.`;
  }
}

async function setStorageValue(payload) {
  const storage = getStorageApi();
  await storage.set(payload);
}

function readSettingsForm() {
  const formData = new FormData(form);
  const provider = String(formData.get("provider") || "gemini").trim() === "groq" ? "groq" : "gemini";
  const apiKeys = parseApiKeys(String(formData.get("apiKeysText") || ""));
  const groqApiKeysRaw = parseApiKeys(String(formData.get("groqApiKeysText") || ""));
  const groqApiKeys = groqApiKeysRaw.length ? groqApiKeysRaw : apiKeys;

  return {
    provider,
    apiKey: apiKeys[0] || "",
    apiKeys,
    groqApiKey: groqApiKeys[0] || "",
    groqApiKeys,
    model:
      String(formData.get("model") || "").trim() ||
      getDefaultModelForProvider(provider),
    language: String(formData.get("language") || "").trim() || DEFAULT_SETTINGS.language,
    keywordCount: clampNumber(formData.get("keywordCount"), 1, 49, DEFAULT_SETTINGS.keywordCount),
    keywordLimitEnabled: formData.get("keywordLimitEnabled") !== null,
    titleMaxLength: clampNumber(formData.get("titleMaxLength"), 20, 200, DEFAULT_SETTINGS.titleMaxLength),
    titleLimitEnabled: formData.get("titleLimitEnabled") !== null,
    enableGenerativeAi: formData.get("enableGenerativeAi") !== null
  };
}

async function refreshAutomationState() {
  try {
    const tab = await getAdobeTab();
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "metastock:get-automation-state"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to read automation status.");
    }

    applyAutomationState(response.result);
  } catch {
    automationStatus.textContent = "Open Adobe Stock upload page to use automation.";
    automationBadge.textContent = "Idle";
    automationBadge.className = "automation-badge";
    startAutomationButton.disabled = false;
    stopAutomationButton.disabled = true;
  }
}

function applyAutomationState(state) {
  const snapshot = state || {
    running: false,
    stopRequested: false,
    processed: 0,
    total: 0,
    mode: "idle",
    currentFile: "",
    message: "Idle",
    error: ""
  };

  automationStatus.textContent = snapshot.error || snapshot.message || "Idle";

  if (snapshot.running) {
    automationBadge.textContent = snapshot.mode === "current" ? "Current" : "Queue";
    automationBadge.className = "automation-badge running";
    generateCurrentButton.disabled = true;
    startAutomationButton.disabled = true;
    stopAutomationButton.disabled = false;
    return;
  }

  generateCurrentButton.disabled = false;
  startAutomationButton.disabled = false;
  stopAutomationButton.disabled = true;

  if (snapshot.error) {
    automationBadge.textContent = "Error";
    automationBadge.className = "automation-badge error";
    return;
  }

  if (snapshot.stopRequested) {
    automationBadge.textContent = "Stopped";
    automationBadge.className = "automation-badge stopped";
    return;
  }

  if (snapshot.total > 0 && snapshot.processed >= snapshot.total) {
    automationBadge.textContent = "Done";
    automationBadge.className = "automation-badge done";
    return;
  }

  automationBadge.textContent = "Idle";
  automationBadge.className = "automation-badge";
}

async function getAdobeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id || !/^https:\/\/contributor\.stock\.adobe\.com\//.test(tab.url || "")) {
    throw new Error("Open contributor.stock.adobe.com/en/uploads first.");
  }

  return tab;
}

async function startAutomation(mode) {
  try {
    const payload = readSettingsForm();
    await setStorageValue(payload);
    status.textContent = `Settings saved. ${getActiveProviderKeyCount(payload)} active key(s) for provider ${payload.provider}.`;

    const tab = await getAdobeTab();
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "metastock:start-automation",
      mode
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start automation.");
    }

    applyAutomationState(response.result);
  } catch (error) {
    automationStatus.textContent =
      error instanceof Error ? error.message : "Failed to start automation.";
    automationBadge.textContent = "Error";
    automationBadge.className = "automation-badge error";
  }
}

function getStorageApi() {
  const storage = globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local;

  if (!storage?.get || !storage?.set) {
    throw new Error(
      "Chrome storage API is unavailable. Reload extension in chrome://extensions and reopen popup."
    );
  }

  return storage;
}

function getRuntimeApi() {
  const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;

  if (!runtime?.sendMessage) {
    throw new Error(
      "Chrome runtime API is unavailable. Reload extension in chrome://extensions and reopen popup."
    );
  }

  return runtime;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function parseApiKeys(value) {
  return [...new Set(
    String(value || "")
      .split(/[\n,\r;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function renderModelOptions(options, selectedValue, provider = "gemini") {
  const fallbackOptions = options.length ? options : getDefaultModelsForProvider(provider);
  const providerDefaultModel = getDefaultModelForProvider(provider);

  modelSelect.innerHTML = "";

  for (const option of fallbackOptions) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    modelSelect.appendChild(element);
  }

  if ([...modelSelect.options].some((option) => option.value === selectedValue)) {
    modelSelect.value = selectedValue;
    return;
  }

  if (selectedValue) {
    const custom = document.createElement("option");
    custom.value = selectedValue;
    custom.textContent = `${selectedValue} (saved)`;
    modelSelect.appendChild(custom);
    modelSelect.value = selectedValue;
    return;
  }

  modelSelect.value = providerDefaultModel;
}

function getDefaultModelsForProvider(provider) {
  return DEFAULT_MODELS_BY_PROVIDER[provider] || DEFAULT_MODELS_BY_PROVIDER.gemini;
}

function getDefaultModelForProvider(provider) {
  const options = getDefaultModelsForProvider(provider);
  return options[0]?.value || DEFAULT_SETTINGS.model;
}

function getActiveProviderKeyCount(payload) {
  return payload.provider === "groq" ? payload.groqApiKeys.length : payload.apiKeys.length;
}
