setTimeout(() => {
  const flash = document.getElementById("flash-message");
  if (flash) {
    flash.style.display = "none";
  }
}, 5000); // 3 seconds


// profile icon 
const profileBtn = document.getElementById('profileBtn');
const profileMenu = document.getElementById('profileMenu');

if (profileBtn && profileMenu) {
  // Toggle menu on click
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    profileMenu.classList.toggle('hidden');
  });

  // Close menu if clicked anywhere else on the screen
  document.addEventListener('click', () => {
    profileMenu.classList.add('hidden');
  });

  // Stop closing when clicking inside the menu
  profileMenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

const THEME_KEY = "vishlink-theme";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch (_err) {
    return null;
  }
}

function currentTheme() {
  const htmlTheme = document.documentElement.getAttribute("data-theme");
  if (htmlTheme === "light" || htmlTheme === "dark") {
    return htmlTheme;
  }
  return readStoredTheme() || "light";
}

function syncInitialAvatarTheme(theme) {
  const avatarBg = theme === "light" ? "fbcfe8" : "1e293b";
  const avatars = document.querySelectorAll("img[src*='api.dicebear.com/7.x/initials/svg']");

  avatars.forEach((img) => {
    try {
      const url = new URL(img.src, window.location.origin);
      url.searchParams.set("backgroundColor", avatarBg);
      img.src = url.toString();
    } catch (_err) {
      // Ignore malformed URLs and keep existing src
    }
  });
}

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", nextTheme);
  syncInitialAvatarTheme(nextTheme);

  try {
    localStorage.setItem(THEME_KEY, nextTheme);
  } catch (_err) {
    // Ignore storage errors (private mode, blocked storage, etc.)
  }

  document.dispatchEvent(new CustomEvent("themeChanged", { detail: { theme: nextTheme } }));
}

function toggleSiteTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

window.toggleSiteTheme = toggleSiteTheme;
window.getCurrentTheme = currentTheme;

applyTheme(currentTheme());


function copyText() {
  const text = document.getElementById("wishLink").innerText;

  navigator.clipboard.writeText(text)
    .then(() => {
      alert("Text copied ✨");
    })
    .catch(() => {
      alert("Failed to copy");
    });
}
