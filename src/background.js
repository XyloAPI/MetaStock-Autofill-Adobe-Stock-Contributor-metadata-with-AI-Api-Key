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

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set(existing);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "metastock:generate-metadata") {
    handleGenerateMetadata(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        })
      );

    return true;
  }

  if (message?.type === "metastock:get-settings") {
    chrome.storage.local
      .get(DEFAULT_SETTINGS)
      .then((settings) => sendResponse({ ok: true, result: settings }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to load settings"
        })
      );

    return true;
  }

  if (message?.type === "metastock:list-models") {
    handleListModels()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to list models"
        })
      );

    return true;
  }

  return false;
});

async function handleGenerateMetadata(payload) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const provider = settings.provider === "groq" ? "groq" : "gemini";
  const apiKeys = getApiKeys(settings, provider);

  if (!apiKeys.length) {
    throw new Error(
      provider === "groq"
        ? "Groq API key belum disimpan di extension."
        : "Gemini API key belum disimpan di extension."
    );
  }

  const prompt = buildPrompt(payload, settings);
  const text =
    provider === "groq"
      ? await generateViaGroq({ payload, settings, apiKeys, prompt })
      : await generateViaGemini({ payload, settings, apiKeys, prompt });

  if (!text) {
    throw new Error(
      provider === "groq"
        ? "Groq tidak mengembalikan konten yang bisa dipakai."
        : "Gemini tidak mengembalikan konten yang bisa dipakai."
    );
  }

  let parsed;
  const jsonText = extractJsonObjectText(text);

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const providerLabel = provider === "groq" ? "Groq" : "Gemini";
    throw new Error(`Respons ${providerLabel} bukan JSON valid: ${text}`);
  }

  return normalizeMetadata(parsed, settings);
}

async function handleListModels() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const provider = settings.provider === "groq" ? "groq" : "gemini";
  const apiKeys = getApiKeys(settings, provider);

  if (!apiKeys.length) {
    throw new Error(
      provider === "groq"
        ? "Simpan minimal satu Groq API key dulu untuk memuat model."
        : "Simpan minimal satu Gemini API key dulu untuk memuat model."
    );
  }

  const models =
    provider === "groq"
      ? await listGroqModels(apiKeys)
      : await listGeminiModels(apiKeys);

  return {
    provider,
    models,
    fetchedAt: new Date().toISOString()
  };
}

function buildParts(prompt, payload) {
  const parts = [{ text: prompt }];

  if (payload?.image?.inlineData?.data) {
    parts.push({
      inlineData: payload.image.inlineData
    });
  }

  return parts;
}

async function generateViaGemini({ payload, settings, apiKeys, prompt }) {
  const body = {
    systemInstruction: {
      parts: [
        {
          text:
            "You generate commercial stock asset metadata. Return strict JSON only with keys title, keywords, category, explanation. Title must be concise and natural. Keywords must be unique and ordered by relevance."
        }
      ]
    },
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json"
    },
    contents: [
      {
        role: "user",
        parts: buildParts(prompt, payload)
      }
    ]
  };

  const data = await fetchGeminiWithKeyFallback({
    apiKeys,
    path: "/v1beta/models/" + encodeURIComponent(settings.model) + ":generateContent",
    method: "POST",
    body
  });

  return extractGeminiText(data);
}

async function generateViaGroq({ payload, settings, apiKeys, prompt }) {
  const userContent = [{ type: "text", text: prompt }];
  const imageUrl = toDataUrl(payload?.image?.inlineData);

  if (imageUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl }
    });
  }

  const body = {
    model: settings.model || "llama-3.3-70b-versatile",
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content:
          "You generate commercial stock asset metadata. Return strict JSON only with keys title, keywords, category, explanation. Title must be concise and natural. Keywords must be unique and ordered by relevance."
      },
      {
        role: "user",
        content: userContent
      }
    ]
  };

  try {
    const data = await fetchGroqWithKeyFallback({
      apiKeys,
      path: "/openai/v1/chat/completions",
      method: "POST",
      body
    });
    return String(data?.choices?.[0]?.message?.content || "").trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    const imagePayloadRejected =
      imageUrl &&
      (/400/.test(message) ||
        /image_url|image|vision|multimodal|invalid_request_error/i.test(message));

    if (!imagePayloadRejected) {
      throw error;
    }

    const fallbackBody = {
      model: settings.model || "llama-3.3-70b-versatile",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You generate commercial stock asset metadata. Return strict JSON only with keys title, keywords, category, explanation. Title must be concise and natural. Keywords must be unique and ordered by relevance."
        },
        {
          role: "user",
          content:
            `${prompt}\n\nImage input unavailable for this model. Use filename/existing metadata/user notes context only.`
        }
      ]
    };

    const data = await fetchGroqWithKeyFallback({
      apiKeys,
      path: "/openai/v1/chat/completions",
      method: "POST",
      body: fallbackBody
    });
    return String(data?.choices?.[0]?.message?.content || "").trim();
  }
}

async function listGeminiModels(apiKeys) {
  const data = await fetchGeminiWithKeyFallback({
    apiKeys,
    path: "/v1beta/models?pageSize=200",
    method: "GET"
  });

  return (data.models || [])
    .filter((model) => Array.isArray(model.supportedGenerationMethods))
    .filter((model) => model.supportedGenerationMethods.includes("generateContent"))
    .filter((model) => String(model.name || "").startsWith("models/gemini"))
    .map((model) => ({
      name: String(model.name || "").replace(/^models\//, ""),
      displayName: model.displayName || String(model.name || "").replace(/^models\//, ""),
      description: model.description || ""
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function listGroqModels(apiKeys) {
  const data = await fetchGroqWithKeyFallback({
    apiKeys,
    path: "/openai/v1/models",
    method: "GET"
  });

  return (data.data || [])
    .map((model) => ({
      name: String(model.id || ""),
      displayName: String(model.id || ""),
      description: ""
    }))
    .filter((model) => Boolean(model.name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildPrompt(payload, settings) {
  const context = {
    pageUrl: payload.pageUrl,
    language: settings.language,
    titleMaxLength: settings.titleMaxLength,
    titleLimitEnabled: settings.titleLimitEnabled,
    keywordCount: settings.keywordCount,
    keywordLimitEnabled: settings.keywordLimitEnabled,
    enableGenerativeAi: settings.enableGenerativeAi,
    filename: payload.filename || "",
    existingTitle: payload.existingTitle || "",
    existingKeywords: payload.existingKeywords || "",
    userNotes: payload.userNotes || ""
  };

  return [
    "Create metadata for one Adobe Stock submission.",
    `Preferred language: ${context.language}.`,
    context.titleLimitEnabled
      ? `Title must be at most ${context.titleMaxLength} characters.`
      : "Title may exceed usual length when context needs it.",
    context.keywordLimitEnabled
      ? `Return exactly ${context.keywordCount} keywords.`
      : "Do not force exact keyword count; return all highly relevant keywords only.",
    context.enableGenerativeAi
      ? "This asset is generated with AI."
      : "This asset is not marked as generated with AI.",
    "Follow Adobe Stock style: avoid brands, copyrighted characters, or unverifiable claims.",
    "Return JSON only.",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => part?.text || "")
    .join("")
    .trim();
}

function extractJsonObjectText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return raw;
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  return raw;
}

function toDataUrl(inlineData) {
  if (!inlineData?.data) {
    return "";
  }

  const mimeType = inlineData.mimeType || "image/jpeg";
  return `data:${mimeType};base64,${inlineData.data}`;
}

function normalizeMetadata(parsed, settings) {
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
    : String(parsed.keywords || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  const uniqueKeywords = [...new Set(keywords)]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const finalKeywords = settings.keywordLimitEnabled
    ? uniqueKeywords.slice(0, settings.keywordCount)
    : uniqueKeywords;

  const finalTitle = String(parsed.title || "").trim();

  return {
    title: settings.titleLimitEnabled ? finalTitle.slice(0, settings.titleMaxLength) : finalTitle,
    keywords: finalKeywords,
    category: String(parsed.category || "").trim(),
    explanation: String(parsed.explanation || "").trim()
  };
}

function getApiKeys(settings, provider = "gemini") {
  const candidates = [];

  if (provider === "groq") {
    if (Array.isArray(settings.groqApiKeys)) {
      candidates.push(...settings.groqApiKeys);
    }
    if (settings.groqApiKey) {
      candidates.push(settings.groqApiKey);
    }
  } else {
    if (Array.isArray(settings.apiKeys)) {
      candidates.push(...settings.apiKeys);
    }
    if (settings.apiKey) {
      candidates.push(settings.apiKey);
    }
  }

  return [...new Set(candidates.map((item) => String(item || "").trim()).filter(Boolean))];
}

async function fetchGeminiWithKeyFallback({ apiKeys, path, method, body }) {
  return fetchWithProviderKeyFallback({
    apiKeys,
    providerName: "Gemini",
    requestLabel: "Gemini request",
    doRequest: (apiKey, signal) =>
      fetch("https://generativelanguage.googleapis.com" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: body ? JSON.stringify(body) : undefined,
        signal
      })
  });
}

async function fetchGroqWithKeyFallback({ apiKeys, path, method, body }) {
  return fetchWithProviderKeyFallback({
    apiKeys,
    providerName: "Groq",
    requestLabel: "Groq request",
    doRequest: (apiKey, signal) =>
      fetch("https://api.groq.com" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: body ? JSON.stringify(body) : undefined,
        signal
      })
  });
}

async function fetchWithProviderKeyFallback({ apiKeys, providerName, requestLabel, doRequest }) {
  const failures = [];

  for (const apiKey of apiKeys) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;

    try {
      response = await doRequest(apiKey, controller.signal);
    } catch (error) {
      clearTimeout(timeout);
      const message = formatFetchError(error);
      failures.push(`key ...${apiKey.slice(-4)} => ${message}`);
      continue;
    }

    clearTimeout(timeout);

    if (response.ok) {
      return response.json();
    }

    const text = await response.text();
    const detail = summarizeErrorText(text);
    failures.push(`key ...${apiKey.slice(-4)} => ${response.status}${detail ? ` (${detail})` : ""}`);

    if (!shouldTryNextKey(response.status)) {
      throw new Error(`${requestLabel} gagal (${response.status}): ${text}`);
    }
  }

  throw new Error(
    `Semua API key ${providerName} gagal dipakai. Detail: ` + failures.join(", ")
  );
}

function shouldTryNextKey(status) {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

function formatFetchError(error) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }

  if (error instanceof TypeError) {
    return "network-error";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "unknown-fetch-error";
}

function summarizeErrorText(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return "";
  }
  return raw.slice(0, 180);
}
