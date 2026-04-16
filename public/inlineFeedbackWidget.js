(() => {
  const WIDGET_CLASS = "js-inline-feedback-widget";
  const WIDGET_FORM_CLASS = "js-inline-feedback-widget-form";
  const SKIP_ATTR = "data-no-inline-feedback";

  function buildWidgetMarkup(pathname) {
    const safePath = String(pathname || "/").slice(0, 180);
    return `
      <div style="margin-top:55px;border:1px solid rgba(99,102,241,0.22);border-radius:12px;background:rgba(15,23,42,0.45);padding:12px;">
        <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#cbd5e1;">Share Feedback</p>
        <form class="${WIDGET_FORM_CLASS}" action="/feedback/add" method="POST" style="display:flex;flex-direction:column;gap:8px;">
          <div data-inline-feedback-guest="true" style="display:grid;grid-template-columns:1fr;gap:8px;">
            <input
              type="text"
              name="feedback[name]"
              placeholder="Your name (optional)"
              maxlength="80"
              style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.85);color:#e2e8f0;outline:none;">
            <input
              type="email"
              name="feedback[email]"
              placeholder="Your email (optional)"
              maxlength="120"
              style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.85);color:#e2e8f0;outline:none;">
          </div>
          <textarea
            name="feedback[message]"
            placeholder="Write your feedback..."
            maxlength="1000"
            required
            style="width:100%;min-height:78px;padding:10px 12px;border-radius:10px;border:1px solid rgba(148,163,184,0.35);background:rgba(15,23,42,0.85);color:#e2e8f0;outline:none;resize:vertical;"></textarea>
          <input type="hidden" name="feedback[sourcePath]" value="${safePath}">
          <button
            type="submit"
            style="align-self:flex-start;padding:9px 14px;border-radius:10px;border:1px solid rgba(99,102,241,0.5);background:#4f46e5;color:#eef2ff;font-size:12px;font-weight:700;cursor:pointer;">
            Send Feedback
          </button>
        </form>
      </div>
    `;
  }

  function shouldSkipForm(formElement) {
    if (!(formElement instanceof HTMLFormElement)) return true;
    if (formElement.classList.contains(WIDGET_FORM_CLASS)) return true;
    if (formElement.hasAttribute(SKIP_ATTR) || formElement.closest(`[${SKIP_ATTR}]`)) return true;

    const action = String(formElement.getAttribute("action") || "").toLowerCase();
    if (action.includes("/feedback/add")) return true;
    return false;
  }

  function hasMeaningfulInputField(formElement) {
    const fields = Array.from(formElement.querySelectorAll("input, textarea, select"));
    if (!fields.length) return false;

    return fields.some((field) => {
      if (field.disabled) return false;

      const tagName = String(field.tagName || "").toLowerCase();
      if (tagName === "textarea" || tagName === "select") return true;

      const inputType = String(field.getAttribute("type") || "text").toLowerCase();
      const ignoredTypes = new Set(["hidden", "submit", "button", "reset", "image"]);
      return !ignoredTypes.has(inputType);
    });
  }

  function appendFallbackWidget(currentPath, isAuthenticated) {
    if (document.querySelector(`.${WIDGET_CLASS}`)) return;

    const targetContainer = document.querySelector("main") || document.body;
    if (!targetContainer) return;

    const wrapper = document.createElement("div");
    wrapper.className = WIDGET_CLASS;
    wrapper.innerHTML = buildWidgetMarkup(currentPath);

    const guestFields = wrapper.querySelector('[data-inline-feedback-guest="true"]');
    const guestNameInput = wrapper.querySelector('input[name="feedback[name]"]');
    const guestEmailInput = wrapper.querySelector('input[name="feedback[email]"]');

    if (isAuthenticated) {
      if (guestFields) guestFields.style.display = "none";
      if (guestNameInput) guestNameInput.required = false;
      if (guestEmailInput) guestEmailInput.required = false;
    }

    targetContainer.appendChild(wrapper);
  }

  function applyInlineFeedbackWidgets() {
    const allForms = Array.from(document.querySelectorAll("form"));

    const isAuthenticated = String(document.body?.dataset.userAuthenticated || "") === "1";
    const currentPath = window.location.pathname || "/";
    const candidateForms = allForms.filter((formElement) => {
      if (shouldSkipForm(formElement)) return false;
      return hasMeaningfulInputField(formElement);
    });

    if (!candidateForms.length) {
      appendFallbackWidget(currentPath, isAuthenticated);
      return;
    }

    candidateForms.forEach((formElement) => {
      if (formElement.dataset.inlineFeedbackInjected === "true") return;

      formElement.dataset.inlineFeedbackInjected = "true";

      const wrapper = document.createElement("div");
      wrapper.className = WIDGET_CLASS;
      wrapper.innerHTML = buildWidgetMarkup(currentPath);

      const guestFields = wrapper.querySelector('[data-inline-feedback-guest="true"]');
      const guestNameInput = wrapper.querySelector('input[name="feedback[name]"]');
      const guestEmailInput = wrapper.querySelector('input[name="feedback[email]"]');

      if (isAuthenticated) {
        if (guestFields) guestFields.style.display = "none";
        if (guestNameInput) guestNameInput.required = false;
        if (guestEmailInput) guestEmailInput.required = false;
      }

      formElement.insertAdjacentElement("afterend", wrapper);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyInlineFeedbackWidgets);
  } else {
    applyInlineFeedbackWidgets();
  }
})();
