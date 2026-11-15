
const MANIFEST = {
  id: "dev.gildaffafa.qobuz",
  name: "Internet Archive + Wikimedia Commons",
  version: "1.3.0",
  description: "Free licensed FLAC audio from Internet Archive and Wikimedia Commons",
  resources: ["search", "stream"],
  bitchordAuth: true,
  checkValidLossless: 0,
  allowDownloads: 1
};

const ARCHIVE = "https://archive.org";
const MAX_PAGES = 2;
const ROWS = 50;
const MAX_TRACKS = 15;
const BATCH_SIZE = 5;

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

function cleanCommonsValue(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function allowedCommonsLicense(metadata) {
  const licenseUrl = String(
    metadata?.LicenseUrl?.value || ""
  ).toLowerCase();

  return [
    /creativecommons\.org\/licenses\/by\/[0-9.]+\/?$/,
    /creativecommons\.org\/licenses\/by-sa\/[0-9.]+\/?$/,
    /creativecommons\.org\/publicdomain\/zero\/[0-9.]+\/?$/,
    /creativecommons\.org\/publicdomain\/mark\/[0-9.]+\/?$/
  ].some(pattern => pattern.test(licenseUrl));
}
function commonsTrackFromPage(page) {
  const info = page?.imageinfo?.[0];

  if (!info || !/\.flac$/i.test(page.title || "")) {
    return null;
  }

  if (String(info.mime || "").toLowerCase() !== "audio/flac") {
    return null;
  }

  if (!info.url || Number(info.size || 0) <= 0) {
    return null;
  }

  const metadata = info.extmetadata || {};

  if (!allowedCommonsLicense(metadata)) {
    return null;
  }

  const title =
    cleanCommonsValue(metadata.ObjectName?.value) ||
    page.title.replace(/^File:/i, "").replace(/\.flac$/i, "");

  const artist =
    cleanCommonsValue(metadata.Artist?.value) ||
    "Unknown artist";

  return {
    id: "commons:" + page.title,
    title,
    artist,
    album: "",
    format: "flac",
    audioQuality: "LOSSLESS"
  };
}

async function searchCommons(query) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} filemime:audio/flac`,
    gsrnamespace: "6",
    gsrlimit: String(MAX_TRACKS),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata"
  });

  const response = await fetch(
    `${COMMONS_API}?${params.toString()}`,
    {
      headers: {
        "User-Agent": "BitChordFLACAddon/1.3"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Wikimedia Commons HTTP ${response.status}`
    );
  }

  const result = await response.json();
  const pages = Object.values(
    result.query?.pages || {}
  );

  const tracks = pages
    .map(commonsTrackFromPage)
    .filter(Boolean);

  return {
    tracks: tracks.slice(0, MAX_TRACKS),
    stats: {
      documentsFound: pages.length,
      accepted: tracks.length
    }
  };
}

async function resolveCommons(fileTitle) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata"
  });

  const response = await fetch(
    `${COMMONS_API}?${params.toString()}`,
    {
      headers: {
        "User-Agent": "BitChordFLACAddon/1.3"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Wikimedia Commons HTTP ${response.status}`
    );
  }

  const result = await response.json();

  const page = Object.values(
    result.query?.pages || {}
  )[0];

  const track = commonsTrackFromPage(page);
  const info = page?.imageinfo?.[0];

  if (!track || !info?.url) return null;

  return {
    url: info.url,
    format: "flac",
    quality: "Lossless FLAC",
    codec: "flac",
    container: "flac",
    manifest: "none",
    encrypted: false
  };
}

// BitChord authentication verifier
const bitchordAuthPromise = import("../bitchord-addon-auth.mjs").then(
  ({ createBitChordAuth }) =>
    createBitChordAuth({
      hosts: ["qobuz-bitchord-addon.vercel.app"]
    })
);

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

  return parts.reduce(
    (total, part) => total * 60 + part,
    0
  );
}

async function getItem(identifier) {
  const response = await fetch(
    `${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`
  );

  if (!response.ok) {
    throw new Error(`Metadata HTTP ${response.status}`);
  }

  return response.json();
}

async function searchPage(searchQuery, page) {
  const params = new URLSearchParams({
    q: searchQuery,
    fl: "identifier,title,creator,licenseurl",
    rows: String(ROWS),
    page: String(page),
    output: "json"
  });

  const response = await fetch(
    `${ARCHIVE}/advancedsearch.php?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error(`Search HTTP ${response.status}`);
  }

  const result = await response.json();

  return {
    docs: result.response?.docs || [],
    total: Number(result.response?.numFound || 0)
  };
}

async function searchArchive(query) {
  const stats = {
    pagesChecked: 0,
    documentsFound: 0,
    metadataErrors: 0,
    rejectedLicense: 0,
    missingFlac: 0,
    accepted: 0
  };

  const terms = query.trim().split(/\s+/).slice(0, 6);

  const escaped = terms.map(term =>
    term.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&")
  );

    const searchQuery =
  "mediatype:audio AND (" +
  escaped.map(term =>
    `(title:${term} OR creator:${term} OR subject:${term})`
  ).join(" AND ") +
  ") AND licenseurl:http*by*";

  const tracks = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await searchPage(searchQuery, page);
    stats.pagesChecked++;

    const docs = result.docs;
    stats.documentsFound += docs.length;

    if (docs.length === 0) break;

    for (
      let start = 0;
      start < docs.length;
      start += BATCH_SIZE
    ) {
      const batch = docs.slice(start, start + BATCH_SIZE);

      const checked = await Promise.all(
        batch.map(async doc => {
          try {
            if (!doc.identifier || seen.has(doc.identifier)) {
              return null;
            }

            seen.add(doc.identifier);

            const item = await getItem(doc.identifier);
            if (!item || item.error) {
              stats.metadataErrors++;
              return null;
            }

            const metadata = item.metadata || {};
            const license =
              metadata.licenseurl || doc.licenseurl || "";

            if (!allowedLicense(license)) {
              stats.rejectedLicense++;
              return null;
            }

            const audioFile = getFlacFile(item.files);

if (!audioFile) {
  stats.missingFlac++;
  return null;
}

            const creator = metadata.creator || doc.creator || "";
            const artist = Array.isArray(creator)
              ? creator.join(", ")
              : String(creator);

const searchableText = [
  metadata.title || doc.title || "",
  artist
].join(" ").toLowerCase();

if (!terms.every(term =>
  searchableText.includes(term.toLowerCase())
)) {
  return null;
}

            const track = {
              id: doc.identifier,
              title:
                metadata.title ||
                doc.title ||
                doc.identifier,
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
            stats.metadataErrors++;
            return null;
          }
        })
      );

      for (const track of checked) {
        if (track) tracks.push(track);
      }

      if (tracks.length >= MAX_TRACKS) break;
    }

    if (
      tracks.length >= MAX_TRACKS ||
      page * ROWS >= result.total
    ) {
      break;
    }
  }

  stats.accepted = tracks.length;

  return { tracks, stats };
}


async function resolveArchive(identifier) {
  const item = await getItem(identifier);

  if (!item || item.error) return null;

  const metadata = item.metadata || {};

  if (!allowedLicense(metadata.licenseurl)) {
    return null;
  }

  const audioFile = getFlacFile(item.files);
  if (!audioFile) return null;

  const file = audioFile;

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
    return json(res, 405, {
      error: "Method not allowed"
    });
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
   
  // BitChord authentication (log-only mode)
  try {
    const bitchordAuth = await bitchordAuthPromise;
    const authResult = await bitchordAuth.verifyRequest(req);

    if (!authResult.ok) {
      console.log("bitchord-auth would refuse:", authResult.error);
    }
  } catch (error) {
    console.log("bitchord-auth verifier error:", error.message);
  }

    try {
      const [archiveResult, commonsResult] = await Promise.allSettled([
  searchArchive(query),
  searchCommons(query)
]);

const archive = archiveResult.status === "fulfilled"
  ? archiveResult.value
  : { tracks: [], stats: { error: archiveResult.reason?.message || "Archive unavailable" } };

const commons = commonsResult.status === "fulfilled"
  ? commonsResult.value
  : { tracks: [], stats: { error: commonsResult.reason?.message || "Commons unavailable" } };

const result = {
  tracks: [...archive.tracks, ...commons.tracks].slice(0, MAX_TRACKS * 2),
  stats: {
    internetArchive: archive.stats,
    wikimediaCommons: commons.stats
  }
};

      if (url.searchParams.get("debug") === "1") {
        return json(res, 200, result);
      }

      return json(res, 200, {
        tracks: result.tracks
      });
    } catch (error) {
      return json(res, 502, {
        error: "Search service unavailable",
        details: error.message
      });
    }
  }

  if (pathname.startsWith("/stream/")) {
    let identifier;

    try {
      identifier = decodeURIComponent(
        pathname.slice("/stream/".length)
      );
    } catch {
      return json(res, 400, {
        error: "Invalid track ID"
      });
    }

    if (!identifier) {
      return json(res, 400, {
        error: "Missing track ID"
      });
    }

    try {
      const stream = await resolveArchive(identifier);

      if (!stream) {
        return json(res, 404, {
          error: "No permitted FLAC file found"
        });
      }

      return json(res, 200, stream);
    } catch {
      return json(res, 502, {
        error: "Stream resolution failed"
      });
    }
  }

  return json(res, 404, {
    error: "Endpoint not found"
  });
};
