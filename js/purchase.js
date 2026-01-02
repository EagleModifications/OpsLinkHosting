const DISCORD_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1450633734431834252/V4i56XYG1gwfWXZXR9sshVDEZ0KfyQOmUQuG__X0pv05sOgNQu3_aJxz9qF7rIxRgSUI";

// Auth helper
const getToken = () => localStorage.getItem("token");

// UI helper
function uiAlert(message, title = "Notice") { alert(`${title}: ${message}`); }

// Discord logging
async function logToDiscord(message, color = 0x4e8cff) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [{ title: "Purchase Debug", description: message, color, timestamp: new Date().toISOString() }] }),
    });
  } catch (err) {
    console.warn("Discord logging failed:", err.message);
  }
}

// Purchase server
async function purchaseServer(plan, email) {
  if (!plan) return uiAlert("Invalid plan");
  if (!email) return uiAlert("Please enter your email");

  try {
    const token = getToken();
    const res = await fetch("/api/checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ plan, email })
    });
    const data = await res.json();
    if (!data.success) return uiAlert(data.message || "Purchase failed");

    window.location.href = data.checkoutUrl;
  } catch (err) {
    console.error(err);
    uiAlert("Error initiating purchase", "Error");
  }
}

// Event delegation for buy buttons
document.addEventListener("click", e => {
  const btn = e.target.closest(".buy-btn");
  if (!btn) return;

  purchaseServer(btn.dataset.plan, btn.dataset.email);
});
