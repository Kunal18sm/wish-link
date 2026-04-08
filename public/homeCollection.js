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
    const carouselEls = Array.from(document.querySelectorAll("[data-banner-carousel]"));
    if (!carouselEls.length) return;

    carouselEls.forEach((carouselEl) => {
      const sliderEl = carouselEl.querySelector("[data-banner-slider]");
      if (!sliderEl) return;

      const dotEls = Array.from(
        carouselEl.querySelectorAll(".banner-dot[data-slide-index]")
      );
      const totalSlides = sliderEl.children.length;
      if (totalSlides <= 0) return;

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

      // Keep first render stable across reloads before autoplay kicks in.
      sliderEl.style.transform = "translateX(0%)";
      updateDots();

      if (totalSlides > 1) {
        autoSlideTimer = window.setInterval(() => {
          moveSlide((activeSlide + 1) % totalSlides);
        }, 5000);
      }
    });
  }

  function initTemplateScroller() {
    const scroller = document.getElementById("templateScroller");
    if (!scroller) return;

    let scrollStep = 320;
    let resizeRaf = null;
    const updateScrollStep = () => {
      scrollStep = Math.max(Math.round(scroller.clientWidth * 0.9), 280);
    };
    window.requestAnimationFrame(updateScrollStep);

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

    window.addEventListener("resize", () => {
      if (resizeRaf) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        updateScrollStep();
      });
    }, { passive: true });
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

  function initTopTemplateTapHint() {
    const targetPreviewLinks = Array.from(
      document.querySelectorAll("[data-top-template-preview-link]")
    ).slice(0, 3);
    if (!targetPreviewLinks.length) return;

    const storageKey = "vishlinkTopTemplateTapHintDismissed";
    try {
      if (localStorage.getItem(storageKey) === "1") return;
    } catch (_err) {
      // Ignore localStorage access errors and continue.
    }

    const hintElements = [];
    targetPreviewLinks.forEach((targetPreviewLink) => {
      const imageContainer =
        targetPreviewLink.closest(".relative") || targetPreviewLink.parentElement;
      if (!imageContainer) return;

      const hintEl = document.createElement("div");
      hintEl.className = "top-template-tap-hint";
      hintEl.setAttribute("aria-hidden", "true");
      hintEl.innerHTML = `
        <img
          src="/assets/tap-tap-here.gif"
          alt="Tap here to preview"
          loading="eager"
          decoding="async"
          class="top-template-tap-hint__gif"
        />
      `;
      imageContainer.appendChild(hintEl);
      hintElements.push(hintEl);
    });

    if (!hintElements.length) return;

    let removed = false;
    const dismissHint = () => {
      if (removed) return;
      removed = true;
      hintElements.forEach((hintEl) => hintEl.classList.add("is-hidden"));
      window.setTimeout(() => {
        hintElements.forEach((hintEl) => {
          if (hintEl.isConnected) hintEl.remove();
        });
      }, 220);
      try {
        localStorage.setItem(storageKey, "1");
      } catch (_err) {
        // Ignore localStorage access errors.
      }
    };

    targetPreviewLinks.forEach((targetPreviewLink) => {
      targetPreviewLink.addEventListener("click", dismissHint, { once: true });
    });
    window.setTimeout(dismissHint, 25000);
  }

  bindThemeToggle("homeThemeToggleBtn");
  bindThemeToggle("collectionThemeToggleBtn");
  initBannerSlider();
  initTemplateScroller();
  initFeedbackForm();
  initPurchaseLinks();
  initTopTemplateTapHint();
})();
