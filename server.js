const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

// ✅ CORS (this is enough)
app.use(cors());

// ✅ JSON parser
app.use(express.json());

// ✅ API
app.post("/check", async (req, res) => {
  let { url } = req.body;

  // auto fix URL
  if (!url.startsWith("http")) {
    url = "https://" + url;
  }

  const start = Date.now();

  try {
    const response = await axios.get(url);
    const time = Date.now() - start;

    res.json({
      status: response.status,
      time
    });

  } catch (err) {
    res.json({
      status: "DOWN",
      time: 0
    });
  }
});

// ✅ Start server
app.listen(3000, () => console.log("Server running on port 3000"));
