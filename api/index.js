
const MANIFEST = {
  id: "dev.gildaffafa.qobuz",
  name: "Qobuz + Internet Archive",
  version: "1.1.0",
  description: "Multi-source audio addon for BitChord",
  resources: ["search", "stream"],
  checkValidLossless: 0,
  allowDownloads: 1,
  settings: [
    {
      key: "quality",
      type: "select",
      label: "Audio quality",
      default: "lossless",
      options: [
        { value: "lossless", label: "Lossless" },
        { value: "high", label: "High" }
      ]
    }
  ]
};

const ARCHIVE = "https://archive.org";

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(data));
}

function allowedLicense(value) {
  const license = String(value || "").toLowerCase();

  return [
    "creativecommons.org/licenses/by/",
    "creativecommons.org/licenses/by-sa/",
    "creativecommons.org/publicdomain/zero/",
    "creativecommons.org/publicdomain/mark/"
  ].some(item => license.includes(item));
}

function getFlacFile(files) {
  if (!Array.isArray(files)) return null;

  return files.find(file =>
    typeof file.name === "string" &&
    /\.flac$/i.test(file.name) &&
    Number(file.size || 0) > 0
  ) || null;
}

function getDuration(metadata) {
  const value = metadata.runtime || metadata.length;

  if (!value) return undefined;

  const number = Number(value);
  if (Number.isFinite(number)) return number;

  const parts = String(value).split(":").map(Number);

  if (parts.some(part => !Number.isFinite(part))) {
    return undefined;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

async function getItem(identifier) {
  const response = await fetch(
    `${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`
  );

  if (!response.ok) return null;

  return response.json();
}

async function searchArchive(query) {
  const terms = query.trim().split(/\s+/).slice(0, 6);

  const escaped = terms.map(term =>
    term.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&")
  );

  
  // Ask Archive.org for permitted license families first.
  // Keep allowedLicense() as the final validation.
  const licenseQuery = [
    "licenseurl:http*creativecommons.org/licenses/by/*",
    "licenseurl:http*creativecommons.org/licenses/by-sa/*",
    "licenseurl:http*creativecommons.org/publicdomain/zero/*",
    "licenseurl:http*creativecommons.org/publicdomain/mark/*"
  ].join(" OR ");

  const searchQuery =
  "mediatype:audio AND (" +
  escaped.map(term =>
    `(title:${term} OR creator:${term} OR subject:${term})`
  ).join(" OR ") +
  ")";


  const params = new URLSearchParams({
    q: searchQuery,
    fl: "identifier,title,creator,licenseurl",
    rows: "50",
    page: "1",
    output: "json"
  });

  const response = await fetch(
    `${ARCHIVE}/advancedsearch.php?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error("Internet Archive search failed");
  }

  const result = await response.json();
  const docs = result.response?.docs || [];

  const checked = await Promise.all(
    docs.map(async doc => {
      try {
        const item = await getItem(doc.identifier);
        if (!item || item.error) return null;

        const metadata = item.metadata || {};
        const license =
          metadata.licenseurl || doc.licenseurl || "";

        if (!allowedLicense(license)) return null;

        const file = getFlacFile(item.files);
        if (!file) return null;

        const creator = metadata.creator || doc.creator || "";
        const artist = Array.isArray(creator)
          ? creator.join(", ")
          : String(creator);

        const track = {
          id: doc.identifier,
          title: metadata.title || doc.title || doc.identifier,
          artist,
          album: metadata.album || "",
          artworkURL:
            `${ARCHIVE}/services/img/${encodeURIComponent(doc.identifier)}`,
          format: "flac",
          audioQuality: "LOSSLESS"
        };

        const duration = getDuration(metadata);
        if (duration !== undefined) {
          track.duration = duration;
        }

        return track;
      } catch {
        return null;
      }
    })
  );

  return checked.filter(Boolean);
}

async function resolveArchive(identifier) {
  const item = await getItem(identifier);

  if (!item || item.error) return null;

  const metadata = item.metadata || {};

  if (!allowedLicense(metadata.licenseurl)) {
    return null;
  }

  const file = getFlacFile(item.files);
  if (!file) return null;

  return {
    url:
      `${ARCHIVE}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`,
    format: "flac",
    quality: "Lossless FLAC",
    codec: "flac",
    container: "flac",
    manifest: "none",
    encrypted: false
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const url = new URL(
    req.url,
    `https://${req.headers.host || "localhost"}`
  );

  const pathname = url.pathname;

  if (
    pathname === "/" ||
    pathname === "/manifest.json" ||
    pathname === "/api/index.js"
  ) {
    return json(res, 200, MANIFEST);
  }

  if (pathname === "/search") {
    const query = url.searchParams.get("q") || "";

    if (!query.trim()) {
      return json(res, 200, { tracks: [] });
    }

    try {
      const tracks = await searchArchive(query);
      return json(res, 200, { tracks });
    } catch (error) {
      return json(res, 502, {
        error: "Search service unavailable",
        details: error.message
      });
    }
  }

  if (pathname.startsWith("/stream/")) {
    const identifier = decodeURIComponent(
      pathname.slice("/stream/".length)
    );

    if (!identifier) {
      return json(res, 400, { error: "Missing track ID" });
    }

    try {
      const stream = await resolveArchive(identifier);

      if (!stream) {
        return json(res, 404, {
          error: "No permitted FLAC file found"
        });
      }

      return json(res, 200, stream);
    } catch (error) {
      return json(res, 502, {
        error: "Stream resolution failed"
      });
    }
  }

  return json(res, 404, {
    error: "Endpoint not found"
  });
};
