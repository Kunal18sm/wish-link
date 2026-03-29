setTimeout(() => {
  const flash = document.getElementById("flash-message");
  if (flash) {
    flash.style.display = "none";
  }
}, 5000);

const profileBtn = document.getElementById("profileBtn");
const profileMenu = document.getElementById("profileMenu");
const navThemeToggleBtn = document.getElementById("navThemeToggleBtn");

if (profileBtn && profileMenu) {
  const closeProfileMenu = () => {
    profileMenu.classList.add("hidden");
    profileBtn.setAttribute("aria-expanded", "false");
  };

  profileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    profileMenu.classList.toggle("hidden");
    profileBtn.setAttribute("aria-expanded", profileMenu.classList.contains("hidden") ? "false" : "true");
  });

  document.addEventListener("click", () => {
    closeProfileMenu();
  });

  profileMenu.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProfileMenu();
  });
}

const THEME_KEY = "vishlink-theme";
const LIGHT_PALETTE_KEY = "vishlink-light-palette";
const LIGHT_PALETTES = new Set(["blue", "pink"]);

function normalizeLightPalette(rawPalette) {
  const palette = String(rawPalette || "").trim().toLowerCase();
  return LIGHT_PALETTES.has(palette) ? palette : null;
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch (_err) {
    return null;
  }
}

function readServerDefaultLightPalette() {
  const attrDefault = normalizeLightPalette(document.documentElement.getAttribute("data-default-light-palette"));
  if (attrDefault) return attrDefault;
  const globalDefault = normalizeLightPalette(window.__VISHLINK_DEFAULT_LIGHT_PALETTE);
  if (globalDefault) return globalDefault;
  return "blue";
}

function readStoredLightPalette() {
  try {
    return normalizeLightPalette(localStorage.getItem(LIGHT_PALETTE_KEY));
  } catch (_err) {
    return null;
  }
}

function currentTheme() {
  const htmlTheme = document.documentElement.getAttribute("data-theme");
  if (htmlTheme === "light" || htmlTheme === "dark") {
    return htmlTheme;
  }
  return readStoredTheme() || "dark";
}

function currentLightPalette() {
  const htmlPalette = normalizeLightPalette(document.documentElement.getAttribute("data-light-palette"));
  if (htmlPalette) {
    return htmlPalette;
  }
  return readStoredLightPalette() || readServerDefaultLightPalette();
}

function getAvatarBackgroundColor(theme, palette) {
  if (theme !== "light") return "1e293b";
  return palette === "pink" ? "fbcfe8" : "bfdbfe";
}

function syncInitialAvatarTheme(theme, palette) {
  const avatarBg = getAvatarBackgroundColor(theme, palette);
  const avatars = document.querySelectorAll("img[src*='api.dicebear.com/7.x/initials/svg']");

  avatars.forEach((img) => {
    try {
      const url = new URL(img.src, window.location.origin);
      url.searchParams.set("backgroundColor", avatarBg);
      img.src = url.toString();
    } catch (_err) {
      // Keep existing src if URL parsing fails.
    }
  });
}

function dispatchThemeChanged(theme, palette) {
  try {
    document.dispatchEvent(
      new CustomEvent("themeChanged", {
        detail: {
          theme,
          lightPalette: palette,
        },
      })
    );
  } catch (_err) {
    document.dispatchEvent(new Event("themeChanged"));
  }
}

function applyLightPalette(palette, options = {}) {
  const nextPalette = normalizeLightPalette(palette) || readServerDefaultLightPalette();
  const shouldPersist = options.persist !== false;
  const shouldEmit = options.emitEvent !== false;

  document.documentElement.setAttribute("data-light-palette", nextPalette);

  if (shouldPersist) {
    try {
      localStorage.setItem(LIGHT_PALETTE_KEY, nextPalette);
    } catch (_err) {
      // Ignore storage errors.
    }
  }

  const activeTheme = currentTheme();
  syncInitialAvatarTheme(activeTheme, nextPalette);

  if (shouldEmit) {
    dispatchThemeChanged(activeTheme, nextPalette);
  }

  return nextPalette;
}

function applyTheme(theme, options = {}) {
  const nextTheme = theme === "light" ? "light" : "dark";
  const shouldPersist = options.persist !== false;
  const shouldEmit = options.emitEvent !== false;
  const nextPalette = currentLightPalette();

  document.documentElement.setAttribute("data-theme", nextTheme);
  document.documentElement.setAttribute("data-light-palette", nextPalette);
  syncInitialAvatarTheme(nextTheme, nextPalette);

  if (shouldPersist) {
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
    } catch (_err) {
      // Ignore storage errors.
    }
  }

  if (shouldEmit) {
    dispatchThemeChanged(nextTheme, nextPalette);
  }

  return nextTheme;
}

function toggleSiteTheme() {
  const nextTheme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  return nextTheme;
}

function updateNavbarThemeButton() {
  if (!navThemeToggleBtn) return;

  const isDark = currentTheme() === "dark";
  navThemeToggleBtn.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  navThemeToggleBtn.setAttribute("title", isDark ? "Switch to light theme" : "Switch to dark theme");

  if (isDark) {
    navThemeToggleBtn.style.backgroundColor = "";
    navThemeToggleBtn.style.borderColor = "";
  } else {
    const rootStyles = getComputedStyle(document.documentElement);
    const toggleBg = rootStyles.getPropertyValue("--theme-toggle-bg").trim() || "rgba(255, 255, 255, 0.95)";
    const toggleBorder =
      rootStyles.getPropertyValue("--theme-toggle-border").trim() || "rgba(59, 130, 246, 0.42)";
    navThemeToggleBtn.style.backgroundColor = toggleBg;
    navThemeToggleBtn.style.borderColor = toggleBorder;
  }

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

window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY) {
    applyTheme(readStoredTheme() || "dark", { persist: false, emitEvent: true });
    updateNavbarThemeButton();
    return;
  }

  if (event.key === LIGHT_PALETTE_KEY) {
    applyLightPalette(readStoredLightPalette() || readServerDefaultLightPalette(), {
      persist: false,
      emitEvent: true,
    });
    updateNavbarThemeButton();
  }
});

window.toggleSiteTheme = toggleSiteTheme;
window.getCurrentTheme = currentTheme;
window.setLightPalette = (palette, options = {}) => {
  const appliedPalette = applyLightPalette(palette, options);
  updateNavbarThemeButton();
  return appliedPalette;
};
window.getCurrentLightPalette = currentLightPalette;

applyLightPalette(currentLightPalette(), { persist: false, emitEvent: false });
applyTheme(currentTheme(), { persist: false, emitEvent: false });
updateNavbarThemeButton();
