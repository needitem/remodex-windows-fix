// FILE: account-status.js
// Purpose: Converts raw codex account/auth responses into a sanitized status payload for the phone UI.
// Layer: CLI helper
// Exports: composeAccountStatus, composeSanitizedAuthStatusFromSettledResults, redactAuthStatus
// Depends on: ../package.json

const { version: bridgePackageVersion = "" } = require("../package.json");

function composeAccountStatus({
  accountRead = null,
  authStatus = null,
  loginInFlight = false,
  bridgeVersionInfo = null,
} = {}) {
  const account = accountRead?.account || null;
  const authToken = normalizeString(authStatus?.authToken);
  const hasAccountLogin = hasExplicitAccountLogin(account);
  const authMethod = firstNonEmpty([
    normalizeString(authStatus?.authMethod),
    normalizeString(account?.type),
  ]) || null;
  const tokenReady = Boolean(authToken);
  const requiresOpenaiAuth = Boolean(accountRead?.requiresOpenaiAuth || authStatus?.requiresOpenaiAuth);
  const hasPriorLoginContext = hasAccountLogin || Boolean(authMethod);
  const needsReauth = !loginInFlight && requiresOpenaiAuth && hasPriorLoginContext;
  const isAuthenticated = !needsReauth && (tokenReady || hasAccountLogin);
  const status = isAuthenticated
    ? "authenticated"
    : (loginInFlight ? "pending_login" : (needsReauth ? "expired" : "not_logged_in"));

  return {
    status,
    authMethod,
    email: normalizeString(account?.email) || null,
    planType: normalizeString(account?.planType) || null,
    loginInFlight: Boolean(loginInFlight),
    needsReauth,
    tokenReady,
    expiresAt: null,
    requiresOpenaiAuth,
    bridgeVersion: firstNonEmpty([
      normalizeString(bridgeVersionInfo?.bridgeVersion),
      normalizeString(bridgePackageVersion),
    ]) || null,
    bridgeLatestVersion: normalizeString(bridgeVersionInfo?.bridgeLatestVersion) || null,
  };
}

function redactAuthStatus(authStatus = null, extras = {}) {
  const composed = composeAccountStatus({
    accountRead: extras.accountRead || null,
    authStatus,
    loginInFlight: Boolean(extras.loginInFlight),
    bridgeVersionInfo: extras.bridgeVersionInfo || null,
  });

  return {
    authMethod: composed.authMethod,
    status: composed.status,
    email: composed.email,
    planType: composed.planType,
    loginInFlight: composed.loginInFlight,
    needsReauth: composed.needsReauth,
    tokenReady: composed.tokenReady,
    expiresAt: composed.expiresAt,
    bridgeVersion: composed.bridgeVersion,
    bridgeLatestVersion: composed.bridgeLatestVersion,
  };
}

function composeSanitizedAuthStatusFromSettledResults({
  accountReadResult = null,
  authStatusResult = null,
  loginInFlight = false,
  bridgeVersionInfo = null,
} = {}) {
  const accountRead = accountReadResult?.status === "fulfilled" ? accountReadResult.value : null;
  const authStatus = authStatusResult?.status === "fulfilled" ? authStatusResult.value : null;

  if (!accountRead && !authStatus) {
    const error = new Error("Unable to read ChatGPT account status from the bridge.");
    error.errorCode = "auth_status_unavailable";
    throw error;
  }

  return redactAuthStatus(authStatus, {
    accountRead,
    loginInFlight: Boolean(loginInFlight),
    bridgeVersionInfo,
  });
}

function hasExplicitAccountLogin(account) {
  if (!account || typeof account !== "object") {
    return false;
  }

  if (parseBoolean(account.loggedIn) || parseBoolean(account.logged_in) || parseBoolean(account.isLoggedIn)) {
    return true;
  }

  return Boolean(normalizeString(account.email));
}

function firstNonEmpty(values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBoolean(value) {
  return value === true;
}

module.exports = {
  composeAccountStatus,
  composeSanitizedAuthStatusFromSettledResults,
  redactAuthStatus,
};
