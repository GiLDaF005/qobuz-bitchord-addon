const QOBUZ_CONFIG = {
  appId: process.env.QOBUZ_APP_ID || "",
  appSecret: process.env.QOBUZ_APP_SECRET || "",
  userAuthToken: process.env.QOBUZ_USER_AUTH_TOKEN || "",
  userId: process.env.QOBUZ_USER_ID || ""
};

function isConfigured() {
  return Boolean(
    QOBUZ_CONFIG.appId &&
    QOBUZ_CONFIG.appSecret &&
    QOBUZ_CONFIG.userAuthToken &&
    QOBUZ_CONFIG.userId
  );
}

async function search(query) {
  if (!isConfigured()) {
    return [];
  }

  // Integrasi API Qobuz akan ditambahkan setelah
  // kredensial dan metode autentikasi tersedia.
  return [];
}

module.exports = {
  name: "Qobuz",
  isConfigured,
  search
};
