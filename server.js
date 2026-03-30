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
      .filter(v => typeof v === "string" || typeof v === "number")
      .join(" ")
  );
}

function extractKeywords(query) {
  const stopwords = [
    "gibt","es","bei","euch","eine","ein","einen","weiterbildung",
    "seminar","seminare","kurs","kurse","veranstaltung",
    "im","in","bereich","zu","für","ich","suche"
  ];

  return normalize(query)
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean)
    .filter(w => !stopwords.includes(w));
}

function detectTopic(query) {
  const q = normalize(query);

  if (q.includes("ki") || q.includes("künstliche intelligenz") || q.includes("ai")) {
    return "ki";
  }

  if (q.includes("marketing")) {
    return "marketing";
  }

  if (q.includes("hr") || q.includes("recruiting")) {
    return "hr";
  }

  if (q.includes("digitalisierung") || q.includes("transformation")) {
    return "digital";
  }

  return "all";
}

function matchesTopic(text, topic) {
  if (topic === "all") return true;

  if (topic === "ki") {
    return text.includes("ki") || text.includes("ai");
  }

  if (topic === "marketing") {
    return text.includes("marketing");
  }

  if (topic === "hr") {
    return text.includes("hr") || text.includes("recruit");
  }

  if (topic === "digital") {
    return text.includes("digital");
  }

  return true;
}

function scoreEvent(event, keywords) {
  const text = getAllTextFromEvent(event);
  let score = 0;

  for (const keyword of keywords) {
    if (text.includes(keyword)) score += 2;
  }

  if (text.includes("ki")) score += 2;
  if (text.includes("ai")) score += 2;

  return score;
}

function buildAbsoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `https://www.taw.de${url}`;
  return `https://www.taw.de/${url}`;
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
    const topic = detectTopic(userQuery);

    console.log("Query:", userQuery);
    console.log("Topic erkannt:", topic);

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

    const filtered = events
      .map(e => ({
        event: e,
        text: getAllTextFromEvent(e),
        score: scoreEvent(e, keywords)
      }))
      .filter(e => matchesTopic(e.text, topic))
      .sort((a, b) => b.score - a.score);

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
