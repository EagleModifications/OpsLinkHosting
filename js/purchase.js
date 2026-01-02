// ===============================
// Config
// ===============================
const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1450633734431834252/V4i56XYG1gwfWXZXR9sshVDEZ0KfyQOmUQuG__X0pv05sOgNQu3_aJxz9qF7rIxRgSUI";

// ===============================
// Auth helpers
// ===============================
const getToken = () => localStorage.getItem("token");

// ===============================
// UI helpers
// ===============================
function uiAlert(message, title = "Notice") {
  alert(`${title}: ${message}`);
}

// ===============================
// Discord logging (safe)
// ===============================
async function logToDiscord(message, color = 0x4e8cff) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: "Purchase Debug",
            description: message,
            color,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (err) {
    console.warn("Discord logging failed (ignored):", err.message);
  }
}

// ===============================
// Load and display servers
// ===============================
async function loadServers() {
  const container = document.getElementById("serversContainer");
  if (!container) return; // <-- safely exit if container doesn't exist

  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch("/api/servers", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    container.innerHTML = "";

    if (!data.success || !Array.isArray(data.servers) || data.servers.length === 0) {
      container.innerHTML =
        "<p style='text-align:center; color:#9aa6c7;'>You have no servers. Buy one to get started!</p>";
      return;
    }

    let pendingExists = false;

    for (const server of data.servers) {
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
          <button class="btn btn-outline"
            ${!isActive ? "disabled" : ""}
            data-action="backup"
            data-id="${server._id}"
            data-enable="${!server.backupEnabled}">
            ${server.backupEnabled ? "Disable Backup" : "Enable Backup"}
          </button>

          <button class="btn btn-outline"
            data-action="cancel"
            data-id="${server._id}">
            Cancel Server
          </button>

          <button class="btn btn-outline"
            data-action="upgrade"
            data-id="${server._id}">
            Upgrade Server
          </button>
        </div>

        ${isPending ? "<p style='color:#ffb347; margin-top:10px;'>Server is pending creation...</p>" : ""}
      `;

      container.appendChild(card);
    }

    if (pendingExists) setTimeout(loadServers, 5000);
  } catch (err) {
    console.error(err);
    container.innerHTML =
      "<p style='color:red; text-align:center;'>Failed to load servers</p>";
  }
}

// ===============================
// Server actions
// ===============================
async function serverAction(endpoint, payload, logMessage) {
  const token = getToken();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!data.success) {
      uiAlert(data.message || "Action failed");
      return;
    }

    await logToDiscord(`${logMessage}\nServer ID: ${payload.serverId}`);
    loadServers();
  } catch (err) {
    console.error(err);
    uiAlert("Server action failed");
  }
}

const toggleBackup = (serverId, enable) =>
  serverAction("/api/server/backups", { serverId, enable }, `Backup ${enable ? "enabled" : "disabled"}`);

const cancelServer = (serverId) => {
  if (!confirm("Are you sure you want to cancel this server?")) return;
  return serverAction("/api/server/cancel", { serverId }, "Server canceled");
};

const upgradeServer = (serverId) => {
  const newPlan = prompt("Enter new plan name:");
  if (!newPlan) return;
  return serverAction("/api/server/upgrade", { serverId, newPlan }, `Server upgraded → ${newPlan}`);
};

// ===============================
// Purchase server via Stripe
// ===============================
async function purchaseServer(plan) {
  const token = getToken();
  if (!token) {
    uiAlert("You must be logged in", "Auth Required");
    return;
  }

  if (!plan) {
    uiAlert("Invalid plan");
    return;
  }

  await logToDiscord(`Starting purchase\nPlan: ${plan}`);

  try {
    const res = await fetch("/api/checkout-session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plan }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.success) {
      uiAlert(data.message || "Purchase failed", "Error");
      await logToDiscord(`Purchase failed\n${JSON.stringify(data)}`, 0xff0000);
      return;
    }

    if (data.checkoutUrl) {
      await logToDiscord(`Redirecting to Stripe Checkout`);
      window.location.href = data.checkoutUrl;
    } else {
      uiAlert("Checkout session created. Please continue in Stripe.");
    }
  } catch (err) {
    console.error(err);
    uiAlert("Error initiating purchase", "Error");
    await logToDiscord(`Purchase error: ${err.message}`, 0xff0000);
  }
}

// ===============================
// Event delegation
// ===============================
document.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "backup") toggleBackup(id, btn.dataset.enable === "true");
  else if (action === "cancel") cancelServer(id);
  else if (action === "upgrade") upgradeServer(id);
  else if (btn.classList.contains("buy-btn")) purchaseServer(btn.dataset.plan);
});

// ===============================
// Init
// ===============================
console.log("[Purchase] Ready");
loadServers();
