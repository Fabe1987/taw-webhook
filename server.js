import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TAW_API_URL = "https://www.taw.de/api/v1/events/list";
const TAW_CID = "16492";

function normalize(text) {
  return (text || "").toString().toLowerCase().trim();
}

function getAllTextFromEvent(event) {
  return normalize(
    Object.values(event)
      .filter(value => typeof value === "string" || typeof value === "number")
      .join(" ")
  );
}

function extractKeywords(query) {
  const stopwords = [
    "gibt",
    "es",
    "bei",
    "euch",
    "eine",
    "ein",
    "einen",
    "einer",
    "weiterbildung",
    "weiterbildungen",
    "seminar",
    "seminare",
    "kurs",
    "kurse",
    "veranstaltung",
    "veranstaltungen",
    "im",
    "in",
    "bereich",
    "zu",
    "für",
    "fuer",
    "ich",
    "suche",
    "bitte",
    "zeige",
    "welche",
    "welcher",
    "welches",
    "was",
    "an",
    "gibt's",
    "habt",
    "ihr",
    "online",
    "präsenz",
    "praesenz"
  ];

  return normalize(query)
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean)
    .filter(w => !stopwords.includes(w));
}

function buildAbsoluteUrl(rawUrl) {
  if (!rawUrl) return null;

  const url = String(rawUrl).trim();
  if (!url) return null;

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  if (url.startsWith("/")) {
    return `https://www.taw.de${url}`;
  }

  return `https://www.taw.de/${url}`;
}

function parseDateString(value) {
  if (!value) return null;

  const str = String(value).trim();

  // unterstützt z. B. 24.04.2026
  const match = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const iso = `${yyyy}-${mm}-${dd}T00:00:00`;
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isFutureOrToday(event) {
  const rawDate =
    event.date ||
    event.startDate ||
    event.beginDate ||
    event.start ||
    null;

  const parsed = parseDateString(rawDate);

  // Wenn kein Datum parsebar ist, nicht hart rauswerfen
  if (!parsed) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return parsed >= today;
}

function looksLikeRealAiTopic(text) {
  const hasAiSignal =
    text.includes("künstliche intelligenz") ||
    text.includes(" ki ") ||
    text.startsWith("ki ") ||
    text.includes(" ai ") ||
    text.includes("ai act") ||
    text.includes("ki-agent") ||
    text.includes("ki agent") ||
    text.includes("machine learning");

  if (!hasAiSignal) return false;

  // Themen, die wir für die Demo bewusst rausnehmen
  const blockedTerms = [
    "marketing",
    "kmu",
    "digitale transformation",
    "digital transformation",
    "schnittstelle zwischen fachbereich und it"
  ];

  return !blockedTerms.some(term => text.includes(term));
}

function scoreEvent(event, keywords) {
  const text = getAllTextFromEvent(event);
  let score = 0;

  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      score += 2;
    }
  }

  if (text.includes("künstliche intelligenz")) score += 4;
  if (text.includes("ki ")) score += 3;
  if (text.startsWith("ki ")) score += 3;
  if (text.includes(" ai ")) score += 2;
  if (text.includes("ai act")) score += 3;
  if (text.includes("ki-agent") || text.includes("ki agent")) score += 4;
  if (text.includes("machine learning")) score += 3;

  if (text.includes("online")) score += 1;

  if (!looksLikeRealAiTopic(text)) {
    score -= 10;
  }

  return score;
}

function mapEvent(event) {
  return {
    title:
      event.title ||
      event.name ||
      event.eventTitle ||
      event.headline ||
      "Ohne Titel",

    date:
      event.date ||
      event.startDate ||
      event.beginDate ||
      event.start ||
      null,

    location:
      event.location ||
      event.city ||
      event.place ||
      null,

    url: buildAbsoluteUrl(
      event.url ||
      event.link ||
      event.slug ||
      null
    ),

    description:
      event.description ||
      event.teaser ||
      event.summary ||
      null
  };
}

app.post("/webhook/taw-events", async (req, res) => {
  try {
    const userQuery = req.body.query || "";
    const keywords = extractKeywords(userQuery);

    console.log("User query:", userQuery);
    console.log("Keywords:", keywords);

    const tawRes = await fetch(TAW_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        cid: TAW_CID,
        page: 1,
        filters: []
      })
    });

    if (!tawRes.ok) {
      const errorText = await tawRes.text();
      console.log("TAW API error:", tawRes.status, errorText);

      return res.status(502).json({
        success: false,
        error: "TAW API konnte nicht erfolgreich abgefragt werden."
      });
    }

    const tawData = await tawRes.json();

    console.log("TAW raw keys:", Object.keys(tawData));

    const events =
      tawData.events ||
      tawData.items ||
      tawData.results ||
      tawData.data ||
      tawData.list ||
      [];

    console.log("Anzahl Events:", Array.isArray(events) ? events.length : 0);

    if (!Array.isArray(events) || events.length === 0) {
      return res.json({
        success: true,
        results: [],
        message: "Keine Events im API-Response gefunden."
      });
    }

    const scoredEvents = events.map(event => {
      const text = getAllTextFromEvent(event);
      const score = scoreEvent(event, keywords);

      return {
        event,
        text,
        score
      };
    });

    scoredEvents.sort((a, b) => b.score - a.score);

    const filtered = scoredEvents
      .filter(item => item.score > 0)
      .filter(item => looksLikeRealAiTopic(item.text))
      .filter(item => isFutureOrToday(item.event));

    if (filtered.length === 0) {
      console.log("Keine passenden Treffer gefunden.");

      return res.json({
        success: true,
        results: [],
        message: "Keine passenden Veranstaltungen gefunden."
      });
    }

    const results = filtered
      .slice(0, 5)
      .map(item => mapEvent(item.event));

    console.log("Gefundene Results:", results.length);
    console.log("Erstes Result:", results[0] || null);

    return res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error("Webhook Fehler:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.send("TAW Webhook läuft");
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
