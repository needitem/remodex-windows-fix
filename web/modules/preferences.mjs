const PREFERENCES_STORAGE_KEY = "remodex-web.preferences";

export function loadPreferences({
  accessOptions,
  modelOptions,
  reasoningOptions,
  speedOptions,
} = {}) {
  const fallback = {
    access: "On-Request",
    font: "system",
    glass: true,
    model: "GPT-5.4",
    notifications: true,
    reasoning: "Extra High",
    speed: "Normal",
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
    return {
      access: accessOptions?.includes(parsed.access) ? parsed.access : fallback.access,
      font: parsed.font === "rounded" ? "rounded" : fallback.font,
      glass: parsed.glass !== false,
      model: modelOptions?.includes(parsed.model) ? parsed.model : fallback.model,
      notifications: parsed.notifications !== false,
      reasoning: reasoningOptions?.includes(parsed.reasoning) ? parsed.reasoning : fallback.reasoning,
      speed: speedOptions?.includes(parsed.speed) ? parsed.speed : fallback.speed,
    };
  } catch {
    return fallback;
  }
}

export function savePreferences(preferences) {
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}
