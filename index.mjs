import { basename } from "node:path";

const DEFAULT_API_URL = "https://notify.milki.top/api/v2/message/send";
const DEFAULT_TITLE = "OpenCode";
const DEFAULT_PREVIEW_LIMIT = 30;
const REQUEST_TIMEOUT_MS = 10000;

const latestTextBySession = new Map();
const lastCompletedPreviewBySession = new Map();

let missingTokenWarned = false;

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

function loadConfig() {
  return {
    token: normalizeText(process.env.OPENCODE_NOTIFY_TOKEN),
    apiUrl: normalizeText(process.env.OPENCODE_NOTIFY_API_URL) || DEFAULT_API_URL,
    title: normalizeText(process.env.OPENCODE_NOTIFY_TITLE) || DEFAULT_TITLE,
    previewLimit: parsePreviewLimit(process.env.OPENCODE_NOTIFY_PREVIEW_LIMIT),
  };
}

function warnMissingToken() {
  if (missingTokenWarned) {
    return;
  }

  missingTokenWarned = true;
  console.warn(
    "[opencode-notify] OPENCODE_NOTIFY_TOKEN is missing; notifications are disabled.",
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

async function sendNotification(projectName, label, detail) {
  const config = loadConfig();
  if (!config.token) {
    warnMissingToken();
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
      await sendNotification(projectName, "申请权限", extractPermissionPreview(input));
    },

    event: async ({ event }) => {
      if (event.type === "question.asked") {
        await sendNotification(projectName, "提问", extractQuestionPreview(event.properties));
        return;
      }

      if (event.type === "session.error") {
        await sendNotification(projectName, "报错", extractErrorPreview(event.properties));
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

      const preview = shorten(latestText, loadConfig().previewLimit);
      if (lastCompletedPreviewBySession.get(sessionID) === preview) {
        return;
      }

      lastCompletedPreviewBySession.set(sessionID, preview);
      await sendNotification(projectName, "回复已完成", latestText);
    },
  };
};

export default RemoteNotifyPlugin;
