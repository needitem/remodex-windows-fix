// FILE: qr.js
// Purpose: Prints the pairing QR payload that the iPhone scanner expects.
// Layer: CLI helper
// Exports: printQR
// Depends on: fs, os, path, qrcode-terminal, qrcode

const fs = require("fs");
const os = require("os");
const path = require("path");
const qrcode = require("qrcode-terminal");
const qrImage = require("qrcode");

const PAIRING_DIR = path.join(os.homedir(), ".remodex");
const PAIRING_QR_PATH = path.join(PAIRING_DIR, "pairing-qr.png");
const PAIRING_JSON_PATH = path.join(PAIRING_DIR, "pairing-qr.json");

function printQR(pairingPayload) {
  const payload = JSON.stringify(pairingPayload);

  console.log("\nScan this QR with the iPhone:\n");
  qrcode.setErrorLevel("Q");
  qrcode.generate(payload, { small: true });
  console.log(`\nSession ID: ${pairingPayload.sessionId}`);
  console.log(`Relay: ${pairingPayload.relay}`);
  console.log(`Device ID: ${pairingPayload.macDeviceId}`);
  console.log(`Expires: ${new Date(pairingPayload.expiresAt).toISOString()}`);

  void writePairingArtifacts(payload).then(({ qrPath, jsonPath }) => {
    console.log(`QR PNG: ${qrPath}`);
    console.log(`Pairing JSON: ${jsonPath}`);
    console.log("If the in-terminal QR will not scan, open the PNG and scan that instead.\n");
  }).catch((error) => {
    console.error(`[remodex] Failed to write pairing artifacts: ${error.message}\n`);
  });
}

async function writePairingArtifacts(payload) {
  fs.mkdirSync(PAIRING_DIR, { recursive: true });
  fs.writeFileSync(PAIRING_JSON_PATH, payload, "utf8");
  await qrImage.toFile(PAIRING_QR_PATH, payload, {
    errorCorrectionLevel: "Q",
    margin: 2,
    scale: 10,
    color: {
      dark: "#000000",
      light: "#FFFFFF",
    },
  });

  return {
    qrPath: PAIRING_QR_PATH,
    jsonPath: PAIRING_JSON_PATH,
  };
}

module.exports = { printQR };
