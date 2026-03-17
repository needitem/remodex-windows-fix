import { decodePairingPayloadTextFromImageFile } from "./qr-decoder.mjs";

const REQUIRED_PAIRING_KEYS = [
  "v",
  "relay",
  "sessionId",
  "macDeviceId",
  "macIdentityPublicKey",
  "expiresAt",
];

export function parsePairingPayload(rawValue) {
  const normalizedValue = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!normalizedValue) {
    throw new Error("Pairing payload is empty.");
  }

  let parsed;
  try {
    parsed = JSON.parse(normalizedValue);
  } catch {
    throw new Error("Pairing payload must be valid JSON.");
  }

  for (const key of REQUIRED_PAIRING_KEYS) {
    if (!(key in parsed)) {
      throw new Error(`Pairing payload is missing "${key}".`);
    }
  }

  if (!String(parsed.sessionId || "").trim()) {
    throw new Error("Pairing payload sessionId is empty.");
  }

  if (!String(parsed.relay || "").trim()) {
    throw new Error("Pairing payload relay URL is empty.");
  }

  return parsed;
}

export async function decodePairingPayloadFromFile(file, windowLike = window) {
  if (!file) {
    throw new Error("No file was selected.");
  }

  if (file.type === "application/json" || file.name.toLowerCase().endsWith(".json")) {
    return parsePairingPayload(await file.text());
  }

  return decodePairingPayloadFromImage(file, windowLike);
}

export async function decodePairingPayloadFromImage(file, windowLike = window) {
  const decodedPayloadText = await decodePairingPayloadTextFromImageFile(file, { windowLike });
  if (!decodedPayloadText) {
    throw new Error("No QR code was found in the selected image.");
  }
  return parsePairingPayload(decodedPayloadText);
}

export function describePairingPayload(pairingPayload) {
  return {
    session: shortenValue(pairingPayload.sessionId),
    relay: String(pairingPayload.relay),
    macDeviceId: shortenValue(pairingPayload.macDeviceId),
    expiresAt: Number.isFinite(Number(pairingPayload.expiresAt))
      ? new Date(Number(pairingPayload.expiresAt)).toLocaleString()
      : "Unknown",
  };
}

function shortenValue(value) {
  const normalized = String(value || "");
  if (normalized.length <= 18) {
    return normalized;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-6)}`;
}
