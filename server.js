const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const axios = require("axios");
const dns = require("dns").promises;
const cron = require("node-cron");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = "supersecretkey";

/* ================= DB ================= */
const db = mysql.createPool({
  host: "127.0.0.1", // FIXED (important for docker/local)
  user: "admin",
  password: "Root@1234",
  database: "monitoring"
});

/* ================= AUTH ================= */
function authMiddleware(req, res, next) {
  const token = req.headers.authorization;

  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* ================= SIGNUP ================= */
app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashed]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= LOGIN ================= */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [users] = await db.query(
      "SELECT * FROM users WHERE email=?",
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = users[0];

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ error: "Wrong password" });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, {
      expiresIn: "1h"
    });

    res.json({ success: true, token });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= ADD WEBSITE ================= */
app.post("/add-website", authMiddleware, async (req, res) => {
  try {
    console.log("🔥 ADD WEBSITE HIT");

    let { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL required" });
    }

    if (!url.startsWith("http")) {
      url = "https://" + url;
    }

    await db.query("INSERT INTO websites (url) VALUES (?)", [url]);

    console.log("✅ Inserted:", url);

    res.json({ success: true });

  } catch (err) {
    console.error("❌ ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET WEBSITES ================= */
app.get("/websites", authMiddleware, async (req, res) => {
  const [rows] = await db.query("SELECT * FROM websites");
  res.json(rows);
});

/* ================= STATUS ================= */
app.get("/status", async (req, res) => {
  const [rows] = await db.query(`
    SELECT l.url, l.status, l.response_time
    FROM logs l
    INNER JOIN (
      SELECT url, MAX(timestamp) as latest
      FROM logs
      GROUP BY url
    ) latest_logs
    ON l.url = latest_logs.url AND l.timestamp = latest_logs.latest
  `);

  res.json(rows);
});

/* ================= LOGS ================= */
app.get("/logs", async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50"
  );
  res.json(rows);
});

/* ================= CRON ================= */
cron.schedule("*/30 * * * * *", async () => {
  console.log("⏱ Running checks...");

  const [sites] = await db.query("SELECT url FROM websites");

  for (let site of sites) {
    const url = site.url;
    const start = Date.now();

    try {
      const domain = new URL(url).hostname;

      await dns.lookup(domain);

      const response = await axios.get(url, {
        timeout: 5000,
        validateStatus: () => true
      });

      const time = Date.now() - start;

      const status =
        response.status >= 200 && response.status < 400
          ? response.status
          : "DOWN";

      await db.query(
        "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
        [url, status, time]
      );

    } catch (err) {
      let status = "DOWN";

      if (err.code === "ENOTFOUND") status = "DNS_FAIL";
      if (err.code === "ECONNABORTED") status = "TIMEOUT";

      await db.query(
        "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
        [url, status, 0]
      );
    }
  }
});

/* ================= START ================= */
app.listen(5000, async () => {
  try {
    await db.query("SELECT 1");
    console.log("✅ DB Connected");
  } catch (err) {
    console.error("❌ DB Error:", err);
  }

  console.log("🚀 Server running on port 5000");
});

