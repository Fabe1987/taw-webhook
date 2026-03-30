import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TAW_API_URL = "https://www.taw.de/api/v1/events/list";
const TAW_CID = "16492";

function normalize(text) {
  return (text || "").toString().toLowerCase().trim();
}

function stripHtml(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  return (text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ouml;/gi, "ö")
    .replace(/&auml;/gi, "ä")
    .replace(/&uuml;/gi, "ü")
    .replace(/&Ouml;/gi, "Ö")
    .replace(/&Auml;/gi, "Ä")
    .replace(/&Uuml;/gi, "Ü")
    .replace(/&szlig;/gi, "ß");
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
    "habt",
    "ihr",
    "gibt's"
  ];

  return normalize(query)
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter(Boolean)
    .filter(w => !stopwords.includes(w));
}

function detectTopic(query) {
  const q = normalize(query);

  if (q.includes("marketing")) return "marketing";
  if (q.includes("hr") || q.includes("recruiting") || q.includes("personal")) return "hr";
  if (q.includes("digitalisierung") || q.includes("transformation")) return "digital";
  if (
    q.includes("ki") ||
    q.includes("künstliche intelligenz") ||
    q.includes("ai") ||
    q.includes("chatgpt")
  ) {
    return "ki";
  }

  return "all";
}

function buildAbsoluteUrl(url) {
  if (!url) return null;
  const value = String(url).trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return `https://www.taw.de${value}`;
  return `https://www.taw.de/${value}`;
}

function parseDateString(value) {
  if (!value) return null;

  const str = String(value).trim();
  const match = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
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
  if (!parsed) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return parsed >= today;
}

function matchesTopic(text, topic) {
  if (topic === "all") return true;

  if (topic === "marketing") {
    return text.includes("marketing");
  }

  if (topic === "hr") {
    return (
      text.includes(" hr ") ||
      text.startsWith("hr ") ||
      text.includes("recruiting") ||
      text.includes("personal")
    );
  }

  if (topic === "digital") {
    return (
      text.includes("digitalisierung") ||
      text.includes("digitale transformation") ||
      text.includes("transformation")
    );
  }

  if (topic === "ki") {
    const hasKiSignal =
      text.includes("künstliche intelligenz") ||
      text.includes(" ki ") ||
      text.startsWith("ki ") ||
      text.includes(" ai ") ||
      text.includes("ai act") ||
      text.includes("chatgpt") ||
      text.includes("ki-agent") ||
      text.includes("ki agent") ||
      text.includes("machine learning") ||
      text.includes("automation");

    if (!hasKiSignal) return false;

    const excludedForKi = [
      "marketing",
      "einkauf",
      "vertrieb",
      "kmu",
      "digitale transformation",
      "digital transformation"
    ];

    if (excludedForKi.some(term => text.includes(term))) {
      return false;
    }

    return true;
  }

  return true;
}

function scoreEvent(event, keywords, topic) {
  const text = getAllTextFromEvent(event);
  let score = 0;

  for (const keyword of keywords) {
    if (text.includes(keyword)) score += 2;
  }

  if (topic === "ki") {
    if (text.includes("künstliche intelligenz")) score += 5;
    if (text.includes("ki ")) score += 4;
    if (text.startsWith("ki ")) score += 4;
    if (text.includes("ai act")) score += 5;
    if (text.includes("ki-agent") || text.includes("ki agent")) score += 5;
    if (text.includes("machine learning")) score += 4;
    if (text.includes("automation")) score += 2;
    if (text.includes("marketing")) score -= 10;
    if (text.includes("einkauf")) score -= 10;
    if (text.includes("vertrieb")) score -= 10;
    if (text.includes("kmu")) score -= 10;
    if (text.includes("digitale transformation")) score -= 10;
  }

  if (topic === "marketing" && text.includes("marketing")) score += 5;
  if (topic === "hr" && (text.includes("recruiting") || text.includes("personal") || text.includes(" hr "))) score += 5;
  if (topic === "digital" && (text.includes("digitalisierung") || text.includes("transformation"))) score += 5;

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

function extractMetaContent(html, attrName, attrValue) {
  const regex = new RegExp(
    `<meta[^>]+${attrName}=["']${attrValue}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(regex);
  return match ? decodeHtmlEntities(match[1]).trim() : null;
}

function extractParagraphCandidates(html) {
  const matches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches
    .map(m => stripHtml(m[1]))
    .map(t => decodeHtmlEntities(t))
    .filter(Boolean)
    .filter(t => t.length > 80)
    .filter(t => !/^datum[:\s]/i.test(t))
    .filter(t => !/^ort[:\s]/i.test(t))
    .filter(t => !/^preis[:\s]/i.test(t))
    .filter(t => !/^mehr information/i.test(t))
    .slice(0, 5);
}

async function fetchSeminarDetails(url) {
  if (!url) return { content: null };

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"
      }
    });

    if (!res.ok) {
      console.log("Detailseite nicht erreichbar:", url, res.status);
      return { content: null };
    }

    const html = await res.text();

    const metaDescription =
      extractMetaContent(html, "name", "description") ||
      extractMetaContent(html, "property", "og:description");

    const paragraphCandidates = extractParagraphCandidates(html);

    const content =
      metaDescription ||
      paragraphCandidates[0] ||
      null;

    return {
      content
    };
  } catch (error) {
    console.log("Fehler beim Laden der Detailseite:", url, error.message);
    return { content: null };
  }
}

async function enrichEvent(event) {
  const mapped = mapEvent(event);

  // Nur Details nachladen, wenn keine brauchbare Beschreibung vorhanden ist
  if (mapped.description && mapped.description.length > 40) {
    return {
      ...mapped,
      content: mapped.description
    };
  }

  const details = await fetchSeminarDetails(mapped.url);

  return {
    ...mapped,
    content: details.content || mapped.description || null
  };
}

app.post("/webhook/taw-events", async (req, res) => {
  try {
    const userQuery = req.body.query || "";
    const keywords = extractKeywords(userQuery);
    const topic = detectTopic(userQuery);

    console.log("User query:", userQuery);
    console.log("Keywords:", keywords);
    console.log("Topic erkannt:", topic);

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

    const ranked = events
      .map(event => {
        const text = getAllTextFromEvent(event);
        const score = scoreEvent(event, keywords, topic);

        return {
          event,
          text,
          score
        };
      })
      .filter(item => matchesTopic(item.text, topic))
      .filter(item => isFutureOrToday(item.event))
      .sort((a, b) => b.score - a.score);

    const topEvents = ranked.slice(0, 5).map(item => item.event);

    const results = await Promise.all(topEvents.map(enrichEvent));

    console.log("Gefundene Results:", results.length);
    console.log("Erstes Result:", results[0] || null);

    return res.json({
      success: true,
      results
    });
  } catch (err) {
    console.error("Webhook Fehler:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/", (req, res) => {
  res.send("TAW Webhook läuft");
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
