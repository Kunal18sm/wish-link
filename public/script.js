setTimeout(() => {
  const flash = document.getElementById("flash-message");
  if (flash) {
    flash.style.display = "none";
  }
}, 5000); // 3 seconds


// profile icon 
const profileBtn = document.getElementById('profileBtn');
const profileMenu = document.getElementById('profileMenu');
const navThemeToggleBtn = document.getElementById("navThemeToggleBtn");

if (profileBtn && profileMenu) {
  const closeProfileMenu = () => {
    profileMenu.classList.add('hidden');
    profileBtn.setAttribute('aria-expanded', 'false');
  };

  // Toggle menu on click
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    profileMenu.classList.toggle('hidden');
    profileBtn.setAttribute('aria-expanded', profileMenu.classList.contains('hidden') ? 'false' : 'true');
  });

  // Close menu if clicked anywhere else on the screen
  document.addEventListener('click', () => {
    closeProfileMenu();
  });

  // Stop closing when clicking inside the menu
  profileMenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProfileMenu();
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

function updateNavbarThemeButton() {
  if (!navThemeToggleBtn) return;
  const isDark = currentTheme() === "dark";
  navThemeToggleBtn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  navThemeToggleBtn.setAttribute("title", isDark ? "Switch to light theme" : "Switch to dark theme");
  navThemeToggleBtn.innerHTML = isDark
    ? '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-amber-300" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 18a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1zm0-12a1 1 0 011-1V3a1 1 0 10-2 0v2a1 1 0 011 1zm7 5a1 1 0 100 2h2a1 1 0 100-2h-2zM3 11a1 1 0 100 2h2a1 1 0 100-2H3zm13.66 5.24a1 1 0 011.42 0l1.41 1.42a1 1 0 01-1.41 1.41l-1.42-1.41a1 1 0 010-1.42zM5.93 5.93a1 1 0 011.41 0l1.42 1.41a1 1 0 11-1.42 1.42L5.93 7.34a1 1 0 010-1.41zm12.15-1.41a1 1 0 010 1.41l-1.41 1.42a1 1 0 11-1.42-1.42l1.41-1.41a1 1 0 011.42 0zM8.76 15.24a1 1 0 010 1.42L7.34 18.07a1 1 0 01-1.41-1.41l1.41-1.42a1 1 0 011.42 0zM12 7a5 5 0 100 10 5 5 0 000-10z"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-slate-200" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.64 13a1 1 0 00-1.05-.14A8 8 0 1111.14 3.4a1 1 0 00-.14-1.05 1 1 0 00-1.06-.26A10 10 0 1019.9 14.06a1 1 0 00-.26-1.06z"/></svg>';
}

if (navThemeToggleBtn) {
  navThemeToggleBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSiteTheme();
    updateNavbarThemeButton();
  });
  document.addEventListener("themeChanged", updateNavbarThemeButton);
}

window.toggleSiteTheme = toggleSiteTheme;
window.getCurrentTheme = currentTheme;

applyTheme(currentTheme());
updateNavbarThemeButton();

