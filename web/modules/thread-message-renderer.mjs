export function renderMessageBubble(element, message, handlers = {}) {
  if (!element) {
    return;
  }

  element.className = "message-bubble";

  if (message?.pending) {
    element.classList.add("typing-bubble");

    const label = document.createElement("div");
    label.className = "typing-label";
    label.textContent = message.text || "Waiting for response";

    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = "<span></span><span></span><span></span>";

    element.replaceChildren(label, indicator);
    return;
  }

  if (message?.kind === "plan") {
    renderPlanBubble(element, message);
    return;
  }

  if (message?.kind === "structured-input") {
    renderStructuredInputBubble(element, message, handlers);
    return;
  }

  if (message?.kind === "approval") {
    renderApprovalBubble(element, message, handlers);
    return;
  }

  if (message?.kind === "command") {
    const summaryText = message.summary
      || handlers.summarizeCommandForDisplay?.(message.command || "Command")
      || "";
    const previewText = message.preview
      || handlers.buildCommandPreview?.(message.rawOutput || message.text || "")
      || "";
    const rawContent = handlers.buildCommandRawContent?.(message) || "";
    if (!summaryText && !previewText && !rawContent) {
      element.replaceChildren();
      return;
    }

    element.classList.add("command-bubble");

    const summary = document.createElement("div");
    summary.className = "command-summary";
    summary.textContent = summaryText;

    const preview = document.createElement("pre");
    preview.className = "command-preview";
    preview.textContent = previewText;

    element.replaceChildren(summary, preview);

    if (rawContent) {
      const details = document.createElement("details");
      details.className = "command-details";
      const summaryLine = document.createElement("summary");
      summaryLine.textContent = "Show Raw";
      const rawBlock = document.createElement("pre");
      rawBlock.textContent = rawContent;
      details.append(summaryLine, rawBlock);
      element.append(details);
    }
    return;
  }

  if (message?.kind === "patch") {
    const summaryText = message.summary || summarizePatchForDisplay(message.patch || "");
    const previewText = message.preview || buildPatchPreview(message.patch || "");
    if (!summaryText && !previewText) {
      element.replaceChildren();
      return;
    }

    element.classList.add("patch-bubble");

    const summary = document.createElement("div");
    summary.className = "patch-summary";
    summary.textContent = summaryText;

    const preview = document.createElement("pre");
    preview.className = "patch-preview";
    preview.textContent = previewText;

    element.replaceChildren(summary, preview);

    if (message.patch) {
      const details = document.createElement("details");
      details.className = "patch-details";
      details.open = true;
      const summaryLine = document.createElement("summary");
      summaryLine.textContent = "Show Exact Diff";
      const diffShell = buildUnifiedDiffElement(message.patch);
      details.append(summaryLine, diffShell);
      element.append(details);
    }
    return;
  }

  element.textContent = message?.text || "";
}

export function buildUnifiedDiffElement(patch) {
  const normalizedPatch = String(patch || "");
  const fragment = document.createDocumentFragment();
  const lines = normalizedPatch.replace(/\r/g, "").split("\n");

  for (const line of lines) {
    const parts = describeDiffLine(line);
    const row = document.createElement("div");
    row.className = `diff-line ${parts.className}`.trim();

    const prefix = document.createElement("span");
    prefix.className = "diff-line-prefix";
    prefix.textContent = parts.prefix;

    const text = document.createElement("span");
    text.className = "diff-line-text";
    text.textContent = parts.text;

    row.append(prefix, text);
    fragment.append(row);
  }

  const shell = document.createElement("div");
  shell.className = "diff-lines";
  shell.append(fragment);
  return shell;
}

export function summarizePatchForDisplay(patch) {
  const summary = summarizeDiffPatch(patch);
  const parts = [];
  if (summary.files > 0) {
    parts.push(`Changed ${summary.files} file${summary.files === 1 ? "" : "s"}`);
  } else {
    parts.push("Changed files");
  }
  if (summary.additions > 0 || summary.deletions > 0) {
    parts.push(`+${summary.additions} -${summary.deletions}`);
  }
  return parts.join(" | ");
}

export function buildPatchPreview(patch) {
  const files = [];
  for (const line of String(patch || "").replace(/\r/g, "").split("\n")) {
    if (!line.startsWith("diff --git ")) {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    const rawPath = parts[3] || parts[2] || "";
    const normalized = rawPath.replace(/^[ab]\//, "");
    if (normalized && !files.includes(normalized)) {
      files.push(normalized);
    }
  }

  if (files.length) {
    return files.slice(0, 6).map((filePath) => `- ${filePath}`).join("\n");
  }

  return "Exact patch captured.";
}

function renderPlanBubble(element, message) {
  element.classList.add("plan-bubble");
  const planState = message.planState || {};

  const header = document.createElement("div");
  header.className = "plan-header";
  header.textContent = planState.isStreaming ? "Live plan" : "Plan snapshot";

  const fragment = document.createDocumentFragment();
  fragment.append(header);

  if (planState.explanation) {
    const explanation = document.createElement("p");
    explanation.className = "plan-explanation";
    explanation.textContent = planState.explanation;
    fragment.append(explanation);
  }

  if (message.text) {
    const text = document.createElement("pre");
    text.className = "plan-text";
    text.textContent = message.text;
    fragment.append(text);
  }

  if (Array.isArray(planState.steps) && planState.steps.length) {
    const steps = document.createElement("ol");
    steps.className = "plan-steps";

    for (const step of planState.steps) {
      const row = document.createElement("li");
      row.className = `plan-step plan-step-${step.status || "pending"}`;

      const status = document.createElement("span");
      status.className = "plan-step-status";
      status.textContent = planStepStatusLabel(step.status);

      const text = document.createElement("span");
      text.className = "plan-step-text";
      text.textContent = step.step;

      row.append(status, text);
      steps.append(row);
    }
    fragment.append(steps);
  }

  element.replaceChildren(fragment);
}

function renderStructuredInputBubble(element, message, handlers) {
  element.classList.add("request-bubble", "structured-input-bubble");

  const shell = document.createElement("div");
  shell.className = "request-shell";

  const title = document.createElement("div");
  title.className = "request-title";
  title.textContent = "Plan input required";

  const copy = document.createElement("p");
  copy.className = "request-copy";
  copy.textContent = "Answer the questions below so the current turn can continue without restarting.";

  const form = document.createElement("form");
  form.className = "request-form";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handlers.onSubmitStructuredInput?.(message);
  });

  for (const question of message.structuredInput?.questions || []) {
    form.append(buildStructuredQuestionField(question, message, handlers));
  }

  if (message.error) {
    const error = document.createElement("p");
    error.className = "request-error";
    error.textContent = message.error;
    form.append(error);
  }

  const actions = document.createElement("div");
  actions.className = "request-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "mini-button";
  submit.disabled = message.resolving === true;
  submit.textContent = message.resolving === true ? "Sending..." : "Send Answers";
  actions.append(submit);

  form.append(actions);
  shell.append(title, copy, form);
  element.replaceChildren(shell);
}

function renderApprovalBubble(element, message, handlers) {
  element.classList.add("request-bubble", "approval-bubble");

  const shell = document.createElement("div");
  shell.className = "request-shell";

  const title = document.createElement("div");
  title.className = "request-title";
  title.textContent = "Approval required";

  const copy = document.createElement("p");
  copy.className = "request-copy";
  copy.textContent = message.approval?.reason || "Codex needs permission before it can continue.";

  shell.append(title, copy);

  if (message.approval?.command) {
    const command = document.createElement("pre");
    command.className = "approval-command";
    command.textContent = message.approval.command;
    shell.append(command);
  }

  const actions = document.createElement("div");
  actions.className = "request-actions";
  actions.append(
    buildApprovalButton(message, "accept", "Allow", handlers),
    ...(message.approval?.allowAcceptForSession
      ? [buildApprovalButton(message, "acceptForSession", "Allow for Session", handlers)]
      : []),
    buildApprovalButton(message, "decline", "Decline", handlers)
  );
  shell.append(actions);

  if (message.error) {
    const error = document.createElement("p");
    error.className = "request-error";
    error.textContent = message.error;
    shell.append(error);
  }

  element.replaceChildren(shell);
}

function buildStructuredQuestionField(question, message, handlers) {
  const field = document.createElement("fieldset");
  field.className = "request-question";

  const legend = document.createElement("legend");
  legend.className = "request-question-legend";
  legend.textContent = question.header || question.question;
  field.append(legend);

  const prompt = document.createElement("p");
  prompt.className = "request-question-copy";
  prompt.textContent = question.question;
  field.append(prompt);

  const optionType = Number(question.selectionLimit || 1) > 1 ? "checkbox" : "radio";
  const inputName = `request-${message.requestId}-${question.id}`;
  const draftAnswers = Array.isArray(message.draftAnswers?.[question.id]) ? message.draftAnswers[question.id] : [];
  const optionList = document.createElement("div");
  optionList.className = "request-options";

  const updateDraft = () => {
    const answers = collectQuestionAnswerValues(message.requestId, question.id, field);
    updateStructuredQuestionDraft(message, answers.questionId, answers.values);
    handlers.onStructuredInputDraftUpdated?.(message, answers.questionId, answers.values);
  };

  for (const option of question.options || []) {
    const label = document.createElement("label");
    label.className = "request-option";

    const input = document.createElement("input");
    input.type = optionType;
    input.name = inputName;
    input.value = option.label;
    input.disabled = message.resolving === true;
    input.checked = draftAnswers.includes(option.label);
    input.addEventListener("change", updateDraft);

    const text = document.createElement("span");
    text.className = "request-option-text";
    text.textContent = option.label;

    label.append(input, text);
    if (option.description) {
      const description = document.createElement("span");
      description.className = "request-option-description";
      description.textContent = option.description;
      label.append(description);
    }
    optionList.append(label);
  }

  if (optionList.childNodes.length) {
    field.append(optionList);
  }

  const customInput = document.createElement(question.isSecret ? "input" : "textarea");
  customInput.className = "request-custom-input";
  customInput.disabled = message.resolving === true;
  customInput.placeholder = "Other answer (optional)";
  customInput.setAttribute("data-question-id", question.id);
  customInput.value = draftAnswers.find((answer) => !(question.options || []).some((option) => option.label === answer)) || "";
  customInput.addEventListener("input", updateDraft);
  if (question.isSecret) {
    customInput.type = "password";
    customInput.autocomplete = "off";
  } else {
    customInput.rows = 2;
  }
  field.append(customInput);

  return field;
}

function buildApprovalButton(message, decision, label, handlers) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = decision === "decline" ? "mini-button mini-button-subtle" : "mini-button";
  button.disabled = message.resolving === true;
  button.textContent = label;
  button.addEventListener("click", () => {
    void handlers.onSubmitApproval?.(message, decision);
  });
  return button;
}

function collectQuestionAnswerValues(requestId, questionId, container) {
  const values = [];
  const inputName = `request-${requestId}-${questionId}`;
  for (const input of container.querySelectorAll(`[name="${cssEscape(inputName)}"]`)) {
    if (input.checked) {
      values.push(input.value);
    }
  }

  const customInput = container.querySelector(`[data-question-id="${cssEscape(questionId)}"]`);
  const customValue = typeof customInput?.value === "string" ? customInput.value.trim() : "";
  if (customValue) {
    return { questionId, values: [customValue] };
  }
  return { questionId, values };
}

function updateStructuredQuestionDraft(message, questionId, values) {
  message.draftAnswers = {
    ...(message.draftAnswers || {}),
    [questionId]: values,
  };
}

function planStepStatusLabel(status) {
  switch (status) {
    case "completed":
      return "Done";
    case "in_progress":
      return "Active";
    default:
      return "Pending";
  }
}

function summarizeDiffPatch(patch) {
  const lines = String(patch || "").replace(/\r/g, "").split("\n");
  let files = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      files += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions, files };
}

function diffLineClass(line) {
  if (
    line.startsWith("diff --git ")
    || line.startsWith("@@")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
  ) {
    return "diff-line-meta";
  }
  if (line.startsWith("+")) {
    return "diff-line-add";
  }
  if (line.startsWith("-")) {
    return "diff-line-remove";
  }
  return "diff-line-context";
}

function describeDiffLine(line) {
  const className = diffLineClass(line);

  if (line.startsWith("diff --git ")) {
    return {
      className,
      prefix: "file",
      text: line.replace(/^diff --git\s+/, "") || " ",
    };
  }

  if (line.startsWith("index ")) {
    return {
      className,
      prefix: "idx",
      text: line.replace(/^index\s+/, "") || " ",
    };
  }

  if (line.startsWith("@@")) {
    return {
      className,
      prefix: "@@",
      text: line,
    };
  }

  if (line.startsWith("+++ ")) {
    return {
      className,
      prefix: "++",
      text: line.slice(4) || " ",
    };
  }

  if (line.startsWith("--- ")) {
    return {
      className,
      prefix: "--",
      text: line.slice(4) || " ",
    };
  }

  if (line.startsWith("+")) {
    return {
      className,
      prefix: "+",
      text: line.slice(1) || " ",
    };
  }

  if (line.startsWith("-")) {
    return {
      className,
      prefix: "-",
      text: line.slice(1) || " ",
    };
  }

  if (line.startsWith(" ")) {
    return {
      className,
      prefix: " ",
      text: line.slice(1) || " ",
    };
  }

  return {
    className,
    prefix: " ",
    text: line || " ",
  };
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(String(value || ""));
  }
  return String(value || "").replace(/["\\]/g, "\\$&");
}
