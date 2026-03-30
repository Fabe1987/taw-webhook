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
    "gibt","es","bei","euch","eine","ein","einen","einer",
    "weiterbildung","weiterbildungen","seminar","seminare",
    "kurs","kurse","veranstaltung","veranstaltungen",
    "im","in","bereich","zu","für","fuer","ich","suche",
    "bitte","zeige","welche","was","an","habt","ihr"
  ];

  return normalize(query)
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean)
    .filter(w => !stopwords.includes(w));
}

function buildAbsoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `https://www.taw.de${url}`;
  return `https://www.taw.de/${url}`;
}

function looksLikeRealAiTopic(text) {
  // ❌ harte Ausschlüsse (nur wirklich irrelevante Sachen)
  const exclude = [
    "marketing",
    "einkauf",
    "vertrieb"
  ];

  if (exclude.some(term => text.includes(term))) {
    return false;
  }

  // ✅ KI-Signale (breiter gefasst!)
  return (
    text.includes("ki") ||
    text.includes("künstliche intelligenz") ||
    text.includes("ai") ||
    text.includes("ai act") ||
    text.includes("automation")
  );
}

function scoreEvent(event, keywords) {
  const text = getAllTextFromEvent(event);
  let score = 0;

  for (const keyword of keywords) {
    if (text.includes(keyword)) score += 2;
  }

  if (text.includes("ki")) score += 3;
  if (text.includes("künstliche intelligenz")) score += 4;
  if (text.includes("ai act")) score += 5;
  if (text.includes("agent")) score += 4;
  if (text.includes("automation")) score += 2;

  return score;
}

function mapEvent(event) {
  return {
    title: event.title || "Ohne Titel",
    date: event.date || null,
    location: event.location || null,
    url: buildAbsoluteUrl(event.url)
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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        cid: TAW_CID,
        page: 1,
        filters: []
      })
    });

    const tawData = await tawRes.json();

    const events = tawData.items || [];

    console.log("Anzahl Events:", events.length);

    const filtered = events
      .map(e => ({
        event: e,
        text: getAllTextFromEvent(e),
        score: scoreEvent(e, keywords)
      }))
      .filter(e => looksLikeRealAiTopic(e.text))
      .sort((a, b) => b.score - a.score);

    console.log("Gefundene Results:", filtered.length);

    const results = filtered.slice(0, 5).map(e => mapEvent(e.event));

    return res.json({
      success: true,
      results
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false });
  }
});

app.get("/", (req, res) => {
  res.send("TAW Webhook läuft");
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
