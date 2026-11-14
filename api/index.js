
const MANIFEST = {
  id: "dev.gildaffafa.qobuz",
  name: "Qobuz BitChord",
  version: "1.0.0",
  description: "Qobuz music source for BitChord",
  resources: ["search", "stream"],
  checkValidLossless: 0,
  allowDownloads: 1
};

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const pathname = new URL(
    req.url,
    `https://${req.headers.host || "localhost"}`
  ).pathname;

  if (pathname === "/" || pathname === "/manifest.json") {
    return res.status(200).json(MANIFEST);
  }

  if (pathname === "/search") {
    return res.status(200).json({
      tracks: []
    });
  }

  if (pathname.startsWith("/stream/")) {
    return res.status(404).json({
      error: "Track not found"
    });
  }

  return res.status(404).json({
    error: "Endpoint not found"
  });
};
