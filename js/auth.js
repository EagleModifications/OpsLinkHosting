// Helper functions
function setToken(token) { localStorage.setItem("token", token); }
function getToken() { return localStorage.getItem("token"); }

async function logDiscord(message) {
  try {
    await fetch("/api/discord-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch (err) {
    console.error("Discord logging failed", err);
  }
}

// Login
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginForm.email.value;
    const password = loginForm.password.value;

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.success) {
        setToken(data.token);
        uiAlert("Login successful!", "Success");
        await logDiscord(`User logged in: ${email}`);
        window.location.href = "/account.html";
      } else {
        uiAlert(data.message, "Login Failed");
      }
    } catch (err) {
      console.error(err);
      uiAlert("Login failed.", "Error");
    }
  });
}

// Register
const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = registerForm.email.value;
    const password = registerForm.password.value;
    const confirmPassword = registerForm.confirmPassword.value;

    if (password !== confirmPassword) {
      uiAlert("Passwords do not match.", "Validation Error");
      return;
    }

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.success) {
        uiAlert("Account created! Please log in.", "Success");
        await logDiscord(`User registered: ${email}`);
        window.location.href = "/auth-login.html";
      } else {
        uiAlert(data.message, "Registration Failed");
      }
    } catch (err) {
      console.error(err);
      uiAlert("Registration failed.", "Error");
    }
  });
}
