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
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
console.log("✅ Connected to MongoDB");

// ---------------- SCHEMAS ----------------
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  stripeCustomerId: String,
  servers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Server" }],
});

const ServerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  plan: String,
  status: { type: String, default: "pending" }, // pending | active | failed | canceled
  pteroId: String,
  stripeSessionId: String,
  stripeSubscriptionId: String,
  createdAt: { type: Date, default: Date.now },
  backupEnabled: { type: Boolean, default: false },
  addons: [String],
  type: String,
});

const User = mongoose.model("User", UserSchema);
const Server = mongoose.model("Server", ServerSchema);

// ---------------- PLANS ----------------
const PLANS = {
  "static-basic": {
    type: "static",
    limits: { memory: 512, swap: 0, disk: 1024, io: 500, cpu: 50 },
    feature_limits: { databases: 0, backups: 1, allocations: 1 },
    environment: { WEBSITE_TYPE: "static" },
    egg: 19,
    nest: 5,
    docker_image: "ghcr.io/red-shadows-rs/pterodactyl-containers/python:v3.13",
    priceId: process.env.PRICE_STATIC_BASIC
  },
  "dynamic-basic": {
    type: "dynamic",
    limits: { memory: 1024, swap: 0, disk: 2048, io: 500, cpu: 25 },
    feature_limits: { databases: 0, backups: 3, allocations: 1 },
    environment: { WEBSITE_TYPE: "dynamic" },
    egg: 18,
    nest: 5,
    docker_image: "ghcr.io/ptero-eggs/yolks:nodejs_25",
    priceId: process.env.PRICE_DYNAMIC_BASIC
  },
};

// ---------------- EMAIL ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ---------------- DISCORD LOGGING ----------------
async function discordLog(title, description, color = 0x4e8cff) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      embeds: [{ title, description, color, timestamp: new Date().toISOString() }]
    });
  } catch (err) {
    console.error("Discord logging failed:", err);
  }
}

// ---------------- AUTH ----------------
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

    // Create Stripe customer immediately
    const customer = await stripe.customers.create({ email });
    user.stripeCustomerId = customer.id;
    await user.save();

    await discordLog("New User Registered", `Email: ${email}\nStripe Customer: ${customer.id}`, 0x00ff00);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Email already exists." });
  }
});

// ---------------- LOGIN ----------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: "Invalid password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    await discordLog("User Logged In", `Email: ${email}`, 0x00ffff);
    res.json({ success: true, token });
  } catch {
    res.json({ success: false, message: "Login failed" });
  }
});

// ---------------- CREATE STRIPE CHECKOUT SESSION ----------------
app.post("/api/checkout-session", authMiddleware, async (req, res) => {
  const { plan, priceId } = req.body;
  if (!plan || !PLANS[plan]) return res.status(400).json({ success: false, message: "Invalid plan" });

  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ success: false, message: "User not found" });

  try {
    // Ensure Stripe customer exists
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({ email: user.email });
      user.stripeCustomerId = customer.id;
      await user.save();
      await discordLog("Stripe customer created", `User: ${user.email}\nCustomer ID: ${customer.id}`, 0x00ff00);
    }

    // Create pending server in DB
    const server = await Server.create({
      user: user._id,
      plan,
      status: "pending",
      type: PLANS[plan].type
    });
    user.servers.push(server._id);
    await user.save();

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer: user.stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/account.html?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/account.html?canceled=true`,
      metadata: { userId: user._id.toString(), plan, serverId: server._id.toString() },
    });

    server.stripeSessionId = session.id;
    await server.save();

    await discordLog("Stripe Checkout Started", `User: ${user.email}\nPlan: ${plan}\nSession ID: ${session.id}`, 0xffa500);
    res.json({ success: true, checkoutUrl: session.url });
  } catch (err) {
    console.error(err);
    await discordLog("Create server error", `User: ${user.email}\nPlan: ${plan}\nError: ${err.message}`, 0xff0000);
    res.status(500).json({ success: false, message: "Failed to create checkout session" });
  }
});

// ---------------- GET USER SERVERS ----------------
app.get("/api/servers", authMiddleware, async (req, res) => {
  try {
    const servers = await Server.find({ user: req.userId }).lean();
    res.json({ success: true, servers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch servers" });
  }
});

// ---------------- BACKUP TOGGLE ----------------
app.post("/api/server/backups", authMiddleware, async (req, res) => {
  const { serverId, enable } = req.body;
  try {
    const server = await Server.findOne({ _id: serverId, user: req.userId });
    if (!server) return res.json({ success: false, message: "Server not found" });

    server.backupEnabled = enable;
    await server.save();
    return res.json({ success: true, message: `Backup ${enable ? "enabled" : "disabled"}` });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: "Error toggling backup" });
  }
});

// ---------------- CANCEL SERVER ----------------
app.post("/api/server/cancel", authMiddleware, async (req, res) => {
  const { serverId } = req.body;
  try {
    const server = await Server.findOne({ _id: serverId, user: req.userId });
    if (!server) return res.json({ success: false, message: "Server not found" });

    server.status = "canceled";
    await server.save();

    // TODO: Call Pterodactyl API to delete server if needed
    return res.json({ success: true, message: "Server canceled" });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: "Error canceling server" });
  }
});

// ---------------- UPGRADE SERVER ----------------
app.post("/api/server/upgrade", authMiddleware, async (req, res) => {
  const { serverId, newPlan } = req.body;
  try {
    const server = await Server.findOne({ _id: serverId, user: req.userId });
    if (!server) return res.json({ success: false, message: "Server not found" });

    server.plan = newPlan;
    server.type = PLANS[newPlan].type;
    await server.save();

    // TODO: Call Stripe if payment required, update Pterodactyl server
    return res.json({ success: true, message: `Server upgraded to ${newPlan}` });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, message: "Error upgrading server" });
  }
});

// ---------------- PTERODACTYL SERVER CREATION ----------------
async function createPteroServer(planKey) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error("Invalid plan key");

  const res = await axios.post(`${process.env.PTERO_URL}/api/application/servers`, {
    name: `server-${Date.now()}`,
    user: process.env.PTERO_DEFAULT_USER_ID,
    nest: plan.nest,
    egg: plan.egg,
    docker_image: plan.docker_image,
    limits: plan.limits,
    feature_limits: plan.feature_limits,
    environment: plan.environment,
    startup: "",
    allocation: { default: 1 }
  }, {
    headers: {
      Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "Application/vnd.pterodactyl.v1+json"
    }
  });

  return res.data.attributes.id;
}

// ---------------- STRIPE WEBHOOK ----------------
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); }
  catch (err) { console.error("Webhook signature failed:", err.message); return res.status(400).send(`Webhook Error: ${err.message}`); }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { userId, plan, serverId } = session.metadata;
    const user = await User.findById(userId);
    const server = await Server.findById(serverId);

    if (!server || !user) return res.json({ received: true });

    try {
      // Create Pterodactyl server
      const pteroId = await createPteroServer(plan);
      server.pteroId = pteroId;
      server.status = "active";
      await server.save();

      // Notify user
      transporter.sendMail({
        to: user.email,
        subject: "Server Created Successfully",
        text: `Your server (${plan}) is now active!`
      });

      await discordLog("Server Created", `User: ${user.email}\nServer ID: ${server._id}\nPterodactyl ID: ${pteroId}`, 0x00ff00);
      console.log(`Server ${server._id} is now active (Ptero ID: ${pteroId})`);

    } catch (err) {
      console.error("Pterodactyl creation failed:", err);
      server.status = "failed";
      await server.save();
      await discordLog("Server Creation Failed", `User: ${user.email}\nError: ${err.message}`, 0xff0000);
    }
  }

  res.json({ received: true });
});

// ---------------- START ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
