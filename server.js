const dns = require("dns").promises;
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mysql = require("mysql2/promise");
const cron = require("node-cron");
const nodemailer = require("nodemailer");
const client = require("prom-client");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= CONFIG ================= */
const JWT_SECRET = "supersecretkey";

/* ================= DB ================= */
const db = mysql.createPool({
  host: "3.236.191.132",
  user: "root",
  password: "Root@1234",
  database: "monitoring"
});

/* ================= EMAIL ================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your@email.com",
    pass: "your_app_password"
  }
});

/* ================= AUTH MIDDLEWARE ================= */
function authMiddleware(req, res, next) {
  const token = req.headers.authorization;

  if (!token) return res.status(401).send("No token");

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).send("Invalid token");
  }
}

/* ================= SIGNUP ================= */
app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const hashed = await bcrypt.hash(password, 10);

    await db.query(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashed]
    );

    res.json({ message: "Signup successful" });

  } catch (err) {
    res.status(500).send("User already exists");
  }
});

/* ================= LOGIN ================= */
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const [users] = await db.query(
    "SELECT * FROM users WHERE email=?",
    [email]
  );

  if (users.length === 0) {
    return res.status(401).json({ message: "User not found" });
  }

  const user = users[0];

  const match = await bcrypt.compare(password, user.password);

  if (!match) {
    return res.status(401).json({ message: "Wrong credentials" });
  }

  const token = jwt.sign({ id: user.id }, JWT_SECRET, {
    expiresIn: "1h"
  });

  res.json({ token });
});

/* ================= FORGOT PASSWORD (FIXED) ================= */
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  try {
    const [users] = await db.query(
      "SELECT * FROM users WHERE email=?",
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const token = uuidv4();
    const expiry = Date.now() + 3600000; // 1 hour

    await db.query(
      "UPDATE users SET reset_token=?, reset_token_expiry=? WHERE email=?",
      [token, expiry, email]
    );

    const resetLink = `http://localhost:3000/reset.html?token=${token}`;

    // ✅ Send email (ignore failure in dev)
    try {
      await transporter.sendMail({
        to: email,
        subject: "Reset Password",
        text: resetLink
      });
    } catch (e) {
      console.log("Email failed (dev mode):", e.message);
    }

    // ✅ IMPORTANT: RETURN LINK (PERMANENT FIX FOR TESTING)
    res.json({
      message: "Reset link generated",
      resetLink,
      token   // helpful for testing
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ================= RESET PASSWORD ================= */
app.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const [users] = await db.query(
      "SELECT * FROM users WHERE reset_token=?",
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const user = users[0];

    if (Date.now() > user.reset_token_expiry) {
      return res.status(400).json({ message: "Token expired" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await db.query(
      "UPDATE users SET password=?, reset_token=NULL, reset_token_expiry=NULL WHERE id=?",
      [hashed, user.id]
    );

    res.json({ message: "Password reset successful" });

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* ================= PROTECTED API ================= */
app.post("/add", authMiddleware, async (req, res) => {
  let { url } = req.body;

  if (!url.startsWith("http")) {
    url = "https://" + url;
  }

  await db.query("INSERT INTO websites (url) VALUES (?)", [url]);

  res.json({ message: "Website added" });
});
/* ================= LOGS ================= */
app.get("/logs", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 50"
    );

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).send("Logs error");
  }
});


/* ================= ANALYTICS ================= */
app.get("/analytics/:hours", async (req, res) => {
  const hours = parseInt(req.params.hours);

  try {
    const [results] = await db.query(`
      SELECT
        url,
        COUNT(*) as total_checks,
        SUM(status = 200) as success,
        SUM(status != 200) as failed,
        ROUND((SUM(status = 200) / COUNT(*)) * 100, 2) as uptime
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL ? HOUR
      GROUP BY url
    `, [hours]);

    res.json(results);

  } catch (err) {
    console.error(err);
    res.status(500).send("Analytics error");
  }
});


/* ================= TIMESERIES (NEW) ================= */
app.get("/timeseries/:hours", async (req, res) => {
  const hours = parseInt(req.params.hours);

  try {
    const [results] = await db.query(`
      SELECT
        url,
        response_time,
        status,
        timestamp
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL ? HOUR
      ORDER BY timestamp ASC
    `, [hours]);

    res.json(results);

  } catch (err) {
    console.error(err);
    res.status(500).send("Timeseries error");
  }
});

/* ================= START ================= */
app.listen(3000, async () => {
  try {
    await db.query("SELECT 1");
    console.log("✅ DB Connected");
  } catch (err) {
    console.error("❌ DB Error", err);
  }

  console.log("🚀 Server running on port 3000");
});

/* ================= CRON BLOCK ================= */
cron.schedule("*/30 * * * * *", async () => {
  console.log("Running scheduled checks...");

  try {
    const [rows] = await db.query("SELECT url FROM websites");

    for (let row of rows) {
      const url = row.url;
      const start = Date.now();

      try {
        // ✅ DNS CHECK
        const domain = new URL(url).hostname;

        try {
          await dns.lookup(domain);
        } catch (dnsErr) {
          await db.query(
            "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
            [url, "DNS_FAIL", 0]
          );
          continue;
        }

        // ✅ HTTP CHECK
        const response = await axios.get(url, {
          timeout: 5000,
          validateStatus: () => true
        });

        const time = Date.now() - start;

        let status = "DOWN";

        if (response.status >= 200 && response.status < 400) {
          status = response.status;
        } else {
          status = "DOWN";
        }

        await db.query(
          "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
          [url, status, time]
        );

      } catch (err) {
        let status = "DOWN";

        if (err.code === "ENOTFOUND") status = "DNS_FAIL";
        else if (err.code === "ECONNABORTED") status = "TIMEOUT";
        else status = "DOWN";

        await db.query(
          "INSERT INTO logs (url, status, response_time) VALUES (?, ?, ?)",
          [url, status, 0]
        );
      }
    }

  } catch (err) {
    console.error("Cron DB error:", err);
  }
});

/* ================= VISUAL ================= */
app.get("/analytics/:hours", async (req, res) => {
  const hours = parseInt(req.params.hours);

  try {
    const [results] = await db.query(`
      SELECT
        url,
        COUNT(*) as total_checks,
        SUM(status = 200) as success,
        SUM(status != 200) as failed
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL ? HOUR
      GROUP BY url
    `, [hours]);

    res.json(results);

  } catch (err) {
    console.error(err);
    res.status(500).send("Analytics error");
  }
});

