// Dismiss development notice
const notice = document.getElementById("notice");
const closeBtn = document.getElementById("closeNotice");
if (closeBtn) closeBtn.addEventListener("click", () => { notice.style.display = "none"; });

// User menu dropdown
const userIcon = document.getElementById("userIcon");
const userDropdown = document.getElementById("userDropdown");
if (userIcon) {
  userIcon.addEventListener("click", () => { userDropdown.classList.toggle("show"); });
}

// Close dropdown clicking outside
window.onclick = function (event) {
  if (!event.target.matches('#userIcon')) {
    if (userDropdown && userDropdown.classList.contains('show')) userDropdown.classList.remove('show');
  }
};

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});
