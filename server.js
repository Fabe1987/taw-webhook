import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TAW_API_URL = "https://www.taw.de/api/v1/events/list";
const TAW_CID = "16492";

function normalize(text) {
  return (text || "").toString().toLowerCase().trim();
}

function detectFormat(query) {
  const q = normalize(query);

  if (q.includes("online") || q.includes("webinar") || q.includes("virtuell")) {
    return "online";
  }

  if (q.includes("präsenz") || q.includes("vor ort")) {
    return "praesenz";
  }

  return "";
}

function detectTopic(query) {
  const q = normalize(query);

  const stopwords = [
    "welche","gibt","es","seminare","kurse","weiterbildungen",
    "zu","im","in","am","für","online","bitte","zeige"
  ];

  return q
    .split(" ")
    .filter(word => !stopwords.includes(word))
    .slice(0, 2)
    .join(" ");
}

function matchesQuery(event, query, format, topic) {
  const haystack = normalize(
    `${event.title || ""} ${event.description || ""} ${event.location || ""}`
  );

  if (format === "online" && !haystack.includes("online")) return false;
  if (topic && !haystack.includes(topic)) return false;

  if (query) {
    const words = normalize(query).split(" ");
    const match = words.some(w => haystack.includes(w));
    if (!match) return false;
  }

  return true;
}

function mapEvent(event) {
  return {
    title: event.title || "Ohne Titel",
    date: event.date || null,
    location: event.location || null,
    url: event.url || null,
    description: event.description || null
  };
}

app.post("/webhook/taw-events", async (req, res) => {
  try {
    const userQuery = req.body.query || "";

    const format = detectFormat(userQuery);
    const topic = detectTopic(userQuery);

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

    const events = tawData.events || tawData.items || tawData.data || [];

    const results = events
      .filter(e => matchesQuery(e, userQuery, format, topic))
      .map(mapEvent)
      .slice(0, 5);

    res.json({
      success: true,
      results
    });

  } catch (error) {
    res.status(500).json({
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
