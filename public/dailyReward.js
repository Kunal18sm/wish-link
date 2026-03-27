(() => {
  if (window.__vishlinkDailyRewardInit) return;
  window.__vishlinkDailyRewardInit = true;

  const stack = document.getElementById("dailyRewardStack");
  const modal = document.getElementById("dailyRewardModal");
  const claimBtn = document.getElementById("dailyRewardClaimBtn");
  const closeBtn = document.getElementById("dailyRewardCloseBtn");
  const feedbackEl = document.getElementById("dailyRewardFeedback");
  const balanceEl = document.getElementById("balance");
  const activeDayEl = document.getElementById("dailyRewardActiveDay");
  const toastEl = document.getElementById("dailyRewardToast");
  const toastValueEl = document.getElementById("dailyRewardToastValue");
  const checkIconSrc = "/assets/icons/check-circle.svg";
  const claimedDateStorageKey = "vishlinkDailyRewardClaimedDate";
  const modalDateKey = String(stack?.dataset?.dateKey || "");

  if (!modal) return;

  let isSubmitting = false;

  const showFeedback = (message = "", isError = true) => {
    if (!feedbackEl) return;
    if (!message) {
      feedbackEl.classList.add("hidden");
      feedbackEl.textContent = "";
      feedbackEl.classList.remove("text-emerald-300", "text-rose-300");
      return;
    }

    feedbackEl.textContent = message;
    feedbackEl.classList.remove("hidden");
    feedbackEl.classList.add(isError ? "text-rose-300" : "text-emerald-300");
    feedbackEl.classList.remove(isError ? "text-emerald-300" : "text-rose-300");
  };

  const hideModal = () => {
    if (stack) stack.classList.add("hidden");
    modal.classList.add("hidden");
    showFeedback("");
  };

  if (modalDateKey) {
    try {
      const alreadyClaimedDate = String(sessionStorage.getItem(claimedDateStorageKey) || "");
      if (alreadyClaimedDate === modalDateKey) {
        hideModal();
        return;
      }
    } catch (_err) {
      // Ignore storage access issues and continue normal flow.
    }
  }

  const showToast = (amount) => {
    if (!toastEl || !toastValueEl) return;
    const normalizedAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    toastValueEl.textContent = String(normalizedAmount);
    toastEl.classList.remove("translate-y-32", "opacity-0");
    toastEl.classList.add("translate-y-0", "opacity-100");

    window.setTimeout(() => {
      toastEl.classList.add("translate-y-32", "opacity-0");
      toastEl.classList.remove("translate-y-0", "opacity-100");
    }, 2000);
  };

  if (closeBtn) {
    closeBtn.addEventListener("click", hideModal);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideModal();
  });

  if (!claimBtn) return;

  claimBtn.addEventListener("click", async () => {
    if (isSubmitting) return;
    isSubmitting = true;
    claimBtn.disabled = true;
    const originalText = claimBtn.textContent;
    claimBtn.textContent = "Claiming...";
    showFeedback("");
    let claimedSuccessfully = false;

    try {
      const response = await fetch("/credits/claim-daily", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (_err) {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        showFeedback(payload?.message || "Unable to claim reward right now.");
        return;
      }

      if (balanceEl && Number.isFinite(Number(payload?.totalCredits))) {
        balanceEl.textContent = Number(payload.totalCredits).toLocaleString("en-IN");
      }

      if (activeDayEl) {
        const activeLabel = String(activeDayEl.dataset.dayLabel || "Today");
        activeDayEl.classList.remove("active-day", "cursor-pointer", "group");
        activeDayEl.classList.add("claimed");
        activeDayEl.innerHTML = `
          <span class="text-[10px] font-semibold text-slate-300 mb-2">${activeLabel}</span>
          <img src="${checkIconSrc}" alt="claimed" width="24" height="24" loading="lazy" decoding="async" class="h-6 w-6" />
          <span class="text-[9px] mt-2 font-bold text-green-400 uppercase">Done</span>
        `;
      } else {
        claimBtn.textContent = "Done";
        claimBtn.classList.remove("bg-yellow-500", "text-indigo-950");
        claimBtn.classList.add("bg-green-500", "text-white");
      }

      showFeedback(payload.message || "Daily reward claimed.", false);
      showToast(payload?.claimedCredits || 0);
      if (payload?.claimedDateKey) {
        try {
          sessionStorage.setItem(claimedDateStorageKey, String(payload.claimedDateKey));
        } catch (_err) {
          // Ignore storage access issues.
        }
      }
      hideModal();
      claimedSuccessfully = true;
    } catch (_err) {
      showFeedback("Network issue. Please try again.");
    } finally {
      isSubmitting = false;
      if (document.body.contains(claimBtn)) {
        if (!claimedSuccessfully) {
          claimBtn.disabled = false;
          claimBtn.textContent = originalText;
        }
      }
    }
  });
})();
