(() => {
  if (window.__vishlinkHomeCollectionInit) return;
  window.__vishlinkHomeCollectionInit = true;

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const smoothScrollBehavior = prefersReducedMotion ? "auto" : "smooth";

  function bindThemeToggle(buttonId) {
    const toggleBtn = document.getElementById(buttonId);
    if (!toggleBtn) return;

    const refreshText = () => {
      const theme = document.documentElement.getAttribute("data-theme") || "light";
      toggleBtn.textContent = theme === "dark" ? "Switch to Light Theme" : "Switch to Dark Theme";
    };

    toggleBtn.addEventListener("click", () => {
      if (typeof window.toggleSiteTheme === "function") {
        window.toggleSiteTheme();
      } else {
        const current = document.documentElement.getAttribute("data-theme") || "light";
        document.documentElement.setAttribute("data-theme", current === "dark" ? "light" : "dark");
      }
      refreshText();
    });

    document.addEventListener("themeChanged", refreshText);
    refreshText();
  }

  function initBannerSlider() {
    const sliderEl = document.getElementById("banner-slider");
    const dotEls = Array.from(document.querySelectorAll(".banner-dot[data-slide-index]"));
    if (!sliderEl || !dotEls.length) return;

    const totalSlides = Math.max(sliderEl.children.length, dotEls.length);
    let activeSlide = 0;
    let autoSlideTimer = null;

    const updateDots = () => {
      dotEls.forEach((dotEl, index) => {
        dotEl.setAttribute("aria-current", index === activeSlide ? "true" : "false");
      });
    };

    const moveSlide = (index) => {
      const boundedIndex = Math.max(0, Math.min(index, totalSlides - 1));
      activeSlide = boundedIndex;
      sliderEl.style.transform = `translateX(-${boundedIndex * 100}%)`;
      updateDots();
    };

    const stopAutoSlide = () => {
      if (!autoSlideTimer) return;
      window.clearInterval(autoSlideTimer);
      autoSlideTimer = null;
    };

    dotEls.forEach((dotEl) => {
      dotEl.addEventListener("click", () => {
        const requestedIndex = Number.parseInt(dotEl.dataset.slideIndex || "0", 10);
        moveSlide(Number.isFinite(requestedIndex) ? requestedIndex : 0);
        stopAutoSlide();
      });
    });

    moveSlide(0);

    if (totalSlides > 1) {
      autoSlideTimer = window.setInterval(() => {
        moveSlide((activeSlide + 1) % totalSlides);
      }, 5000);
    }
  }

  function initTemplateScroller() {
    const scroller = document.getElementById("templateScroller");
    if (!scroller) return;

    let scrollStep = Math.max(Math.round(scroller.clientWidth * 0.9), 280);
    const updateScrollStep = () => {
      scrollStep = Math.max(Math.round(scroller.clientWidth * 0.9), 280);
    };

    scroller.addEventListener(
      "wheel",
      (evt) => {
        if (Math.abs(evt.deltaY) <= Math.abs(evt.deltaX)) return;
        evt.preventDefault();
        scroller.scrollBy({ left: evt.deltaY, behavior: "auto" });
      },
      { passive: false }
    );

    const nextBtn = document.getElementById("nextBtn");
    const prevBtn = document.getElementById("prevBtn");

    if (nextBtn) {
      nextBtn.addEventListener("click", () => {
        scroller.scrollBy({ left: scrollStep, behavior: smoothScrollBehavior });
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", () => {
        scroller.scrollBy({ left: -scrollStep, behavior: smoothScrollBehavior });
      });
    }

    window.addEventListener("resize", updateScrollStep, { passive: true });
  }

  function initFeedbackForm() {
    const form = document.getElementById("feedbackform");
    const button = document.getElementById("sendfeedback");
    if (!form || !button) return;

    form.addEventListener("submit", () => {
      button.disabled = true;
      button.innerText = "Please wait...";
    });
  }

  function initPurchaseLinks() {
    const purchaseLinks = document.querySelectorAll(".submitBtnLink");
    if (!purchaseLinks.length) return;

    purchaseLinks.forEach((link) => {
      link.addEventListener("click", function () {
        if (this.dataset.loading === "true") return;
        this.dataset.loading = "true";
        this.innerHTML =
          '<span class="flex items-center gap-2"><svg class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Please wait...</span>';
        this.classList.add("opacity-75", "pointer-events-none");
      });
    });
  }

  function initPreviewCreditModal() {
    const previewLinks = Array.from(document.querySelectorAll(".templatePreviewTrigger[data-template-id]"));
    const backdrop = document.getElementById("templatePreviewCreditBackdrop");
    const modal = document.getElementById("templatePreviewCreditModal");
    const messageEl = document.getElementById("templatePreviewCreditMessage");
    const balanceEl = document.getElementById("templatePreviewCreditBalance");
    const errorEl = document.getElementById("templatePreviewCreditError");
    const cancelBtn = document.getElementById("templatePreviewCancelBtn");
    const useBtn = document.getElementById("templatePreviewUseBtn");
    const loginBtn = document.getElementById("templatePreviewLoginBtn");

    if (!previewLinks.length || !backdrop || !modal || !messageEl || !cancelBtn || !useBtn || !loginBtn) {
      return;
    }

    const isLoggedIn = modal.dataset.isLoggedIn === "true";
    let currentCredits = Number.parseInt(modal.dataset.currentCredits || "0", 10);
    if (!Number.isFinite(currentCredits)) currentCredits = 0;

    let activeTemplateId = "";
    let activeRequiredCredits = 0;
    let isSubmitting = false;
    const formatCredits = (value) => `${value} credit${value === 1 ? "" : "s"}`;

    const setError = (message) => {
      if (!errorEl) return;
      const normalized = String(message || "").trim();
      if (!normalized) {
        errorEl.classList.add("hidden");
        errorEl.textContent = "";
        return;
      }

      errorEl.textContent = normalized;
      errorEl.classList.remove("hidden");
    };

    const updateTexts = () => {
      messageEl.textContent = `To preview this template, you need ${formatCredits(activeRequiredCredits)}.`;
      if (isLoggedIn) {
        balanceEl.textContent = `Your current credits: ${currentCredits}`;
      } else {
        balanceEl.textContent = "Login is required to use preview credits.";
      }
    };

    const hideModal = () => {
      backdrop.classList.add("hidden");
      modal.classList.add("hidden");
      setError("");
      activeTemplateId = "";
      activeRequiredCredits = 0;
    };

    const openModal = (templateId, requiredCredits) => {
      activeTemplateId = String(templateId || "");
      activeRequiredCredits = Math.max(0, Number(requiredCredits) || 0);
      setError("");
      updateTexts();

      if (isLoggedIn) {
        useBtn.classList.remove("hidden");
        loginBtn.classList.add("hidden");
      } else {
        useBtn.classList.add("hidden");
        loginBtn.classList.remove("hidden");
      }

      backdrop.classList.remove("hidden");
      modal.classList.remove("hidden");
    };

    previewLinks.forEach((linkEl) => {
      linkEl.addEventListener("click", (event) => {
        event.preventDefault();
        const templateId = linkEl.dataset.templateId || "";
        const requiredCredits = Number.parseInt(linkEl.dataset.previewCredits || "0", 10);
        openModal(templateId, Number.isFinite(requiredCredits) ? requiredCredits : 0);
      });
    });

    cancelBtn.addEventListener("click", hideModal);
    backdrop.addEventListener("click", hideModal);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideModal();
    });

    useBtn.addEventListener("click", async () => {
      if (isSubmitting || !activeTemplateId) return;
      if (!isLoggedIn) {
        window.location.href = "/logInForm";
        return;
      }

      isSubmitting = true;
      const originalLabel = useBtn.textContent;
      useBtn.disabled = true;
      useBtn.textContent = "Please wait...";

      try {
        const response = await fetch(`/web/template/${encodeURIComponent(activeTemplateId)}/preview/unlock`, {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        });

        let payload = null;
        try {
          payload = await response.json();
        } catch (_parseError) {
          payload = null;
        }

        if (!response.ok || !payload?.ok) {
          if (Number.isFinite(Number(payload?.currentCredits))) {
            currentCredits = Number(payload.currentCredits);
          }
          updateTexts();
          setError(payload?.message || "Unable to unlock preview right now.");
          return;
        }

        if (Number.isFinite(Number(payload?.remainingCredits))) {
          currentCredits = Number(payload.remainingCredits);
        }

        hideModal();
        if (payload.redirectUrl) {
          window.location.href = String(payload.redirectUrl);
        }
      } catch (_err) {
        setError("Network issue. Please try again.");
      } finally {
        isSubmitting = false;
        useBtn.disabled = false;
        useBtn.textContent = originalLabel;
      }
    });
  }

  bindThemeToggle("homeThemeToggleBtn");
  bindThemeToggle("collectionThemeToggleBtn");
  initBannerSlider();
  initTemplateScroller();
  initFeedbackForm();
  initPurchaseLinks();
  initPreviewCreditModal();
})();
