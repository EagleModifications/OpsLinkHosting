require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const axios = require("axios");
const path = require("path");

const app = express();

// ---------------- MIDDLEWARE ----------------
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));
app.use("/js", express.static(path.join(__dirname, "js")));

// ---------------- DATABASE ----------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
console.log("✅ Connected to MongoDB");

// ---------------- SCHEMAS ----------------
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  stripeCustomerId: String,
  servers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Server" }],
  panelPassword: String
});

const ServerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  plan: String,
  status: { type: String, default: "pending" },
  pteroId: String,
  stripeSessionId: String,
  stripeSubscriptionId: String,
  createdAt: { type: Date, default: Date.now },
  backupEnabled: { type: Boolean, default: false },
  addons: [String],
  type: String
});

const User = mongoose.model("User", UserSchema);
const Server = mongoose.model("Server", ServerSchema);

// ---------------- PLANS ----------------
const PLAN_CONFIG = {
  "static-basic": {
    priceId: process.env.PRICE_STATIC_BASIC,
    egg: 15,
    docker: "ghcr.io/pterodactyl/yolks:nodejs_18",
    memory: 1024,
    disk: 1024,
    cpu: 100,
    backups: 1,
    environment: { NODE_ENV: "production" }
  },
  "dynamic-basic": {
    priceId: process.env.PRICE_DYNAMIC_BASIC,
    egg: 17,
    docker: "ghcr.io/pterodactyl/yolks:php_8.2",
    memory: 2048,
    disk: 2048,
    cpu: 200,
    backups: 2,
    environment: { PHP_VERSION: "8.2" }
  }
};

// ---------------- EMAIL ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ---------------- DISCORD LOGGING ----------------
async function discordLog(title, description, color = 0x4e8cff) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      embeds: [{ title, description, color, timestamp: new Date().toISOString() }]
    });
  } catch (err) {
    console.error("Discord logging failed:", err.message);
  }
}

// ---------------- AUTH MIDDLEWARE ----------------
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

// ---------------- REGISTER ----------------
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed });

    const customer = await stripe.customers.create({ email });
    user.stripeCustomerId = customer.id;
    await user.save();

    await discordLog("New User Registered", `Email: ${email}`, 0x00ff00);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: "Email already exists." });
  }
});

// ---------------- LOGIN ----------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.json({ success: false, message: "User not found" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, message: "Invalid password" });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  await discordLog("User Logged In", `Email: ${email}`, 0x00ffff);
  res.json({ success: true, token });
});

// ---------------- CHECKOUT SESSION ----------------
app.post("/api/checkout-session", async (req, res) => {
  const { plan, email } = req.body;

  try {
    let user;

    // 1️⃣ Logged-in user
    if (req.headers.authorization) {
      const token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      user = await User.findById(decoded.id);
    } 
    // 2️⃣ Guest checkout
    else if (email) {
      user = await User.findOne({ email });
      if (!user) {
        const tempPass = Math.random().toString(36).slice(-8);
        const hashed = await bcrypt.hash(tempPass, 10);
        user = await User.create({ email, password: hashed });
        const customer = await stripe.customers.create({ email });
        user.stripeCustomerId = customer.id;
        await user.save();
      }
    }

    if (!user) return res.status(400).json({ success: false, message: "User not found" });

    // Map plan to priceId
    let priceId;
    switch (plan) {
      case "static-basic": priceId = process.env.PRICE_STATIC_BASIC; break;
      case "dynamic-basic": priceId = process.env.PRICE_DYNAMIC_BASIC; break;
      default: return res.status(400).json({ success: false, message: "Invalid plan" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      metadata: { userId: user._id.toString(), plan },
      success_url: `${process.env.FRONTEND_URL}/set-password.html?guestUserId=${user._id}`,
      cancel_url: `${process.env.FRONTEND_URL}/website-hosting.html?canceled=true`
    });

    res.json({ success: true, checkoutUrl: session.url });
  } catch (err) {
    console.error("[Stripe Checkout Error]", err);
    res.status(500).json({ success: false, message: "Failed to create checkout session" });
  }
});

// ---------------- Guest token endpoint ----------------
app.get("/api/guest-token/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.json({ success: false, message: "User not found" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Failed to generate token" });
  }
});

// ---------------- STRIPE WEBHOOK ----------------
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook verification failed:", err.message);
    return res.status(400).send("Webhook Error");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { userId, plan } = session.metadata || {};

    if (!userId || !plan) return res.json({ received: true });

    try {
      const user = await User.findById(userId);
      if (!user) return res.json({ received: true });

      const server = await Server.create({
        user: user._id,
        plan,
        status: "pending",
        createdAt: new Date()
      });

      const cfg = PLAN_CONFIG[plan];

      async function createPteroServer(retries = 3, delay = 3000) {
        try {
          const pteroRes = await axios.post(
            `${process.env.PTERO_URL}/api/application/servers`,
            {
              name: `OpsLink-${server._id}`,
              user: user._id.toString(),
              egg: cfg.egg,
              docker_image: cfg.docker,
              limits: { memory: cfg.memory, disk: cfg.disk, cpu: cfg.cpu },
              feature_limits: { backups: cfg.backups },
              environment: cfg.environment,
              startup: "",
              deploy: { locations: [1], dedicated_ip: false }
            },
            { headers: { Authorization: `Bearer ${process.env.PTERO_API_KEY}`, "Content-Type": "application/json" } }
          );

          server.pteroId = pteroRes.data.attributes.id;
          server.status = "active";
          server.stripeSubscriptionId = session.subscription;
          await server.save();

          await transporter.sendMail({
            to: user.email,
            subject: "Server Ready",
            text: `Your ${plan} server is now active. You can log in with your panel password.`
          });

          await discordLog(
            "Server Created",
            `User: ${user.email}\nPlan: ${plan}\nPtero ID: ${server.pteroId}`,
            0x00ff00
          );

        } catch (err) {
          if (retries > 0) {
            await new Promise(r => setTimeout(r, delay));
            await createPteroServer(retries - 1, delay * 2);
          } else {
            server.status = "failed";
            await server.save();
            console.error("Ptero server creation failed:", err.message);
            await discordLog("Server Creation Failed", err.message, 0xff0000);
          }
        }
      }

      await createPteroServer();
    } catch (err) {
      console.error("Server provisioning failed:", err);
      await discordLog("Server Creation Failed", err.message, 0xff0000);
    }
  }

  res.json({ received: true });
});

// ---------------- GET SERVERS ----------------
app.get("/api/servers", authMiddleware, async (req, res) => {
  const servers = await Server.find({ user: req.userId });
  res.json({ success: true, servers });
});

// ---------------- SERVER ACTIONS ----------------
app.post("/api/server/:action", authMiddleware, async (req, res) => {
  const { action } = req.params;
  const { serverId, enable, newPlan } = req.body;

  const server = await Server.findById(serverId);
  if (!server || server.user.toString() !== req.userId)
    return res.json({ success: false, message: "Server not found" });

  try {
    if (action === "backups") {
      server.backupEnabled = !!enable;
      await server.save();
      await discordLog(`Backup ${enable ? "enabled" : "disabled"}`, `Server ID: ${serverId}`);
      return res.json({ success: true });
    }
    if (action === "cancel") {
      server.status = "canceled";
      await server.save();
      await discordLog("Server canceled", `Server ID: ${serverId}`);
      return res.json({ success: true });
    }
    if (action === "upgrade") {
      if (!newPlan || !PLAN_CONFIG[newPlan])
        return res.json({ success: false, message: "Invalid plan" });
      server.plan = newPlan;
      await server.save();
      await discordLog(`Server upgraded → ${newPlan}`, `Server ID: ${serverId}`);
      return res.json({ success: true });
    }
    res.json({ success: false, message: "Unknown action" });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Server action failed" });
  }
});

// ---------------- SET PANEL PASSWORD ----------------
app.post("/api/set-panel-password", authMiddleware, async (req, res) => {
  const { password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await User.updateOne({ _id: req.userId }, { panelPassword: hashed });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Failed to set password" });
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
