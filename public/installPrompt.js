(() => {
  if (window.__vishlinkInstallPromptInit) return;
  window.__vishlinkInstallPromptInit = true;

  const installPromptBackdrop = document.getElementById("installPromptBackdrop");
  const installPromptModal = document.getElementById("installPromptModal");
  const installPromptText = document.getElementById("installPromptMessage");
  const installPromptInstallBtn = document.getElementById("installPromptInstallBtn");
  const installPromptLaterBtn = document.getElementById("installPromptLaterBtn");
  const installPromptCloseBtn = document.getElementById("installPromptCloseBtn");
  const sessionDismissKey = "vishlinkInstallPromptSessionDismissed";

  // Cleanup old permanent localStorage keys to prevent old test blocks
  try {
    localStorage.removeItem("vishlinkInstallPromptSeen");
    localStorage.removeItem("vishlinkInstallPromptDismissedAt");
  } catch (_e) {}

  if (!installPromptBackdrop || !installPromptModal) return;

  let deferredInstallPromptEvent = null;
  let hasShownOnThisPage = false;

  function isStandaloneMode() {
    try {
      const hasMatchMedia = typeof window.matchMedia === "function";
      const standaloneByDisplayMode = hasMatchMedia
        ? window.matchMedia("(display-mode: standalone)").matches
        : false;
      const isIosStandalone = window.navigator.standalone === true;
      const isTwa = Boolean(document.referrer && document.referrer.startsWith("android-app://"));
      return standaloneByDisplayMode || isIosStandalone || isTwa;
    } catch (_err) {
      return false;
    }
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");
  }

  function isSessionDismissed() {
    try {
      return sessionStorage.getItem(sessionDismissKey) === "1";
    } catch (_err) {
      return false;
    }
  }

  function markSessionDismissed() {
    try {
      sessionStorage.setItem(sessionDismissKey, "1");
    } catch (_err) {}
  }

  function showInstallPrompt(message, force = false) {
    // DO NOT SHOW if app is already installed / running in standalone mode
    if (isStandaloneMode()) return;

    // Do not auto-show if user dismissed it in this tab session, unless forced by browser beforeinstallprompt
    if (!force && isSessionDismissed()) return;

    if (hasShownOnThisPage && !force) return;

    if (installPromptText && message) {
      installPromptText.textContent = message;
    }

    hasShownOnThisPage = true;
    installPromptBackdrop.classList.remove("hidden");
    installPromptModal.classList.remove("hidden");
    installPromptModal.style.display = "block";
    installPromptBackdrop.style.display = "block";
  }

  function hideInstallPrompt(userDismissed = false) {
    if (userDismissed) {
      markSessionDismissed();
    }
    installPromptBackdrop.classList.add("hidden");
    installPromptModal.classList.add("hidden");
    installPromptModal.style.display = "none";
    installPromptBackdrop.style.display = "none";
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
    // Show modal when browser fires beforeinstallprompt
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
          // Keep modal available for retry.
        }
        return;
      }

      if (isIosDevice()) {
        alert("To install VishLink on iPhone/iPad: tap the Share button in Safari and select 'Add to Home Screen'.");
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
        .catch(() => {});
    }

    if (!isStandaloneMode() && !isSessionDismissed()) {
      setTimeout(() => {
        showInstallPrompt("Install VishLink in one click.");
      }, 600);
    }
  }

  if (document.readyState === "complete") {
    initInstallPromptLifecycle();
  } else {
    window.addEventListener("load", initInstallPromptLifecycle, { once: true });
  }
})();

