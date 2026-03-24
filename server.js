const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mysql = require("mysql2/promise");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const client = require("prom-client");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= DB CONNECTION (POOL - FIXED) ================= */
const db = mysql.createPool({
  host: "3.236.191.132",   // EC2 IP
  user: "root",
  password: "Root@1234",
  database: "monitoring",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/* ================= PROMETHEUS ================= */
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "Response time",
  buckets: [50, 100, 200, 500, 1000, 2000]
});

/* ================= EMAIL ALERT ================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your@email.com",
    pass: "your_app_password"
  }
});

/* ================= ADD WEBSITE ================= */
app.post("/add", async (req, res) => {
  try {
    let { url } = req.body;

    if (!url.startsWith("http")) {
      url = "https://" + url;
    }

    await db.query("INSERT INTO websites (url) VALUES (?)", [url]);

    res.json({ message: "Website added" });
  } catch (err) {
    console.error(err);
    res.status(500).send("DB Error");
  }
});

/* ================= MANUAL CHECK ================= */
app.post("/check", async (req, res) => {
  let { url } = req.body;

  if (!url.startsWith("http")) {
    url = "https://" + url;
  }

  const start = Date.now();
  const end = httpRequestDuration.startTimer();

  try {
    const response = await axios.get(url);
    const time = Date.now() - start;
    end();

    await db.query(
      "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
      [url, response.status, time]
    );

    res.json({ status: response.status, time });

  } catch (err) {
    end();

    await db.query(
      "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
      [url, "DOWN", 0]
    );

    res.json({ status: "DOWN", time: 0 });
  }
});

/* ================= CRON JOB ================= */
cron.schedule("*/30 * * * * *", async () => {
  console.log("Running scheduled checks...");

  try {
    const [rows] = await db.query("SELECT url FROM websites");

    for (let row of rows) {
      const url = row.url;
      const start = Date.now();

      try {
        const response = await axios.get(url);
        const time = Date.now() - start;

        await db.query(
          "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
          [url, response.status, time]
        );

        if (time > 2000) {
          sendAlert(`⚠️ Slow: ${url} (${time} ms)`);
        }

      } catch (err) {
        await db.query(
          "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
          [url, "DOWN", 0]
        );

        sendAlert(`🚨 DOWN: ${url}`);
      }
    }

  } catch (err) {
    console.error("Cron DB error:", err);
  }
});

/* ================= ALERT ================= */
function sendAlert(message) {
  console.log("ALERT:", message);

  // Email
  transporter.sendMail({
    to: "your@email.com",
    subject: "Monitoring Alert",
    text: message
  }).catch(() => {});

  // Slack
  axios.post("YOUR_SLACK_WEBHOOK_URL", {
    text: message
  }).catch(() => {});
}

/* ================= ANALYTICS ================= */
app.get("/analytics", async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT url, 
             COUNT(*) as checks, 
             AVG(response_time) as avg_time,
             SUM(status='DOWN') as downtime
      FROM logs
      GROUP BY url
    `);

    res.json(results);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

/* ================= LOGS ================= */
app.get("/logs", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50"
    );

    res.json(results);

  } catch (err) {
    res.status(500).send(err);
  }
});

/* ================= METRICS ================= */
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

/* ================= HEALTH ================= */
app.get("/health", (req, res) => {
  res.send("OK");
});

/* ================= START ================= */
app.listen(3000, async () => {
  try {
    await db.query("SELECT 1");
    console.log("✅ DB Connected");
  } catch (err) {
    console.error("❌ DB Connection Failed:", err);
  }

  console.log("🚀 Server running on port 3000");
});

/* ================= MBR ================= */

app.get("/", (req, res) => {
  res.send("🚀 Monitoring Backend Running");
});
