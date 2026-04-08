(() => {
  if (window.__vishlinkInstallPromptInit) return;
  window.__vishlinkInstallPromptInit = true;

  const installPromptBackdrop = document.getElementById("installPromptBackdrop");
  const installPromptModal = document.getElementById("installPromptModal");
  const installPromptText = document.getElementById("installPromptMessage");
  const installPromptInstallBtn = document.getElementById("installPromptInstallBtn");
  const installPromptLaterBtn = document.getElementById("installPromptLaterBtn");
  const installPromptCloseBtn = document.getElementById("installPromptCloseBtn");
  const firstVisitStorageKey = "vishlinkInstallPromptSeen";

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

  function getManualInstallMessage() {
    if (isIosDevice()) {
      return "Install VishLink in one click.";
    }

    return "Install VishLink in one click.";
  }

  function isFirstVisit() {
    try {
      return localStorage.getItem(firstVisitStorageKey) !== "1";
    } catch (_err) {
      return true;
    }
  }

  function markInstallPromptSeen() {
    try {
      localStorage.setItem(firstVisitStorageKey, "1");
    } catch (_err) {
      // Ignore storage access issues.
    }
  }

  function showInstallPrompt(message) {
    if (isStandaloneMode()) return;
    if (!isFirstVisit()) return;
    if (hasShownOnThisPage) return;

    if (installPromptText && message) {
      installPromptText.textContent = message;
    }

    hasShownOnThisPage = true;
    markInstallPromptSeen();
    installPromptBackdrop.classList.remove("hidden");
    installPromptModal.classList.remove("hidden");
  }

  function hideInstallPrompt() {
    installPromptBackdrop.classList.add("hidden");
    installPromptModal.classList.add("hidden");
  }

  if (installPromptCloseBtn) {
    installPromptCloseBtn.addEventListener("click", hideInstallPrompt);
  }

  if (installPromptLaterBtn) {
    installPromptLaterBtn.addEventListener("click", hideInstallPrompt);
  }

  installPromptBackdrop.addEventListener("click", hideInstallPrompt);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPromptEvent = event;
    showInstallPrompt("Install VishLink in one click.");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPromptEvent = null;
    hideInstallPrompt();
  });

  if (installPromptInstallBtn) {
    installPromptInstallBtn.addEventListener("click", async () => {
      if (deferredInstallPromptEvent) {
        deferredInstallPromptEvent.prompt();
        try {
          const result = await deferredInstallPromptEvent.userChoice;
          if (result?.outcome === "accepted") {
            hideInstallPrompt();
          }
        } catch (_err) {
          // Keep popup available for retry.
        }
        return;
      }

      showInstallPrompt(getManualInstallMessage());
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

    if (!isStandaloneMode() && isFirstVisit()) {
      setTimeout(() => {
        showInstallPrompt(getManualInstallMessage());
      }, 1200);
    }
  }

  if (document.readyState === "complete") {
    initInstallPromptLifecycle();
  } else {
    window.addEventListener("load", initInstallPromptLifecycle, { once: true });
  }
})();
