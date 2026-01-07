import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ IMPORTANT for deployment platforms (Render/Railway/etc.)
const PORT = process.env.PORT || 8000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

/* =======================
   PAGES
======================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Lucys home page.html"));
});

app.get("/survey.html", (req, res) => {
  res.sendFile(path.join(__dirname, "survey.html"));
});

app.get("/access_to_local_help.html", (req, res) => {
  res.sendFile(path.join(__dirname, "access_to_local_help.html"));
});

// ✅ NEW: job/places search page
app.get("/jobs.html", (req, res) => {
  res.sendFile(path.join(__dirname, "jobs.html"));
});

/* =======================
   MAP API (needed by access_to_local_help.html + jobs.html)
======================= */

// Free geocode via Nominatim
app.get("/api/geocode", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query parameter: q" });

    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(q);

    const r = await fetch(url, {
      headers: { "User-Agent": "CivicConnectAI/1.0 (local dev)" },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({
        error: "Geocode upstream failed",
        status: r.status,
        body: text.slice(0, 300),
      });
    }

    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error("GEOCODE ERROR:", err);
    res.status(500).json({ error: "Server error (geocode)" });
  }
});

// Free Overpass proxy
app.post("/api/overpass", async (req, res) => {
  try {
    const query = req.body?.query;
    if (!query || typeof query !== "string") {
      return res
        .status(400)
        .json({ error: "Missing JSON body { query: '...overpass...' }" });
    }

    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "User-Agent": "CivicConnectAI/1.0 (local dev)",
      },
      body: query,
    });

    const text = await r.text();

    if (!r.ok) {
      return res.status(502).json({
        error: "Overpass upstream failed",
        status: r.status,
        body: text.slice(0, 500),
      });
    }

    // clients expect JSON text
    res.type("application/json").send(text);
  } catch (err) {
    console.error("OVERPASS ERROR:", err);
    res.status(500).json({ error: "Server error (overpass)" });
  }
});

/* =======================
   OPTIONAL: One-call "places search" API
   (jobs.html can use this OR call /api/geocode + /api/overpass directly)
======================= */
app.get("/api/places-search", async (req, res) => {
  try {
    const city = String(req.query.city || "").trim();
    const q = String(req.query.q || "").trim();
    const radiusMeters = Number(req.query.radiusMeters || 8000);

    if (!city) return res.status(400).json({ error: "Missing city" });
    if (!q) return res.status(400).json({ error: "Missing q" });

    // 1) Geocode city
    const geoUrl =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
      encodeURIComponent(city);

    const geoRes = await fetch(geoUrl, {
      headers: { "User-Agent": "CivicConnectAI/1.0 (local dev)" },
    });

    if (!geoRes.ok) {
      const t = await geoRes.text();
      return res.status(502).json({ error: "Geocode failed", body: t.slice(0, 200) });
    }

    const geo = await geoRes.json();
    if (!Array.isArray(geo) || geo.length === 0) {
      return res.status(404).json({ error: "City not found" });
    }

    const lat = Number(geo[0].lat);
    const lon = Number(geo[0].lon);
    const display = geo[0].display_name;

    // 2) Build a GENERAL Overpass query (search anything)
    const safeQ = q.toLowerCase().trim().replace(/"/g, "");

    const overpassQuery = `
[out:json][timeout:25];
(
  node["name"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  way["name"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  relation["name"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});

  node["amenity"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  way["amenity"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  relation["amenity"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});

  node["shop"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  way["shop"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  relation["shop"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});

  node["tourism"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  way["tourism"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  relation["tourism"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});

  node["office"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  way["office"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  relation["office"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});

  node["leisure"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  way["leisure"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  relation["leisure"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});

  node["healthcare"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  way["healthcare"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
  relation["healthcare"~"${safeQ}",i](around:${radiusMeters},${lat},${lon});
);
out center 50;
`;

    // 3) Call Overpass
    const overRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "User-Agent": "CivicConnectAI/1.0 (local dev)",
      },
      body: overpassQuery,
    });

    const overText = await overRes.text();

    if (!overRes.ok) {
      return res.status(502).json({
        error: "Overpass upstream failed",
        status: overRes.status,
        body: overText.slice(0, 500),
      });
    }

    // return raw overpass JSON + city label
    res.json({ cityDisplay: display, data: JSON.parse(overText) });
  } catch (err) {
    console.error("PLACES-SEARCH ERROR:", err);
    res.status(500).json({ error: "Server error (places-search)" });
  }
});

/* =======================
   AI API (needed by survey.html)
======================= */
app.post("/api/ai-summary", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ summary: "Missing OPENAI_API_KEY on server." });
    }

    const answers = req.body?.answersByKey || {};
    const city = String(answers.currentCity || "").trim() || "your city";
    const helpNeeded = Array.isArray(answers.helpNeeded) ? answers.helpNeeded : [];

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `
You are CivicConnect AI. Create a short, actionable resource guide.
Make The sections clear and organize the information by topic. You can use bold or slightly bigger fonts, but dont overdo or go crazy.
Make the sections separated by a skipped line, and have the section names bolded.

HARD RULES:
- Do NOT invent organizations, phone numbers, or addresses.
- You MAY include trusted national starting points: 211, FindHelp, USA.gov, SAMHSA.
- Include Google Maps SEARCH links (not specific addresses).
- Use bullet points only.

User city: ${city}
Help needed: ${helpNeeded.join(", ") || "general assistance"}

Output format:

## LOCAL RESOURCES (BASED ON YOUR CITY)
City: ${city}

### VERIFIED STARTING POINTS
- **211 Community Resource Hotline**
  - Phone: 211
  - Website: https://www.211.org/
  - Map: https://www.google.com/maps/search/?api=1&query=211+community+resources+${encodeURIComponent(city)}

- **FindHelp (directory by ZIP)**
  - Website: https://www.findhelp.org/
  - Map: https://www.google.com/maps/search/?api=1&query=findhelp+${encodeURIComponent(city)}

- **USA.gov Benefits**
  - Website: https://www.usa.gov/benefits
  - Map: https://www.google.com/maps/search/?api=1&query=usa.gov+benefits+${encodeURIComponent(city)}

- **SAMHSA National Helpline**
  - Phone: 1-800-662-HELP (4357)
  - Website: https://www.samhsa.gov/find-help/national-helpline
  - Map: https://www.google.com/maps/search/?api=1&query=samhsa+helpline+${encodeURIComponent(city)}

### LOCAL SEARCH LINKS
- Food assistance: https://www.google.com/maps/search/?api=1&query=food+bank+${encodeURIComponent(city)}
- Housing support: https://www.google.com/maps/search/?api=1&query=homeless+shelter+${encodeURIComponent(city)}
- Health: https://www.google.com/maps/search/?api=1&query=free+clinic+${encodeURIComponent(city)}
- Legal support: https://www.google.com/maps/search/?api=1&query=legal+aid+${encodeURIComponent(city)}

## NEXT STEPS
- 4–6 one-line actions tailored to helpNeeded.
`;

    const response = await client.responses.create({
      model: "gpt-5.2",
      input: prompt,
    });

    res.json({ summary: response.output_text || "" });
  } catch (err) {
    console.error("AI ERROR:", err);
    res.status(500).json({ summary: "AI error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log("✅ server2.mjs running");
  console.log(`🏠 Home:  http://localhost:${PORT}/`);
  console.log(`🧭 Help:  http://localhost:${PORT}/access_to_local_help.html`);
  console.log(`📝 Survey: http://localhost:${PORT}/survey.html`);
  console.log(`💼 Jobs:  http://localhost:${PORT}/jobs.html`);
});
