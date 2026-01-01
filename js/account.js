// ===============================
// Account Page JS
// ===============================

// ===============================
// Auth helpers
// ===============================
const token = localStorage.getItem("token");
if (!token) window.location.href = "/auth-login.html";

// ===============================
// Discord logging helper
// ===============================
async function logDiscord(message, color = 0x4e8cff) {
  try {
    await fetch("/api/discord-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, color }),
    });
  } catch (err) {
    console.error("Discord logging failed:", err);
  }
}

// ===============================
// UI helper
// ===============================
function uiAlert(message, title = "Notice") {
  alert(`${title}: ${message}`);
}

// ===============================
// User dropdown & logout
// ===============================
const userIcon = document.getElementById("userIcon");
const userDropdown = document.getElementById("userDropdown");

if (userIcon) {
  userIcon.addEventListener("click", () => {
    userDropdown.style.display = userDropdown.style.display === "block" ? "none" : "block";
  });
}

window.onclick = e => {
  if (!e.target.matches("#userIcon")) userDropdown.style.display = "none";
};

document.getElementById("logoutBtn").addEventListener("click", async () => {
  localStorage.removeItem("token");
  await logDiscord("User logged out");
  window.location.href = "/auth-login.html";
});

// ===============================
// Server functions
// ===============================
async function loadServers() {
  try {
    const res = await fetch("/api/servers", {
      headers: { Authorization: `Bearer ${token}` },
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
      const isFailed = server.status === "failed";
      const isCanceled = server.status === "canceled";

      if (isPending) pendingExists = true;

      const statusClass = isActive ? "status-active" :
                          isPending ? "status-pending" :
                          isFailed ? "status-failed" :
                          isCanceled ? "status-canceled" : "";

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h3>${server.type || "Server"} - ${server.plan}</h3>
        <p>Status: <span class="status-badge ${statusClass}">${server.status.toUpperCase()}</span></p>
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
        ${isPending ? "<p style='color:#ffb347; margin-top:10px;'>Server is pending creation... refreshing...</p>" : ""}
      `;
      container.appendChild(card);
    });

    // Auto-refresh pending servers every 5s
    if (pendingExists) setTimeout(loadServers, 5000);

  } catch (err) {
    console.error(err);
    document.getElementById("serversContainer").innerHTML = "<p style='color:red; text-align:center;'>Failed to load servers</p>";
  }
}

// Toggle backup
async function toggleBackup(serverId, enable) {
  try {
    const res = await fetch("/api/server/backups", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, enable }),
    });
    const data = await res.json();
    if (!data.success) return uiAlert(data.message || "Failed to toggle backup");
    await logDiscord(`Backup ${enable ? "enabled" : "disabled"} for server ${serverId}`);
    loadServers();
  } catch (err) {
    console.error(err);
    uiAlert("Failed to toggle backup");
  }
}

// Cancel server
async function cancelServer(serverId) {
  if (!confirm("Are you sure you want to cancel this server?")) return;

  try {
    const res = await fetch("/api/server/cancel", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serverId }),
    });
    const data = await res.json();
    if (!data.success) return uiAlert(data.message || "Failed to cancel server");
    await logDiscord(`Server canceled: ${serverId}`);
    loadServers();
  } catch (err) {
    console.error(err);
    uiAlert("Failed to cancel server");
  }
}

// Upgrade server
async function upgradeServer(serverId) {
  const newPlan = prompt("Enter new plan name:");
  const newPriceId = prompt("Enter Stripe Price ID:");
  if (!newPlan || !newPriceId) return;

  try {
    const res = await fetch("/api/server/upgrade", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, newPlan, newPriceId }),
    });
    const data = await res.json();
    if (!data.success) return uiAlert(data.message || "Failed to upgrade server");
    await logDiscord(`Server upgraded: ${serverId} to ${newPlan}`);
    loadServers();
  } catch (err) {
    console.error(err);
    uiAlert("Failed to upgrade server");
  }
}

// ===============================
// Initial load
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  loadServers();
  console.log("[Account] Loaded account.js and initialized server display.");
});
