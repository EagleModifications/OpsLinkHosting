// ===============================
// Config
// ===============================
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1450633734431834252/V4i56XYG1gwfWXZXR9sshVDEZ0KfyQOmUQuG__X0pv05sOgNQu3_aJxz9qF7rIxRgSUI";

// ===============================
// Auth helpers
// ===============================
function getToken() {
  return localStorage.getItem("token");
}

// ===============================
// UI helper
// ===============================
function uiAlert(message, title = "Notice") {
  alert(`${title}: ${message}`);
}

// ===============================
// Discord logging helper
// ===============================
async function logToDiscord(message, color = 0x4e8cff) {
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: "Purchase Debug",
          description: message,
          color,
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (err) {
    console.error("Discord logging failed:", err);
  }
}

// ===============================
// Load and display servers
// ===============================
async function loadServers() {
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch("/api/servers", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    const container = document.getElementById("serversContainer");
    container.innerHTML = "";

    if (!data.success || !data.servers.length) {
      container.innerHTML = "<p style='text-align:center; color:#9aa6c7;'>You have no servers. Buy one to get started!</p>";
      return;
    }

    let pendingExists = false;

    data.servers.forEach(server => {
      const isActive = server.status === "active";
      const isPending = server.status === "pending";
      if (isPending) pendingExists = true;

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h3>${server.type} - ${server.plan}</h3>
        <p>Status: <strong>${server.status}</strong></p>
        <p>Created At: ${new Date(server.createdAt).toLocaleString()}</p>
        <p>Add-ons: ${server.addons?.join(", ") || "None"}</p>
        <p>Backups: ${server.backupEnabled ? "Enabled" : "Disabled"}</p>
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:10px;">
          <button class="btn btn-outline" ${!isActive ? "disabled" : ""} onclick="toggleBackup('${server._id}', ${!server.backupEnabled})">
            ${server.backupEnabled ? "Disable Backup" : "Enable Backup"}
          </button>
          <button class="btn btn-outline" onclick="cancelServer('${server._id}')">
            Cancel Server
          </button>
          <button class="btn btn-outline" onclick="upgradeServer('${server._id}')">
            Upgrade Server
          </button>
        </div>
        ${isPending ? "<p style='color:#ffb347; margin-top:10px;'>Server is pending creation...</p>" : ""}
      `;
      container.appendChild(card);
    });

    // Auto-refresh if any pending server exists
    if (pendingExists) setTimeout(loadServers, 5000);

  } catch (err) {
    console.error(err);
    document.getElementById("serversContainer").innerHTML = "<p style='color:red; text-align:center;'>Failed to load servers</p>";
  }
}

// ===============================
// Backup toggle
// ===============================
async function toggleBackup(serverId, enable) {
  const token = getToken();
  try {
    const res = await fetch("/api/server/backups", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, enable })
    });
    const data = await res.json();
    if (!data.success) return uiAlert(data.message);
    await logToDiscord(`Backup ${enable ? "enabled" : "disabled"} for server ${serverId}`);
    loadServers();
  } catch (err) {
    console.error(err);
    uiAlert("Failed to toggle backup");
  }
}

// ===============================
// Cancel server
// ===============================
async function cancelServer(serverId) {
  if (!confirm("Are you sure you want to cancel this server?")) return;
  const token = getToken();
  try {
    const res = await fetch("/api/server/cancel", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serverId })
    });
    const data = await res.json();
    if (!data.success) return uiAlert(data.message);
    await logToDiscord(`Server canceled: ${serverId}`);
    loadServers();
  } catch (err) {
    console.error(err);
    uiAlert("Failed to cancel server");
  }
}

// ===============================
// Upgrade server
// ===============================
async function upgradeServer(serverId) {
  const newPlan = prompt("Enter new plan name:");
  if (!newPlan) return;
  const token = getToken();
  try {
    const res = await fetch("/api/server/upgrade", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, newPlan })
    });
    const data = await res.json();
    if (!data.success) return uiAlert(data.message);
    await logToDiscord(`Server upgraded: ${serverId} → ${newPlan}`);
    loadServers();
  } catch (err) {
    console.error(err);
    uiAlert("Failed to upgrade server");
  }
}

// ===============================
// Purchase server via Stripe
// ===============================
async function purchaseServer(plan, priceId) {
  const token = getToken();
  if (!token) { uiAlert("You must be logged in", "Auth Required"); return; }
  if (!plan || !priceId) { uiAlert("Invalid plan or priceId"); return; }

  await logToDiscord(`Attempting purchase:\nPlan: ${plan}\nPrice ID: ${priceId}`);

  try {
    const res = await fetch("/api/checkout-session", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ plan, priceId })
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { success: false, message: text }; }

    if (!res.ok || !data.success) {
      uiAlert(data.message || "Purchase failed", "Error");
      await logToDiscord(`Purchase failed backend:\n${JSON.stringify(data)}`, 0xff0000);
      return;
    }

    if (data.checkoutUrl) {
      await logToDiscord(`Stripe checkout URL received:\n${data.checkoutUrl}`);
      window.location.href = data.checkoutUrl;
    } else {
      uiAlert("Purchase started. Complete payment in dashboard.", "Info");
      await logToDiscord("Purchase initiated but no checkout URL returned", 0xffa500);
    }

  } catch (err) {
    console.error(err);
    uiAlert("Error initiating purchase", "Error");
    await logToDiscord(`Error initiating purchase: ${err}`, 0xff0000);
  }
}

// ===============================
// Attach buy buttons
// ===============================
document.querySelectorAll(".buy-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const plan = btn.dataset.plan;
    const priceId = btn.dataset.priceid;
    console.log("[Purchase] Button clicked:", { plan, priceId });
    purchaseServer(plan, priceId);
  });
});

// ===============================
// Initial load
// ===============================
console.log("[Purchase] Ready. Buy buttons attached:", document.querySelectorAll(".buy-btn").length);
loadServers();
