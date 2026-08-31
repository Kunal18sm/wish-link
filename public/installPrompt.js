(() => {
  if (window.__vishlinkInstallPromptInit) return;
  window.__vishlinkInstallPromptInit = true;

  const installPromptBackdrop = document.getElementById("installPromptBackdrop");
  const installPromptModal = document.getElementById("installPromptModal");
  const installPromptText = document.getElementById("installPromptMessage");
  const installPromptInstallBtn = document.getElementById("installPromptInstallBtn");
  const installPromptLaterBtn = document.getElementById("installPromptLaterBtn");
  const installPromptCloseBtn = document.getElementById("installPromptCloseBtn");
  const dismissStorageKey = "vishlinkInstallPromptDismissedAt";

  if (!installPromptBackdrop || !installPromptModal) return;

  let deferredInstallPromptEvent = null;
  let hasShownOnThisPage = false;

  function isStandaloneMode() {
    try {
      const hasMatchMedia = typeof window.matchMedia === "function";
      const standaloneByDisplayMode = hasMatchMedia
        ? window.matchMedia("(display-mode: standalone)").matches
        : false;
      return standaloneByDisplayMode || window.navigator.standalone === true;
    } catch (_err) {
      return false;
    }
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
  }

  function isRecentlyDismissed() {
    try {
      const dismissedAt = Number(localStorage.getItem(dismissStorageKey) || 0);
      if (!dismissedAt) return false;
      // Don't auto-popup if dismissed within last 24 hours
      return Date.now() - dismissedAt < 24 * 60 * 60 * 1000;
    } catch (_err) {
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(dismissStorageKey, String(Date.now()));
    } catch (_err) {
      // Ignore storage errors
    }
  }

  function showInstallPrompt(message, force = false) {
    if (isStandaloneMode()) return;
    if (!force && isRecentlyDismissed()) return;
    if (hasShownOnThisPage) return;

    if (installPromptText && message) {
      installPromptText.textContent = message;
    }

    hasShownOnThisPage = true;
    installPromptBackdrop.classList.remove("hidden");
    installPromptModal.classList.remove("hidden");
  }

  function hideInstallPrompt(userDismissed = false) {
    if (userDismissed) {
      markDismissed();
    }
    installPromptBackdrop.classList.add("hidden");
    installPromptModal.classList.add("hidden");
  }

  if (installPromptCloseBtn) {
    installPromptCloseBtn.addEventListener("click", () => hideInstallPrompt(true));
  }

  if (installPromptLaterBtn) {
    installPromptLaterBtn.addEventListener("click", () => hideInstallPrompt(true));
  }

  installPromptBackdrop.addEventListener("click", () => hideInstallPrompt(true));

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPromptEvent = event;
    // Show prompt when browser fires beforeinstallprompt
    showInstallPrompt("Install VishLink in one click.", true);
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPromptEvent = null;
    hideInstallPrompt(false);
  });

  if (installPromptInstallBtn) {
    installPromptInstallBtn.addEventListener("click", async () => {
      if (deferredInstallPromptEvent) {
        deferredInstallPromptEvent.prompt();
        try {
          const result = await deferredInstallPromptEvent.userChoice;
          if (result?.outcome === "accepted") {
            hideInstallPrompt(false);
          }
        } catch (_err) {
          // Keep popup available for retry.
        }
        return;
      }

      if (isIosDevice()) {
        alert("To install on iOS: tap the Share button in Safari and select 'Add to Home Screen'.");
      } else {
        alert("To install VishLink: tap your browser menu (3 dots) and select 'Install app' or 'Add to Home Screen'.");
      }
    });
  }

  function initInstallPromptLifecycle() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service-worker.js?v=11", {
          scope: "/",
          updateViaCache: "none",
        })
        .then((registration) => registration.update())
        .catch(() => {
          // Ignore SW registration failures.
        });
    }

    if (!isStandaloneMode() && !isRecentlyDismissed()) {
      setTimeout(() => {
        showInstallPrompt("Install VishLink in one click.");
      }, 1200);
    }
  }

  if (document.readyState === "complete") {
    initInstallPromptLifecycle();
  } else {
    window.addEventListener("load", initInstallPromptLifecycle, { once: true });
  }
})();

