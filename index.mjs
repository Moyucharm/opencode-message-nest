import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const DEFAULT_TITLE = "OpenCode";
const DEFAULT_PREVIEW_LIMIT = 30;
const REQUEST_TIMEOUT_MS = 10000;
const GLOBAL_CONFIG_FILE_NAMES = [
  "opencode-notify.json",
  "opencode-notify.jsonc",
  "opencode-notify.config.json",
  "opencode-notify.config.jsonc",
];
const PROJECT_CONFIG_FILE_NAMES = [
  ".opencode-notify.json",
  ".opencode-notify.jsonc",
  "opencode-notify.config.json",
  "opencode-notify.config.jsonc",
];

const latestTextBySession = new Map();
const lastCompletedPreviewBySession = new Map();

let missingTokenWarned = false;
let missingApiUrlWarned = false;
const warnedConfigPaths = new Set();

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
}

function parsePreviewLimit(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PREVIEW_LIMIT;
  }

  return parsed;
}

function parseOptionalPreviewLimit(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shorten(value, limit = DEFAULT_PREVIEW_LIMIT) {
  const text = normalizeText(value);
  if (!text) {
    return "无详情";
  }

  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}...`;
}

function extractQuestionPreview(properties) {
  const questions = Array.isArray(properties?.questions)
    ? properties.questions
    : [];

  for (const item of questions) {
    const text = normalizeText(item?.question);
    if (text) {
      return text;
    }
  }

  return "";
}

function extractPermissionPreview(input) {
  const candidates = [
    input?.metadata?.command,
    input?.metadata?.description,
    input?.metadata?.prompt,
    Array.isArray(input?.patterns) ? input.patterns.join(" ") : "",
    input?.pattern,
    input?.permission,
  ];

  for (const candidate of candidates) {
    const text = normalizeText(typeof candidate === "string" ? candidate : "");
    if (text) {
      return text;
    }
  }

  return "";
}

function extractErrorPreview(properties) {
  const error = properties?.error;
  const candidates = [
    error?.data?.message,
    error?.message,
    error?.name,
    properties?.sessionID,
  ];

  for (const candidate of candidates) {
    const text = normalizeText(typeof candidate === "string" ? candidate : "");
    if (text) {
      return text;
    }
  }

  return "";
}

function stripJsonComments(input) {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
    }
  }

  return result;
}

function stripTrailingCommas(input) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (!inString && char === ",") {
      let lookahead = index + 1;
      while (lookahead < input.length && /\s/.test(input[lookahead])) {
        lookahead += 1;
      }

      if (input[lookahead] === "}" || input[lookahead] === "]") {
        continue;
      }
    }

    result += char;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
    }
  }

  return result;
}

function parseJsonc(input) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(input)));
}

function normalizePartialConfig(raw) {
  if (!isPlainObject(raw)) {
    return {};
  }

  return {
    token: normalizeText(raw.token),
    apiUrl: normalizeText(raw.apiUrl ?? raw.url),
    title: normalizeText(raw.title),
    previewLimit: parseOptionalPreviewLimit(raw.previewLimit),
  };
}

function mergeConfig(baseConfig, partialConfig) {
  return {
    token: partialConfig.token || baseConfig.token,
    apiUrl: partialConfig.apiUrl || baseConfig.apiUrl,
    title: partialConfig.title || baseConfig.title,
    previewLimit: partialConfig.previewLimit ?? baseConfig.previewLimit,
  };
}

function resolveConfigPath(filePath, baseDirectory) {
  if (!filePath) {
    return "";
  }

  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2));
  }

  if (isAbsolute(filePath)) {
    return filePath;
  }

  return resolve(baseDirectory || process.cwd(), filePath);
}

async function readConfigFile(filePath) {
  const source = await readFile(filePath, "utf8");
  return normalizePartialConfig(parseJsonc(source));
}

function warnConfigError(filePath, error) {
  if (warnedConfigPaths.has(filePath)) {
    return;
  }

  warnedConfigPaths.add(filePath);
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[opencode-notify] failed to read config file ${filePath}: ${message}`);
}

async function loadConfigFromCandidates(paths) {
  let config = {};

  for (const filePath of paths) {
    try {
      const partial = await readConfigFile(filePath);
      config = mergeConfig(config, partial);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        continue;
      }

      warnConfigError(filePath, error);
    }
  }

  return config;
}

async function loadConfig(projectDirectory) {
  const homeConfigDirectory = join(homedir(), ".config", "opencode");
  const globalPaths = GLOBAL_CONFIG_FILE_NAMES.map((name) => join(homeConfigDirectory, name));
  const projectPaths = projectDirectory
    ? PROJECT_CONFIG_FILE_NAMES.map((name) => join(projectDirectory, name))
    : [];
  const explicitPath = normalizeText(process.env.OPENCODE_NOTIFY_CONFIG);
  const explicitPaths = explicitPath
    ? [resolveConfigPath(explicitPath, projectDirectory || process.cwd())]
    : [];

  let config = {
    token: "",
    apiUrl: "",
    title: DEFAULT_TITLE,
    previewLimit: DEFAULT_PREVIEW_LIMIT,
  };

  config = mergeConfig(config, await loadConfigFromCandidates(globalPaths));
  config = mergeConfig(config, await loadConfigFromCandidates(projectPaths));
  config = mergeConfig(config, await loadConfigFromCandidates(explicitPaths));
  config = mergeConfig(config, normalizePartialConfig({
    token: process.env.OPENCODE_NOTIFY_TOKEN,
    apiUrl: process.env.OPENCODE_NOTIFY_API_URL,
    title: process.env.OPENCODE_NOTIFY_TITLE,
    previewLimit: process.env.OPENCODE_NOTIFY_PREVIEW_LIMIT,
  }));

  return config;
}

function warnMissingToken() {
  if (missingTokenWarned) {
    return;
  }

  missingTokenWarned = true;
  console.warn(
    "[opencode-notify] notify token is missing; notifications are disabled.",
  );
}

function warnMissingApiUrl() {
  if (missingApiUrlWarned) {
    return;
  }

  missingApiUrlWarned = true;
  console.warn(
    "[opencode-notify] notify apiUrl is missing; notifications are disabled.",
  );
}

async function postJson(url, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function sendNotification(projectName, config, label, detail) {
  if (!config.token) {
    warnMissingToken();
    return;
  }

  if (!config.apiUrl) {
    warnMissingApiUrl();
    return;
  }

  const summary = shorten(detail, config.previewLimit);
  const title = `[${projectName}] ${config.title}`;
  const payload = {
    token: config.token,
    title,
    placeholders: {
      title,
      context: `${label}：${summary}`,
      content: `${label}：${summary}`,
    },
  };

  try {
    await postJson(config.apiUrl, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[opencode-notify] failed to send notification: ${message}`);
  }
}

export const RemoteNotifyPlugin = async ({ directory }) => {
  const projectName = basename(directory || process.cwd() || "project");

  return {
    "experimental.text.complete": async (input, output) => {
      if (!input?.sessionID) {
        return;
      }

      const text = normalizeText(output?.text);
      if (!text) {
        return;
      }

      latestTextBySession.set(input.sessionID, text);
    },

    "permission.ask": async (input) => {
      const config = await loadConfig(directory);
      await sendNotification(projectName, config, "申请权限", extractPermissionPreview(input));
    },

    event: async ({ event }) => {
      if (event.type === "question.asked") {
        const config = await loadConfig(directory);
        await sendNotification(projectName, config, "提问", extractQuestionPreview(event.properties));
        return;
      }

      if (event.type === "session.error") {
        const config = await loadConfig(directory);
        await sendNotification(projectName, config, "报错", extractErrorPreview(event.properties));
        return;
      }

      if (event.type !== "session.idle") {
        return;
      }

      const sessionID = event.properties?.sessionID;
      if (!sessionID) {
        return;
      }

      const latestText = latestTextBySession.get(sessionID);
      if (!latestText) {
        return;
      }

      const config = await loadConfig(directory);
      const preview = shorten(latestText, config.previewLimit);
      if (lastCompletedPreviewBySession.get(sessionID) === preview) {
        return;
      }

      lastCompletedPreviewBySession.set(sessionID, preview);
      await sendNotification(projectName, config, "回复已完成", latestText);
    },
  };
};

export default RemoteNotifyPlugin;
