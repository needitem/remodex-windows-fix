export function rememberThreadTurnMapping(threadIdByTurnId, threadId, turnId) {
  const normalizedThreadId = normalizeIdentifier(threadId);
  const normalizedTurnId = normalizeIdentifier(turnId);
  if (!normalizedThreadId || !normalizedTurnId) {
    return;
  }
  threadIdByTurnId[normalizedTurnId] = normalizedThreadId;
}

export function resolveThreadIdFromParams(params, threadIdByTurnId = {}) {
  return normalizeIdentifier(
    params?.threadId
    || params?.thread?.id
    || params?.thread?.threadId
    || params?.conversationId
    || threadIdByTurnId[
      normalizeIdentifier(params?.turnId)
      || normalizeIdentifier(params?.turn?.id)
      || normalizeIdentifier(params?.id)
    ]
  );
}

export function resolveTurnIdFromParams(params, { allowTopLevelId = false } = {}) {
  return normalizeIdentifier(
    params?.turnId
    || params?.turn?.id
    || params?.turn?.turnId
    || (allowTopLevelId ? params?.id : null)
  );
}

export function normalizeIdentifier(value) {
  const normalized = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return normalized || "";
}

export function normalizeRequestId(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeStructuredQuestions(value) {
  const items = Array.isArray(value) ? value : [];
  return items.map((question, index) => ({
    header: typeof question?.header === "string" ? question.header.trim() : `Question ${index + 1}`,
    id: normalizeIdentifier(question?.id) || `question-${index + 1}`,
    isOther: question?.isOther === true,
    isSecret: question?.isSecret === true,
    options: Array.isArray(question?.options)
      ? question.options
        .map((option) => ({
          description: typeof option?.description === "string" ? option.description.trim() : "",
          label: typeof option?.label === "string" ? option.label.trim() : "",
        }))
        .filter((option) => option.label)
      : [],
    question: typeof question?.question === "string" ? question.question.trim() : "",
    selectionLimit: Number.isFinite(question?.selectionLimit)
      ? Number(question.selectionLimit)
      : (Number.isFinite(question?.selection_limit) ? Number(question.selection_limit) : 1),
  })).filter((question) => question.question);
}

export function findRequestMessageByRequestId(chat, requestId) {
  if (!chat || !requestId) {
    return null;
  }
  return chat.messages.find((message) => normalizeRequestId(message.requestId) === requestId) || null;
}

export function chatHasBlockingServerRequest(chat) {
  return Boolean(chat?.messages?.some((message) => (
    (message.kind === "structured-input" || message.kind === "approval")
    && normalizeRequestId(message.requestId)
  )));
}

export function upsertStructuredUserInputRequest({
  findChatByThreadId,
  messageOriginForChat,
  params,
  requestId,
  threadIdByTurnId,
} = {}) {
  const threadId = resolveThreadIdFromParams(params, threadIdByTurnId);
  const turnId = resolveTurnIdFromParams(params);
  rememberThreadTurnMapping(threadIdByTurnId, threadId, turnId);
  const chat = threadId ? findChatByThreadId(threadId) : null;
  if (!chat) {
    return null;
  }

  const questions = normalizeStructuredQuestions(params?.questions);
  if (!questions.length) {
    return null;
  }

  const normalizedRequestId = normalizeRequestId(requestId);
  let message = findRequestMessageByRequestId(chat, normalizedRequestId);
  if (!message) {
    message = {
      author: "Plan Mode",
      id: `request:${normalizedRequestId}`,
      kind: "structured-input",
      origin: messageOriginForChat(chat),
      requestId: normalizedRequestId,
      resolving: false,
      role: "assistant",
      structuredInput: { questions },
      text: "",
      time: "awaiting answer",
      turnId,
    };
    chat.messages.push(message);
  } else {
    message.structuredInput = { questions };
    message.resolving = false;
    message.time = "awaiting answer";
  }
  message.error = "";

  return {
    chat,
    message,
    requestId: normalizedRequestId,
    threadId,
    turnId,
  };
}

export function upsertApprovalRequest({
  findChatByThreadId,
  messageOriginForChat,
  method,
  params,
  requestId,
  threadIdByTurnId,
} = {}) {
  const threadId = resolveThreadIdFromParams(params, threadIdByTurnId);
  const turnId = resolveTurnIdFromParams(params);
  rememberThreadTurnMapping(threadIdByTurnId, threadId, turnId);
  const chat = threadId ? findChatByThreadId(threadId) : null;
  if (!chat) {
    return null;
  }

  const normalizedRequestId = normalizeRequestId(requestId);
  let message = findRequestMessageByRequestId(chat, normalizedRequestId);
  if (!message) {
    message = {
      approval: {},
      author: "Approval",
      id: `approval:${normalizedRequestId}`,
      kind: "approval",
      origin: messageOriginForChat(chat),
      requestId: normalizedRequestId,
      resolving: false,
      role: "assistant",
      text: "",
      time: "approval required",
      turnId,
    };
    chat.messages.push(message);
  }

  message.approval = {
    allowAcceptForSession: method.includes("commandExecution"),
    command: typeof params?.command === "string" ? params.command.trim() : "",
    method,
    reason: typeof params?.reason === "string" ? params.reason.trim() : "",
  };
  message.error = "";
  message.resolving = false;

  return {
    chat,
    message,
    requestId: normalizedRequestId,
    threadId,
    turnId,
  };
}

export function applyTurnPlanUpdated({
  findChatByThreadId,
  messageOriginForChat,
  params,
  threadIdByTurnId,
} = {}) {
  const threadId = resolveThreadIdFromParams(params, threadIdByTurnId);
  const turnId = resolveTurnIdFromParams(params);
  if (!threadId || !turnId) {
    return null;
  }

  rememberThreadTurnMapping(threadIdByTurnId, threadId, turnId);
  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return null;
  }

  const message = ensurePlanMessage(chat, {
    messageOrigin: messageOriginForChat(chat),
    turnId,
  });
  const nextExplanation = normalizePlanExplanation(params?.explanation);
  const nextSteps = normalizePlanSteps(params?.plan);

  message.planState = {
    ...(message.planState || {}),
    explanation: nextExplanation || message.planState?.explanation || "",
    isStreaming: true,
    presentation: "progress",
    steps: nextSteps.length ? nextSteps : (message.planState?.steps || []),
  };
  message.time = "running";

  return { chat, message, threadId, turnId };
}

export function applyPlanDelta({
  findChatByThreadId,
  messageOriginForChat,
  params,
  threadIdByTurnId,
} = {}) {
  const threadId = resolveThreadIdFromParams(params, threadIdByTurnId);
  const turnId = resolveTurnIdFromParams(params);
  const itemId = normalizeIdentifier(params?.itemId);
  const delta = typeof params?.delta === "string" ? params.delta : "";
  if (!threadId || !turnId || !delta) {
    return null;
  }

  rememberThreadTurnMapping(threadIdByTurnId, threadId, turnId);
  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return null;
  }

  const message = ensurePlanMessage(chat, {
    itemId,
    messageOrigin: messageOriginForChat(chat),
    turnId,
  });
  message.text = `${message.text || ""}${delta}`;
  message.planState = {
    ...(message.planState || {}),
    isStreaming: true,
    presentation: "result_streaming",
    steps: message.planState?.steps || [],
  };
  message.time = "running";

  return { chat, message, threadId, turnId };
}

export function resolveServerRequestInChats({
  findChatByThreadId,
  flattenChats,
  params,
  threadIdByTurnId,
} = {}) {
  const threadId = resolveThreadIdFromParams(params, threadIdByTurnId);
  const requestId = normalizeRequestId(params?.requestId);
  if (!requestId) {
    return null;
  }

  const chats = threadId ? [findChatByThreadId(threadId)].filter(Boolean) : flattenChats();
  for (const chat of chats) {
    const initialLength = chat.messages.length;
    chat.messages = chat.messages.filter((message) => normalizeRequestId(message.requestId) !== requestId);
    if (chat.messages.length !== initialLength) {
      return { chat, requestId, threadId };
    }
  }

  return null;
}

export function ensurePlanMessage(chat, { itemId, turnId, messageOrigin } = {}) {
  const normalizedItemId = normalizeIdentifier(itemId);
  const normalizedTurnId = normalizeIdentifier(turnId);
  let message = chat.messages.find((entry) => (
    entry.kind === "plan"
    && (
      (normalizedItemId && normalizeIdentifier(entry.itemId || entry.id) === normalizedItemId)
      || (normalizedTurnId && normalizeIdentifier(entry.turnId) === normalizedTurnId)
    )
  ));

  if (!message) {
    message = {
      author: "Plan",
      id: normalizedItemId || `plan:${normalizedTurnId || Date.now()}`,
      itemId: normalizedItemId || "",
      kind: "plan",
      origin: messageOrigin || entryOrigin(chat),
      planState: {
        explanation: "",
        isStreaming: true,
        presentation: "progress",
        steps: [],
      },
      role: "assistant",
      text: "",
      time: "running",
      turnId: normalizedTurnId || "",
    };
    chat.messages.push(message);
  }

  message.itemId = normalizedItemId || message.itemId || "";
  message.turnId = normalizedTurnId || message.turnId || "";
  message.origin = message.origin || messageOrigin || entryOrigin(chat);
  return message;
}

export function finalizePlanMessages(chat, turnId) {
  const normalizedTurnId = normalizeIdentifier(turnId);
  for (const message of chat?.messages || []) {
    if (message.kind !== "plan") {
      continue;
    }
    if (normalizedTurnId && normalizeIdentifier(message.turnId) !== normalizedTurnId) {
      continue;
    }
    message.time = "completed";
    message.planState = {
      ...(message.planState || {}),
      isStreaming: false,
      presentation: "result",
      steps: (message.planState?.steps || []).map((step) => ({
        ...step,
        status: "completed",
      })),
    };
  }
}

export function normalizePlanExplanation(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizePlanSteps(value, { completeAll = false } = {}) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((entry) => ({
      status: completeAll ? "completed" : normalizePlanStepStatus(entry?.status),
      step: typeof entry?.step === "string" ? entry.step.trim() : "",
    }))
    .filter((entry) => entry.step);
}

export function normalizePlanItemText(item) {
  const parts = Array.isArray(item?.content)
    ? item.content
      .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
      .map((entry) => entry.text.trim())
      .filter(Boolean)
    : [];
  return parts.join("\n\n") || normalizePlanExplanation(item?.explanation) || "";
}

export function buildStructuredUserInputResponse(answersByQuestionId) {
  return {
    answers: Object.fromEntries(
      Object.entries(answersByQuestionId).map(([questionId, answers]) => [
        questionId,
        { answers },
      ])
    ),
  };
}

function normalizePlanStepStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "completed":
    case "done":
      return "completed";
    case "inprogress":
    case "in_progress":
    case "running":
      return "in_progress";
    default:
      return "pending";
  }
}

function entryOrigin(chat) {
  return chat?.messages?.[chat.messages.length - 1]?.origin || "web";
}
