(function () {
  const bootstrapNode = document.getElementById("photoFrameStudioBootstrap");
  const templatesDataNode = document.getElementById("photoFrameTemplatesData");

  let templates = [];
  if (templatesDataNode && templatesDataNode.textContent) {
    try {
      const parsedTemplates = JSON.parse(templatesDataNode.textContent);
      if (Array.isArray(parsedTemplates)) templates = parsedTemplates;
    } catch (_err) {
      templates = [];
    }
  }

  if (!templates.length && Array.isArray(window.__FRAME_TEMPLATES__)) {
    templates = window.__FRAME_TEMPLATES__;
  }

  if (!templates.length) return;

  const selectedSlug = String(
    (bootstrapNode && bootstrapNode.dataset ? bootstrapNode.dataset.selectedSlug : "") ||
      window.__FRAME_SELECTED_SLUG__ ||
      ""
  )
    .trim()
    .toLowerCase();
  const isLoggedInForDownload =
    String((bootstrapNode && bootstrapNode.dataset ? bootstrapNode.dataset.isLoggedIn : "") || "")
      .trim()
      .toLowerCase() === "true";
  const downloadCreditCost = Math.max(
    1,
    Number.parseInt(
      (bootstrapNode && bootstrapNode.dataset ? bootstrapNode.dataset.downloadCreditCost : "") || "1",
      10
    ) || 1
  );
  const loginUrl = String(
    (bootstrapNode && bootstrapNode.dataset ? bootstrapNode.dataset.loginUrl : "") || "/logInForm"
  );
  const selectedTemplateName = document.getElementById("selectedTemplateName");
  const selectedTemplateDesc = document.getElementById("selectedTemplateDesc");
  const selectedTemplateMeta = document.getElementById("selectedTemplateMeta");
  const frameEditorStage = document.getElementById("frameEditorStage");
  const frameImageSlotsLayer = document.getElementById("frameImageSlotsLayer");
  const frameTextLayer = document.getElementById("frameTextLayer");
  const frameOverlayImage = document.getElementById("frameOverlayImage");
  const slotUploadControls = document.getElementById("slotUploadControls");
  const textControls = document.getElementById("textControls");
  const statusNode = document.getElementById("frameStudioStatus");
  const downloadButton = document.getElementById("downloadFrameBtn");
  const resetButton = document.getElementById("resetFrameBtn");
  if (frameTextLayer) {
    frameTextLayer.style.pointerEvents = "none";
  }

  let activeTemplate = null;
  let slotInputRefs = new Map();
  let slotImageState = new Map();
  let textValues = new Map();
  let textFontFamilyValues = new Map();
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const MAX_RENDER_RETRIES = 6;
  const FONT_FAMILY_OPTIONS = [
    "Poppins",
    "Montserrat",
    "Raleway",
    "Oswald",
    "Lora",
    "Merriweather",
    "Playfair Display",
    "Pacifico",
    "Dancing Script",
    "Caveat",
    "Lobster",
    "Bangers",
  ];
  const FONT_LOAD_TIMEOUT_MS = 1400;
  const GENERIC_FONT_FAMILIES = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "emoji",
    "math",
    "fangsong",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
  ]);
  const TEXT_EDIT_MAX_LENGTH = 240;
  const textMeasureCanvas = document.createElement("canvas");
  const textMeasureCtx = textMeasureCanvas.getContext("2d");
  const fontLoadPromises = new Map();
  let renderRetryCount = 0;
  let renderRafId = null;
  let stageResizeObserver = null;
  let delayedRenderTimers = [];
  let isDownloadInProgress = false;
  let inlineTextEditor = null;
  let activeInlineTextContext = null;
  let isInlineTextEditorPointerListenerAttached = false;

  function clamp(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function setStatus(message, mode) {
    if (!statusNode) return;
    statusNode.textContent = message || "";
    statusNode.classList.remove("text-slate-400", "text-emerald-300", "text-rose-300");

    if (mode === "success") {
      statusNode.classList.add("text-emerald-300");
      return;
    }
    if (mode === "error") {
      statusNode.classList.add("text-rose-300");
      return;
    }
    statusNode.classList.add("text-slate-400");
  }

  function updateUserCreditsUi(remainingCredits) {
    const numericCredits = Number(remainingCredits);
    if (!Number.isFinite(numericCredits)) return;
    const formatted = Math.max(0, numericCredits).toLocaleString("en-IN");
    document.querySelectorAll("[data-user-credits]").forEach((node) => {
      node.textContent = formatted;
    });
  }

  function formatCreditsLabel(value) {
    const numeric = Math.max(0, Number.parseInt(value || "0", 10) || 0);
    return `${numeric} credit${numeric === 1 ? "" : "s"}`;
  }

  async function consumeDownloadCredit() {
    if (!isLoggedInForDownload) {
      const loginError = new Error("Please login to download this photo frame.");
      loginError.code = "LOGIN_REQUIRED";
      throw loginError;
    }

    const response = await fetch("/photo-frames/download/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        templateSlug: String(activeTemplate?.slug || ""),
      }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_err) {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      const apiError = new Error(payload?.message || "Unable to use credits for download right now.");
      if (payload?.loginRequired) apiError.code = "LOGIN_REQUIRED";
      throw apiError;
    }

    if (Number.isFinite(Number(payload?.remainingCredits))) {
      updateUserCreditsUi(payload.remainingCredits);
    }

    return payload;
  }

  function removeSlotInputs() {
    for (const input of slotInputRefs.values()) {
      try {
        input.remove();
      } catch (_err) {
        // noop
      }
    }
    slotInputRefs = new Map();
  }

  function resetSlotInputs() {
    for (const input of slotInputRefs.values()) {
      try {
        input.value = "";
      } catch (_err) {
        // noop
      }
    }
  }

  function clearSlotImageState() {
    for (const entry of slotImageState.values()) {
      if (entry && entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
    slotImageState = new Map();
  }

  function cleanupUserUploads() {
    clearSlotImageState();
    removeSlotInputs();
  }

  function getActiveTextValue(textLayer) {
    return textValues.has(textLayer.key) ? textValues.get(textLayer.key) : String(textLayer.value || "");
  }

  function getTextLayerByKey(textKey, fallbackIndex) {
    const textLayers = (activeTemplate && activeTemplate.texts) || [];
    const byKey = textLayers.find((textLayer) => String(textLayer?.key || "") === String(textKey || ""));
    if (byKey) return byKey;
    if (Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < textLayers.length) {
      return textLayers[fallbackIndex];
    }
    return null;
  }

  function isInlineTextEditorOpen() {
    return Boolean(inlineTextEditor?.root && inlineTextEditor.root.style.display !== "none");
  }

  function updateInlineTextCounter(value) {
    if (!inlineTextEditor?.counter) return;
    const textLength = String(value || "").length;
    inlineTextEditor.counter.textContent = `${textLength}/${TEXT_EDIT_MAX_LENGTH}`;
    inlineTextEditor.counter.style.color = textLength >= TEXT_EDIT_MAX_LENGTH ? "#fca5a5" : "#94a3b8";
  }

  function positionInlineTextEditor(textLayer) {
    if (!inlineTextEditor?.root || !frameEditorStage || !textLayer) return;

    const canvasWidth = Number((activeTemplate?.canvas && activeTemplate.canvas.width) || 1080);
    const stageWidth = Number(frameEditorStage.clientWidth || 0);
    const stageHeight = Number(frameEditorStage.clientHeight || 0);
    if (!stageWidth || !stageHeight) return;
    const scale = canvasWidth ? stageWidth / canvasWidth : 1;

    const baseX = Number(textLayer.x || 0) * scale;
    const baseY = Number(textLayer.y || 0) * scale;
    const boxWidth = Number(textLayer.width || 200) * scale;
    const boxHeight = Number(textLayer.height || 120) * scale;
    const popupWidth = Number(inlineTextEditor.root.offsetWidth || 320);
    const popupHeight = Number(inlineTextEditor.root.offsetHeight || 176);
    const safePadding = 10;
    const gapAbove = 18;
    const gapBelow = 10;

    let left = baseX + boxWidth / 2 - popupWidth / 2;
    left = clamp(left, safePadding, Math.max(safePadding, stageWidth - popupWidth - safePadding), safePadding);

    let top = baseY - popupHeight - gapAbove;
    if (top < safePadding) {
      top = baseY + boxHeight + gapBelow;
    }
    top = clamp(top, safePadding, Math.max(safePadding, stageHeight - popupHeight - safePadding), safePadding);

    inlineTextEditor.root.style.left = `${Math.round(left)}px`;
    inlineTextEditor.root.style.top = `${Math.round(top)}px`;
    inlineTextEditor.root.style.visibility = "visible";
  }

  function refreshInlineTextEditorPosition() {
    if (!isInlineTextEditorOpen() || !activeInlineTextContext) return;
    const textLayer = getTextLayerByKey(activeInlineTextContext.key, activeInlineTextContext.index);
    if (!textLayer || !textLayer.editable) {
      hideInlineTextEditor(true);
      return;
    }
    positionInlineTextEditor(textLayer);
  }

  function hideInlineTextEditor(resetContext) {
    if (!inlineTextEditor?.root) return;
    inlineTextEditor.root.style.display = "none";
    inlineTextEditor.root.style.visibility = "hidden";
    if (resetContext) activeInlineTextContext = null;
  }

  function applyInlineTextEditorChanges() {
    if (!inlineTextEditor || !activeInlineTextContext) return;

    const nextValue = String(inlineTextEditor.textarea.value || "").slice(0, TEXT_EDIT_MAX_LENGTH);
    textValues.set(activeInlineTextContext.key, nextValue);

    hideInlineTextEditor(true);
    buildTextControls();
    scheduleRenderBurst();
    setStatus("Text updated.", "success");
  }

  function handleInlineTextEditorOutsidePointer(event) {
    if (!isInlineTextEditorOpen()) return;

    const target = event.target;
    if (inlineTextEditor?.root && inlineTextEditor.root.contains(target)) return;
    if (target && typeof target.closest === "function" && target.closest("[data-editable-text-layer='1']")) return;

    hideInlineTextEditor(true);
  }

  function ensureInlineTextEditor() {
    if (!frameEditorStage) return null;
    if (inlineTextEditor?.root) return inlineTextEditor;

    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.left = "8px";
    root.style.top = "8px";
    root.style.zIndex = "9999";
    root.style.width = "320px";
    root.style.maxWidth = "calc(100% - 20px)";
    root.style.boxSizing = "border-box";
    root.style.padding = "10px";
    root.style.borderRadius = "14px";
    root.style.border = "1px solid rgba(99, 102, 241, 0.55)";
    root.style.background = "linear-gradient(160deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.94))";
    root.style.boxShadow = "0 18px 45px rgba(2, 6, 23, 0.45)";
    root.style.backdropFilter = "none";
    root.style.transform = "translateZ(0)";
    root.style.isolation = "isolate";
    root.style.display = "none";
    root.style.visibility = "hidden";

    const title = document.createElement("div");
    title.textContent = "Edit Text";
    title.style.fontSize = "12px";
    title.style.fontWeight = "700";
    title.style.letterSpacing = "0.04em";
    title.style.textTransform = "uppercase";
    title.style.color = "#c7d2fe";
    title.style.marginBottom = "8px";
    root.appendChild(title);

    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.maxLength = TEXT_EDIT_MAX_LENGTH;
    textarea.style.width = "100%";
    textarea.style.resize = "vertical";
    textarea.style.minHeight = "84px";
    textarea.style.maxHeight = "220px";
    textarea.style.borderRadius = "10px";
    textarea.style.border = "1px solid rgba(71, 85, 105, 0.7)";
    textarea.style.background = "rgba(15, 23, 42, 0.85)";
    textarea.style.color = "#e2e8f0";
    textarea.style.padding = "8px 10px";
    textarea.style.fontSize = "14px";
    textarea.style.lineHeight = "1.4";
    textarea.style.outline = "none";
    root.appendChild(textarea);

    const footer = document.createElement("div");
    footer.style.marginTop = "10px";
    footer.style.display = "flex";
    footer.style.alignItems = "center";
    footer.style.justifyContent = "space-between";
    footer.style.gap = "10px";
    root.appendChild(footer);

    const counter = document.createElement("span");
    counter.style.fontSize = "11px";
    counter.style.color = "#94a3b8";
    footer.appendChild(counter);

    const actionWrap = document.createElement("div");
    actionWrap.style.display = "flex";
    actionWrap.style.gap = "8px";
    footer.appendChild(actionWrap);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.borderRadius = "8px";
    cancelBtn.style.border = "1px solid rgba(71, 85, 105, 0.8)";
    cancelBtn.style.background = "rgba(30, 41, 59, 0.85)";
    cancelBtn.style.color = "#cbd5e1";
    cancelBtn.style.padding = "6px 10px";
    cancelBtn.style.fontSize = "12px";
    cancelBtn.style.fontWeight = "600";
    actionWrap.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    saveBtn.style.borderRadius = "8px";
    saveBtn.style.border = "1px solid rgba(99, 102, 241, 0.85)";
    saveBtn.style.background = "rgba(79, 70, 229, 0.95)";
    saveBtn.style.color = "#ffffff";
    saveBtn.style.padding = "6px 12px";
    saveBtn.style.fontSize = "12px";
    saveBtn.style.fontWeight = "700";
    actionWrap.appendChild(saveBtn);

    textarea.addEventListener("input", () => {
      updateInlineTextCounter(textarea.value);
    });
    saveBtn.addEventListener("click", applyInlineTextEditorChanges);
    cancelBtn.addEventListener("click", () => hideInlineTextEditor(true));
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hideInlineTextEditor(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        applyInlineTextEditorChanges();
      }
    });

    frameEditorStage.appendChild(root);

    inlineTextEditor = {
      root,
      textarea,
      counter,
    };

    if (!isInlineTextEditorPointerListenerAttached) {
      document.addEventListener("pointerdown", handleInlineTextEditorOutsidePointer, true);
      isInlineTextEditorPointerListenerAttached = true;
    }

    return inlineTextEditor;
  }

  function editTextLayerFromCanvas(textLayer, index) {
    if (!textLayer || !textLayer.editable) return;
    const editor = ensureInlineTextEditor();
    if (!editor) return;

    const textKey = String(textLayer.key || `text_${index + 1}`);
    const currentValue = textValues.has(textKey) ? textValues.get(textKey) : String(textLayer.value || "");

    activeInlineTextContext = {
      key: textKey,
      index,
    };
    editor.textarea.value = String(currentValue || "").slice(0, TEXT_EDIT_MAX_LENGTH);
    updateInlineTextCounter(editor.textarea.value);

    editor.root.style.display = "block";
    editor.root.style.visibility = "hidden";
    positionInlineTextEditor(textLayer);

    window.requestAnimationFrame(() => {
      editor.textarea.focus();
      editor.textarea.select();
    });
  }

  function getNormalizedFontName(fontFamily) {
    return String(fontFamily || "")
      .split(",")[0]
      .replace(/['"]/g, "")
      .trim()
      .toLowerCase();
  }

  function toCssFontFamily(rawFontFamily) {
    const rawValue = String(rawFontFamily || "").trim();
    if (!rawValue) return "'Poppins', sans-serif";

    const parts = rawValue
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return "'Poppins', sans-serif";

    const normalizedParts = parts
      .map((part) => {
        const noQuotes = String(part || "").replace(/['"]/g, "").trim();
        if (!noQuotes) return "";
        if (GENERIC_FONT_FAMILIES.has(noQuotes.toLowerCase())) {
          return noQuotes;
        }
        return `'${noQuotes}'`;
      })
      .filter(Boolean);

    if (!normalizedParts.length) return "'Poppins', sans-serif";
    const hasGenericFallback = normalizedParts.some((part) =>
      GENERIC_FONT_FAMILIES.has(String(part || "").toLowerCase())
    );
    if (!hasGenericFallback) normalizedParts.push("sans-serif");

    return normalizedParts.join(", ");
  }

  function resolveFontFamilyValue(rawFontFamily) {
    const normalizedInput = String(rawFontFamily || "").trim();
    if (!normalizedInput) return "Poppins";

    const normalized = getNormalizedFontName(rawFontFamily);
    const matchedOption = FONT_FAMILY_OPTIONS.find(
      (fontName) => getNormalizedFontName(fontName) === normalized
    );
    if (matchedOption) return matchedOption;

    const fallbackFont = normalizedInput
      .split(",")[0]
      .replace(/['"]/g, "")
      .trim()
      .slice(0, 80);
    return fallbackFont || "Poppins";
  }

  function getActiveTextFontFamily(textLayer) {
    const key = String(textLayer?.key || "");
    const currentFont = textFontFamilyValues.has(key)
      ? textFontFamilyValues.get(key)
      : textLayer?.fontFamily;
    return resolveFontFamilyValue(currentFont);
  }

  function loadFontFamilyIfNeeded(fontFamily, fontWeight) {
    if (typeof document === "undefined" || !document.fonts || typeof document.fonts.load !== "function") {
      return Promise.resolve();
    }

    const resolvedFontFamily = resolveFontFamilyValue(fontFamily);
    const normalizedFont = getNormalizedFontName(resolvedFontFamily);
    if (!normalizedFont) return Promise.resolve();

    const matchedOption = FONT_FAMILY_OPTIONS.find(
      (fontName) => getNormalizedFontName(fontName) === normalizedFont
    );
    const finalFontFamily = matchedOption || resolvedFontFamily;
    const finalFontWeight = String(fontWeight || "600").trim() || "600";
    const cacheKey = `${normalizedFont}:${finalFontWeight}`;

    if (fontLoadPromises.has(cacheKey)) {
      return fontLoadPromises.get(cacheKey);
    }

    const cssFontFamily = toCssFontFamily(finalFontFamily);
    const loadPromise = Promise.race([
      document.fonts.load(`${finalFontWeight} 32px ${cssFontFamily}`),
      new Promise((resolve) => {
        window.setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
      }),
    ])
      .then(() => undefined)
      .catch(() => undefined);

    fontLoadPromises.set(cacheKey, loadPromise);
    return loadPromise;
  }

  async function preloadActiveTemplateFonts() {
    if (!activeTemplate || !Array.isArray(activeTemplate.texts) || !activeTemplate.texts.length) return;

    const uniqueFonts = new Map();
    activeTemplate.texts.forEach((textLayer) => {
      const fontFamily = getActiveTextFontFamily(textLayer);
      const fontWeight = String(textLayer?.fontWeight || "600");
      const fontKey = `${getNormalizedFontName(fontFamily)}:${fontWeight}`;
      if (!fontKey || uniqueFonts.has(fontKey)) return;
      uniqueFonts.set(fontKey, { fontFamily, fontWeight });
    });

    await Promise.all(
      Array.from(uniqueFonts.values()).map((entry) =>
        loadFontFamilyIfNeeded(entry.fontFamily, entry.fontWeight)
      )
    );
  }

  function getSlotFitState(slotKey) {
    const state = slotImageState.get(String(slotKey || ""));
    if (!state) {
      return { zoom: 1, offsetX: 0, offsetY: 0 };
    }
    return {
      zoom: clamp(state.zoom, ZOOM_MIN, ZOOM_MAX, 1),
      offsetX: clamp(state.offsetX, -100, 100, 0),
      offsetY: clamp(state.offsetY, -100, 100, 0),
    };
  }

  function scheduleRenderEditorLayers() {
    if (renderRafId) {
      window.cancelAnimationFrame(renderRafId);
    }
    renderRafId = window.requestAnimationFrame(() => {
      renderRafId = null;
      renderEditorLayers();
    });
  }

  function clearDelayedRenderTimers() {
    delayedRenderTimers.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    delayedRenderTimers = [];
  }

  function scheduleRenderBurst() {
    clearDelayedRenderTimers();
    scheduleRenderEditorLayers();
    delayedRenderTimers.push(window.setTimeout(scheduleRenderEditorLayers, 80));
    delayedRenderTimers.push(window.setTimeout(scheduleRenderEditorLayers, 240));
  }

  function setupStageResizeObserver() {
    if (!frameEditorStage || typeof ResizeObserver !== "function") return;
    if (stageResizeObserver) return;
    stageResizeObserver = new ResizeObserver(() => {
      scheduleRenderEditorLayers();
    });
    stageResizeObserver.observe(frameEditorStage);
  }

  function getCoverPlacement(imgWidth, imgHeight, boxWidth, boxHeight, zoom, offsetX, offsetY) {
    const safeImgWidth = Math.max(1, Number(imgWidth || 1));
    const safeImgHeight = Math.max(1, Number(imgHeight || 1));
    const safeBoxWidth = Math.max(1, Number(boxWidth || 1));
    const safeBoxHeight = Math.max(1, Number(boxHeight || 1));
    const safeZoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX, 1);
    const safeOffsetX = clamp(offsetX, -100, 100, 0);
    const safeOffsetY = clamp(offsetY, -100, 100, 0);

    const coverScale = Math.max(safeBoxWidth / safeImgWidth, safeBoxHeight / safeImgHeight);
    const scale = coverScale * safeZoom;

    const drawWidth = safeImgWidth * scale;
    const drawHeight = safeImgHeight * scale;

    const extraX = Math.max(0, drawWidth - safeBoxWidth);
    const extraY = Math.max(0, drawHeight - safeBoxHeight);

    return {
      x: -extraX / 2 + (safeOffsetX / 100) * (extraX / 2),
      y: -extraY / 2 + (safeOffsetY / 100) * (extraY / 2),
      width: drawWidth,
      height: drawHeight,
      extraX,
      extraY,
    };
  }

  function drawRoundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius || 0, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function getIntrinsicImageSize(img) {
    if (!img) return { width: 1, height: 1 };
    const width = Number(img.naturalWidth || img.width || 1);
    const height = Number(img.naturalHeight || img.height || 1);
    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
    };
  }

  function drawImageCover(ctx, img, x, y, width, height, fitState) {
    const intrinsic = getIntrinsicImageSize(img);
    const placement = getCoverPlacement(
      intrinsic.width,
      intrinsic.height,
      width,
      height,
      fitState ? fitState.zoom : undefined,
      fitState ? fitState.offsetX : undefined,
      fitState ? fitState.offsetY : undefined
    );
    ctx.drawImage(
      img,
      0,
      0,
      intrinsic.width,
      intrinsic.height,
      x + placement.x,
      y + placement.y,
      placement.width,
      placement.height
    );
  }

  function drawTextWithLetterSpacing(ctx, text, x, y, letterSpacing, align) {
    if (!letterSpacing) {
      ctx.fillText(text, x, y);
      return;
    }

    const chars = Array.from(String(text || ""));
    const widths = chars.map((char) => ctx.measureText(char).width);
    const totalWidth = widths.reduce((sum, width) => sum + width, 0) + letterSpacing * Math.max(chars.length - 1, 0);

    let cursorX = x;
    if (align === "center") cursorX = x - totalWidth / 2;
    if (align === "right") cursorX = x - totalWidth;

    chars.forEach((char, index) => {
      ctx.fillText(char, cursorX, y);
      cursorX += widths[index] + letterSpacing;
    });
  }

  function drawWrappedText(ctx, textLayer, textValue) {
    const value = String(textValue || "");
    if (!value.trim()) return;

    const fontSize = Number(textLayer.fontSize || 32);
    const fontFamily = toCssFontFamily(getActiveTextFontFamily(textLayer));
    const fontWeight = String(textLayer.fontWeight || "600");
    const textAlign = ["left", "center", "right"].includes(String(textLayer.textAlign || "center"))
      ? String(textLayer.textAlign)
      : "center";
    const lineHeight = Number(textLayer.lineHeight || 1.2);
    const letterSpacing = Number(textLayer.letterSpacing || 0);
    const width = Number(textLayer.width || 200);
    const height = Number(textLayer.height || 120);
    const baseX = Number(textLayer.x || 0);
    const baseY = Number(textLayer.y || 0);
    const rotation = Number(textLayer.rotation || 0);
    const lineGap = fontSize * lineHeight;

    ctx.save();
    const centerX = baseX + width / 2;
    const centerY = baseY + height / 2;
    if (rotation) {
      ctx.translate(centerX, centerY);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    ctx.beginPath();
    ctx.rect(baseX, baseY, width, height);
    ctx.clip();

    ctx.fillStyle = String(textLayer.color || "#ffffff");
    ctx.textBaseline = "top";
    ctx.textAlign = textAlign;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    const paragraphs = value.split(/\n/g);
    let lineIndex = 0;
    paragraphs.forEach((paragraph) => {
      const words = paragraph.split(/\s+/g).filter(Boolean);
      if (!words.length) {
        lineIndex += 1;
        return;
      }

      let line = words[0];
      for (let i = 1; i < words.length; i += 1) {
        const nextLine = `${line} ${words[i]}`;
        if (ctx.measureText(nextLine).width <= width) {
          line = nextLine;
        } else {
          if ((lineIndex + 1) * lineGap > height) break;
          const textX = textAlign === "left" ? baseX : textAlign === "center" ? baseX + width / 2 : baseX + width;
          drawTextWithLetterSpacing(ctx, line, textX, baseY + lineIndex * lineGap, letterSpacing, textAlign);
          lineIndex += 1;
          line = words[i];
        }
      }

      if ((lineIndex + 1) * lineGap > height) return;
      const textX = textAlign === "left" ? baseX : textAlign === "center" ? baseX + width / 2 : baseX + width;
      drawTextWithLetterSpacing(ctx, line, textX, baseY + lineIndex * lineGap, letterSpacing, textAlign);
      lineIndex += 1;
    });

    ctx.restore();
  }

  function measureLineWidthWithLetterSpacing(ctx, line, letterSpacing) {
    const lineValue = String(line || "");
    const baseWidth = Number(ctx.measureText(lineValue).width || 0);
    const charsCount = Array.from(lineValue).length;
    return baseWidth + Math.max(0, charsCount - 1) * Number(letterSpacing || 0);
  }

  function getWrappedTextLayout(textLayer, textValue) {
    const ctx = textMeasureCtx;
    if (!ctx) {
      return {
        lines: [],
        lineGap: Number(textLayer?.fontSize || 32) * Number(textLayer?.lineHeight || 1.2),
        maxLineWidth: 0,
      };
    }

    const value = String(textValue || "");
    const fontSize = Number(textLayer?.fontSize || 32);
    const fontFamily = toCssFontFamily(getActiveTextFontFamily(textLayer));
    const fontWeight = String(textLayer?.fontWeight || "600");
    const lineHeight = Number(textLayer?.lineHeight || 1.2);
    const letterSpacing = Number(textLayer?.letterSpacing || 0);
    const width = Number(textLayer?.width || 200);
    const height = Number(textLayer?.height || 120);
    const lineGap = fontSize * lineHeight;

    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

    const lines = [];
    let lineIndex = 0;
    let isHeightExceeded = false;
    const paragraphs = value.split(/\n/g);

    for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
      if (isHeightExceeded) break;

      const paragraph = paragraphs[paragraphIndex];
      const words = paragraph.split(/\s+/g).filter(Boolean);

      if (!words.length) {
        if ((lineIndex + 1) * lineGap > height) {
          isHeightExceeded = true;
          break;
        }
        lines.push("");
        lineIndex += 1;
        continue;
      }

      let line = words[0];
      for (let wordIndex = 1; wordIndex < words.length; wordIndex += 1) {
        const nextLine = `${line} ${words[wordIndex]}`;
        if (ctx.measureText(nextLine).width <= width) {
          line = nextLine;
        } else {
          if ((lineIndex + 1) * lineGap > height) {
            isHeightExceeded = true;
            break;
          }
          lines.push(line);
          lineIndex += 1;
          line = words[wordIndex];
        }
      }

      if (isHeightExceeded) break;
      if ((lineIndex + 1) * lineGap > height) break;
      lines.push(line);
      lineIndex += 1;
    }

    const maxLineWidth = lines.reduce((maxWidth, line) => {
      return Math.max(maxWidth, measureLineWidthWithLetterSpacing(ctx, line, letterSpacing));
    }, 0);

    return {
      lines,
      lineGap,
      maxLineWidth,
    };
  }

  function getEditableTextHotspotRect(textLayer, textValue, scale) {
    const layout = getWrappedTextLayout(textLayer, textValue);
    const layerX = Number(textLayer?.x || 0) * scale;
    const layerY = Number(textLayer?.y || 0) * scale;
    const layerWidth = Number(textLayer?.width || 200) * scale;
    const layerHeight = Number(textLayer?.height || 120) * scale;
    const textAlign = ["left", "center", "right"].includes(String(textLayer?.textAlign || "center"))
      ? String(textLayer.textAlign)
      : "center";

    const lineCount = Math.max(1, layout.lines.length);
    const contentHeight = Math.min(
      layerHeight,
      Math.max(24, lineCount * Number(layout.lineGap || 0) * scale + 6)
    );
    const contentWidth = layout.lines.length
      ? Math.min(layerWidth, Math.max(42, Number(layout.maxLineWidth || 0) * scale + 12))
      : Math.min(layerWidth, 110);

    let left = layerX;
    if (textAlign === "center") {
      left = layerX + (layerWidth - contentWidth) / 2;
    } else if (textAlign === "right") {
      left = layerX + (layerWidth - contentWidth);
    }

    left = clamp(left, layerX, layerX + Math.max(0, layerWidth - contentWidth), layerX);
    return {
      left,
      top: layerY,
      width: contentWidth,
      height: contentHeight,
    };
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to load image."));
      image.src = url;
    });
  }

  async function loadFrameOverlayImage() {
    const frameImage = (activeTemplate && activeTemplate.frameImage) || {};
    const candidateUrls = [frameImage.exportUrl, frameImage.previewUrl, frameImage.url].filter(Boolean);
    let lastError = null;

    for (const url of candidateUrls) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await loadImageFromUrl(url);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error("Frame image unavailable.");
  }

  function createSlotInput(slot) {
    const slotKey = String(slot.key || "");
    if (!slotKey) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.className = "hidden";
    input.style.display = "none";

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const previous = slotImageState.get(slotKey);
      if (previous && previous.objectUrl) URL.revokeObjectURL(previous.objectUrl);

      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        slotImageState.set(slotKey, {
          objectUrl,
          img: image,
          fileName: file.name,
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
        });
        buildSlotUploadControls();
        scheduleRenderBurst();
        setStatus("Photo uploaded. Drag to move, pinch to zoom.", "success");
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setStatus("Image load failed. Please try another file.", "error");
      };
      image.src = objectUrl;
    });

    document.body.appendChild(input);
    slotInputRefs.set(slotKey, input);
  }

  function rebuildSlotInputs() {
    removeSlotInputs();
    ((activeTemplate && activeTemplate.imageSlots) || []).forEach((slot) => createSlotInput(slot));
    buildSlotUploadControls();
  }

  function openSlotPicker(slotKey) {
    const input = slotInputRefs.get(String(slotKey || ""));
    if (!input) return;
    input.click();
  }

  function clearSlotImage(slotKey) {
    const key = String(slotKey || "");
    const existing = slotImageState.get(key);
    if (existing?.objectUrl) {
      URL.revokeObjectURL(existing.objectUrl);
    }
    slotImageState.delete(key);
    const input = slotInputRefs.get(key);
    if (input) input.value = "";
    buildSlotUploadControls();
    scheduleRenderBurst();
  }

  function buildSlotUploadControls() {
    if (!slotUploadControls) return;
    slotUploadControls.innerHTML = "";

    const imageSlots = (activeTemplate && activeTemplate.imageSlots) || [];
    imageSlots.forEach((slot, index) => {
      const slotKey = String(slot.key || "");
      const uploadedState = slotImageState.get(slotKey);
      const wrapper = document.createElement("div");
      wrapper.className = "rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5 space-y-2";

      const labelText = String(slot.label || "").trim() || `Photo ${index + 1}`;
      const header = document.createElement("div");
      header.className = "flex items-center justify-between gap-2";
      header.innerHTML = `
        <span class="text-sm font-medium text-slate-100">${labelText}</span>
        <span class="text-[11px] ${uploadedState ? "text-emerald-300" : "text-slate-500"}">
          ${uploadedState ? "Uploaded" : "Pending"}
        </span>
      `;
      wrapper.appendChild(header);

      if (uploadedState?.fileName) {
        const fileName = document.createElement("p");
        fileName.className = "text-[11px] text-slate-400 truncate";
        fileName.textContent = uploadedState.fileName;
        wrapper.appendChild(fileName);
      }

      const actions = document.createElement("div");
      actions.className = "flex flex-wrap gap-2";

      const uploadBtn = document.createElement("button");
      uploadBtn.type = "button";
      uploadBtn.className =
        "rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20 transition";
      uploadBtn.textContent = uploadedState ? "Replace" : "Upload";
      uploadBtn.addEventListener("click", () => openSlotPicker(slotKey));
      actions.appendChild(uploadBtn);

      if (uploadedState) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className =
          "rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 transition";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", () => clearSlotImage(slotKey));
        actions.appendChild(removeBtn);
      }

      wrapper.appendChild(actions);
      slotUploadControls.appendChild(wrapper);
    });

    if (!imageSlots.length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-slate-500";
      empty.textContent = "Is template me image slot nahi hai.";
      slotUploadControls.appendChild(empty);
    }
  }

  function applySlotImageStyles(slotNode, slot, state, scale) {
    const imgNode = slotNode.querySelector("img[data-role='slot-image']");
    if (!imgNode || !state || !state.img) return;

    const slotWidth = Number(slot.width || 0) * scale;
    const slotHeight = Number(slot.height || 0) * scale;
    const fit = getSlotFitState(slot.key);
    const intrinsic = getIntrinsicImageSize(state.img);
    const placement = getCoverPlacement(
      intrinsic.width,
      intrinsic.height,
      slotWidth,
      slotHeight,
      fit.zoom,
      fit.offsetX,
      fit.offsetY
    );

    imgNode.style.left = `${placement.x}px`;
    imgNode.style.top = `${placement.y}px`;
    imgNode.style.width = `${placement.width}px`;
    imgNode.style.height = `${placement.height}px`;
  }

  function attachSlotInteractions(slotNode, slot, scale) {
    const slotKey = String(slot.key || "");
    if (!slotKey) return;

    const pointers = new Map();
    let visualUpdateRafId = null;
    let mode = "none";
    let moved = false;
    let panPointerStart = null;
    let panStartOffsets = { offsetX: 0, offsetY: 0 };
    let pinchStart = null;

    const openPicker = () => {
      openSlotPicker(slotKey);
    };

    const getCurrentState = () => slotImageState.get(slotKey) || null;
    const applySlotVisualUpdate = () => {
      const state = getCurrentState();
      if (!state || !state.img) return;
      applySlotImageStyles(slotNode, slot, state, scale);
    };
    const scheduleSlotVisualUpdate = () => {
      if (visualUpdateRafId) return;
      visualUpdateRafId = window.requestAnimationFrame(() => {
        visualUpdateRafId = null;
        applySlotVisualUpdate();
      });
    };
    const flushSlotVisualUpdate = () => {
      if (visualUpdateRafId) {
        window.cancelAnimationFrame(visualUpdateRafId);
        visualUpdateRafId = null;
      }
      applySlotVisualUpdate();
    };

    slotNode.style.touchAction = "none";

    slotNode.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      try {
        slotNode.setPointerCapture(event.pointerId);
      } catch (_err) {
        // ignore
      }

      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        downAt: Date.now(),
      });

      const state = getCurrentState();
      if (!state || !state.img) {
        mode = "tap-upload";
        moved = false;
        return;
      }

      if (pointers.size === 1) {
        mode = "pan";
        moved = false;
        panPointerStart = { x: event.clientX, y: event.clientY };
        panStartOffsets = {
          offsetX: getSlotFitState(slotKey).offsetX,
          offsetY: getSlotFitState(slotKey).offsetY,
        };
      } else if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinchStart = {
          distance: Math.max(1, Math.hypot(dx, dy)),
          zoom: getSlotFitState(slotKey).zoom,
        };
        mode = "pinch";
      }
    });

    slotNode.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;

      const previous = pointers.get(event.pointerId);
      pointers.set(event.pointerId, {
        ...previous,
        x: event.clientX,
        y: event.clientY,
      });

      const state = getCurrentState();
      if (!state || !state.img) return;

      if (mode === "pinch" && pointers.size >= 2 && pinchStart) {
        const pts = Array.from(pointers.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        state.zoom = clamp(pinchStart.zoom * (distance / pinchStart.distance), ZOOM_MIN, ZOOM_MAX, state.zoom);

        const fit = getSlotFitState(slotKey);
        state.offsetX = fit.offsetX;
        state.offsetY = fit.offsetY;

        scheduleSlotVisualUpdate();
        moved = true;
        return;
      }

      if (mode === "pan" && pointers.size === 1 && panPointerStart) {
        const curr = pointers.get(event.pointerId);
        const deltaX = curr.x - panPointerStart.x;
        const deltaY = curr.y - panPointerStart.y;

        const slotWidth = Number(slot.width || 0) * scale;
        const slotHeight = Number(slot.height || 0) * scale;
        const intrinsic = getIntrinsicImageSize(state.img);
        const placement = getCoverPlacement(
          intrinsic.width,
          intrinsic.height,
          slotWidth,
          slotHeight,
          state.zoom,
          state.offsetX,
          state.offsetY
        );

        if (placement.extraX > 0) {
          state.offsetX = clamp(
            panStartOffsets.offsetX + (deltaX / (placement.extraX / 2)) * 100,
            -100,
            100,
            panStartOffsets.offsetX
          );
        } else {
          state.offsetX = 0;
        }

        if (placement.extraY > 0) {
          state.offsetY = clamp(
            panStartOffsets.offsetY + (deltaY / (placement.extraY / 2)) * 100,
            -100,
            100,
            panStartOffsets.offsetY
          );
        } else {
          state.offsetY = 0;
        }

        scheduleSlotVisualUpdate();
        if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) moved = true;
      }
    });

    const onPointerEnd = (event) => {
      if (!pointers.has(event.pointerId)) return;
      const pointerInfo = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);

      const state = getCurrentState();

      if (!state || !state.img) {
        const tapDistance = Math.hypot(event.clientX - pointerInfo.startX, event.clientY - pointerInfo.startY);
        if (tapDistance < 8) {
          openPicker();
        }
        mode = "none";
        return;
      }

      if (pointers.size === 0) {
        flushSlotVisualUpdate();
        const elapsed = Date.now() - pointerInfo.downAt;
        if (!moved && elapsed < 230) {
          openPicker();
        }
        mode = "none";
        return;
      }

      if (pointers.size === 1) {
        const remainingPointer = Array.from(pointers.values())[0];
        mode = "pan";
        moved = false;
        panPointerStart = { x: remainingPointer.x, y: remainingPointer.y };
        panStartOffsets = {
          offsetX: getSlotFitState(slotKey).offsetX,
          offsetY: getSlotFitState(slotKey).offsetY,
        };
      }
    };

    slotNode.addEventListener("pointerup", onPointerEnd);
    slotNode.addEventListener("pointercancel", onPointerEnd);
  }

  function renderEditorLayers() {
    if (!activeTemplate || !frameEditorStage || !frameImageSlotsLayer || !frameTextLayer || !frameOverlayImage) return;

    const canvasWidth = Number((activeTemplate.canvas && activeTemplate.canvas.width) || 1080);
    const canvasHeight = Number((activeTemplate.canvas && activeTemplate.canvas.height) || 1080);
    frameEditorStage.style.aspectRatio = `${canvasWidth} / ${canvasHeight}`;

    const stageWidth = Number(frameEditorStage.clientWidth || 0);
    const stageHeight = Number(frameEditorStage.clientHeight || 0);
    if (!stageWidth || !stageHeight) {
      if (renderRetryCount < MAX_RENDER_RETRIES) {
        renderRetryCount += 1;
        scheduleRenderEditorLayers();
      }
      return;
    }

    const expectedHeight = (stageWidth * canvasHeight) / Math.max(1, canvasWidth);
    if (Math.abs(stageHeight - expectedHeight) > 4 && renderRetryCount < MAX_RENDER_RETRIES) {
      renderRetryCount += 1;
      scheduleRenderEditorLayers();
      return;
    }

    renderRetryCount = 0;
    const scale = stageWidth ? stageWidth / canvasWidth : 1;

    frameImageSlotsLayer.innerHTML = "";
    frameTextLayer.innerHTML = "";
    frameOverlayImage.src =
      ((activeTemplate.frameImage && activeTemplate.frameImage.previewUrl) ||
        (activeTemplate.frameImage && activeTemplate.frameImage.url) ||
        "");

    const sortedSlots = [...(activeTemplate.imageSlots || [])].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
    sortedSlots.forEach((slot) => {
      const slotKey = String(slot.key || "");
      const slotNode = document.createElement("div");
      slotNode.className = "absolute overflow-hidden";
      const slotWidth = Number(slot.width || 0) * scale;
      const slotHeight = Number(slot.height || 0) * scale;

      slotNode.style.left = `${Number(slot.x || 0) * scale}px`;
      slotNode.style.top = `${Number(slot.y || 0) * scale}px`;
      slotNode.style.width = `${slotWidth}px`;
      slotNode.style.height = `${slotHeight}px`;
      slotNode.style.borderRadius = `${Number(slot.borderRadius || 0) * scale}px`;
      slotNode.style.zIndex = String(Number(slot.zIndex || 0));
      slotNode.style.transform = `rotate(${Number(slot.rotation || 0)}deg)`;
      slotNode.style.transformOrigin = "center";
      slotNode.style.cursor = "grab";

      const uploaded = slotImageState.get(slotKey);
      if (uploaded && uploaded.img && uploaded.img.src) {
        const fit = getSlotFitState(slotKey);
        const intrinsic = getIntrinsicImageSize(uploaded.img);
        const placement = getCoverPlacement(
          intrinsic.width,
          intrinsic.height,
          slotWidth,
          slotHeight,
          fit.zoom,
          fit.offsetX,
          fit.offsetY
        );

        const img = document.createElement("img");
        img.dataset.role = "slot-image";
        img.src = uploaded.img.src;
        img.alt = String(slot.label || slot.key || "Uploaded image");
        img.className = "absolute select-none pointer-events-none";
        img.style.left = `${placement.x}px`;
        img.style.top = `${placement.y}px`;
        img.style.width = `${placement.width}px`;
        img.style.height = `${placement.height}px`;

        slotNode.appendChild(img);
      } else {
        slotNode.style.display = "flex";
        slotNode.style.alignItems = "center";
        slotNode.style.justifyContent = "center";
        const badge = document.createElement("span");
        badge.textContent = "Tap";
        badge.className = "pointer-events-none";
        badge.style.zIndex = "20";
        badge.style.padding = "4px 8px";
        badge.style.borderRadius = "9999px";
        badge.style.fontSize = "10px";
        badge.style.fontWeight = "600";
        badge.style.lineHeight = "1";
        badge.style.color = "#f1f5f9";
        badge.style.backgroundColor = "rgba(15, 23, 42, 0.75)";
        slotNode.appendChild(badge);
      }

      attachSlotInteractions(slotNode, slot, scale);
      frameImageSlotsLayer.appendChild(slotNode);
    });

    const sortedTexts = [...(activeTemplate.texts || [])].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
    sortedTexts.forEach((textLayer, textIndex) => {
      const rawValue = getActiveTextValue(textLayer);
      const value = rawValue || (textLayer.editable ? "Tap to edit" : "");
      if (!value) return;
      const resolvedFontFamily = getActiveTextFontFamily(textLayer);

      const textNode = document.createElement("div");
      textNode.className = "absolute whitespace-pre-line";
      textNode.textContent = value;
      textNode.style.left = `${Number(textLayer.x || 0) * scale}px`;
      textNode.style.top = `${Number(textLayer.y || 0) * scale}px`;
      textNode.style.width = `${Number(textLayer.width || 200) * scale}px`;
      textNode.style.height = `${Number(textLayer.height || 120) * scale}px`;
      textNode.style.overflow = "hidden";
      textNode.style.color = String(textLayer.color || "#ffffff");
      textNode.style.fontFamily = toCssFontFamily(resolvedFontFamily);
      textNode.style.fontWeight = String(textLayer.fontWeight || "600");
      textNode.style.fontSize = `${Number(textLayer.fontSize || 32) * scale}px`;
      textNode.style.textAlign = ["left", "center", "right"].includes(String(textLayer.textAlign))
        ? String(textLayer.textAlign)
        : "center";
      textNode.style.lineHeight = String(textLayer.lineHeight || 1.2);
      textNode.style.letterSpacing = `${Number(textLayer.letterSpacing || 0) * scale}px`;
      textNode.style.zIndex = String(Number(textLayer.zIndex || 2));
      textNode.style.transform = `rotate(${Number(textLayer.rotation || 0)}deg)`;
      textNode.style.transformOrigin = "center";
      textNode.style.pointerEvents = "none";
      if (!rawValue && textLayer.editable) {
        textNode.style.border = "1px dashed rgba(148, 163, 184, 0.65)";
        textNode.style.backgroundColor = "rgba(15, 23, 42, 0.2)";
        textNode.style.padding = "4px";
        textNode.style.color = "rgba(226, 232, 240, 0.9)";
      }
      frameTextLayer.appendChild(textNode);

      if (textLayer.editable) {
        const hotspotRect = getEditableTextHotspotRect(textLayer, rawValue, scale);
        const hotspot = document.createElement("button");
        hotspot.type = "button";
        hotspot.className = "absolute";
        hotspot.style.left = `${hotspotRect.left}px`;
        hotspot.style.top = `${hotspotRect.top}px`;
        hotspot.style.width = `${hotspotRect.width}px`;
        hotspot.style.height = `${hotspotRect.height}px`;
        hotspot.style.background = "transparent";
        hotspot.style.border = "none";
        hotspot.style.outline = "none";
        hotspot.style.padding = "0";
        hotspot.style.cursor = "text";
        hotspot.style.pointerEvents = "auto";
        hotspot.style.zIndex = String(Number(textLayer.zIndex || 2) + 1);
        hotspot.dataset.editableTextLayer = "1";
        hotspot.dataset.textKey = String(textLayer.key || `text_${textIndex + 1}`);
        hotspot.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          editTextLayerFromCanvas(textLayer, textIndex);
        });
        frameTextLayer.appendChild(hotspot);
      }
    });

    refreshInlineTextEditorPosition();
  }

  function buildTextControls() {
    if (!textControls) return;

    textControls.innerHTML = "";
    (activeTemplate.texts || []).forEach((textLayer, index) => {
      const key = String(textLayer.key || `text_${index + 1}`);
      const currentValue = getActiveTextValue(textLayer);

      const control = document.createElement("div");
      control.className = "space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2.5";
      control.innerHTML = `
        <div class="flex items-center justify-between gap-2 pb-1 border-b border-slate-800/80">
          <h4 class="text-sm font-medium text-slate-200">Text ${index + 1}</h4>
          <span class="text-[11px] ${textLayer.editable ? "text-emerald-300" : "text-slate-500"}">${textLayer.editable ? "Editable" : "Locked"}</span>
        </div>
      `;

      if (textLayer.editable) {
        const textarea = document.createElement("textarea");
        textarea.rows = 2;
        textarea.maxLength = 240;
        textarea.value = currentValue;
        textarea.className =
          "w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-base md:text-sm text-slate-100 focus:outline-none focus:border-indigo-500";
        textarea.addEventListener("input", () => {
          textValues.set(key, textarea.value);
          scheduleRenderEditorLayers();
        });
        control.appendChild(textarea);

        const fontWrap = document.createElement("label");
        fontWrap.className = "block space-y-1";
        fontWrap.innerHTML = '<span class="text-[11px] text-slate-400">Font</span>';

        const fontSelect = document.createElement("select");
        fontSelect.className =
          "w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500";
        const resolvedFontFamily = getActiveTextFontFamily(textLayer);
        const fontOptions = [...FONT_FAMILY_OPTIONS];
        const hasResolvedFontInOptions = fontOptions.some(
          (fontName) => getNormalizedFontName(fontName) === getNormalizedFontName(resolvedFontFamily)
        );
        if (!hasResolvedFontInOptions && resolvedFontFamily) {
          fontOptions.unshift(resolvedFontFamily);
        }

        fontOptions.forEach((fontName) => {
          const option = document.createElement("option");
          option.value = fontName;
          option.textContent = `Aa - ${fontName}`;
          option.style.fontFamily = toCssFontFamily(fontName);
          if (getNormalizedFontName(fontName) === getNormalizedFontName(resolvedFontFamily)) {
            option.selected = true;
          }
          fontSelect.appendChild(option);
        });

        fontSelect.addEventListener("change", () => {
          const selectedFontFamily = resolveFontFamilyValue(fontSelect.value);
          textFontFamilyValues.set(key, selectedFontFamily);
          scheduleRenderEditorLayers();
          void loadFontFamilyIfNeeded(selectedFontFamily, textLayer.fontWeight).then(() => {
            scheduleRenderBurst();
          });
        });

        fontWrap.appendChild(fontSelect);
        control.appendChild(fontWrap);
      } else {
        const lockedValue = document.createElement("p");
        lockedValue.className = "text-sm text-slate-300 line-clamp-3";
        lockedValue.textContent = currentValue || "No text";
        control.appendChild(lockedValue);
      }

      textControls.appendChild(control);
    });

    if (!(activeTemplate.texts || []).length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-slate-500";
      empty.textContent = "Is template me editable text layer nahi hai.";
      textControls.appendChild(empty);
    }
  }

  function setTemplate(slug) {
    const fallbackTemplate = templates[0];
    const selectedTemplate =
      templates.find((template) => String(template.slug || "").toLowerCase() === String(slug || "").toLowerCase()) ||
      fallbackTemplate;
    if (!selectedTemplate) return;

    cleanupUserUploads();
    hideInlineTextEditor(true);
    textValues = new Map();
    textFontFamilyValues = new Map();
    (selectedTemplate.texts || []).forEach((textLayer) => {
      const key = String(textLayer.key || "");
      textValues.set(key, String(textLayer.value || ""));
      textFontFamilyValues.set(key, resolveFontFamilyValue(textLayer.fontFamily));
    });

    activeTemplate = selectedTemplate;
    rebuildSlotInputs();

    if (selectedTemplateName) selectedTemplateName.textContent = activeTemplate.name || "Photo Frame";
    if (selectedTemplateDesc) selectedTemplateDesc.textContent = activeTemplate.description || "Customize this frame and download.";
    if (selectedTemplateMeta) {
      selectedTemplateMeta.textContent = `${activeTemplate.canvas.width} x ${activeTemplate.canvas.height}px | ${activeTemplate.imageSlots.length} slots`;
    }

    void preloadActiveTemplateFonts().then(() => {
      scheduleRenderBurst();
    });
    buildTextControls();
    buildSlotUploadControls();
    scheduleRenderBurst();
    setStatus("Slot par tap karke image upload karo. Text par tap karke edit karo.", "default");
  }

  async function downloadComposedImage() {
    if (!activeTemplate || isDownloadInProgress) return;
    isDownloadInProgress = true;

    const originalLabel = downloadButton ? downloadButton.textContent : "";
    if (downloadButton) {
      downloadButton.disabled = true;
      downloadButton.textContent = "Please wait...";
    }

    try {
      setStatus("Preparing final frame image...", "default");
      const canvas = document.createElement("canvas");
      canvas.width = Number((activeTemplate.canvas && activeTemplate.canvas.width) || 1080);
      canvas.height = Number((activeTemplate.canvas && activeTemplate.canvas.height) || 1080);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not available.");
      await preloadActiveTemplateFonts();

      const sortedSlots = [...(activeTemplate.imageSlots || [])].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
      sortedSlots.forEach((slot) => {
        const state = slotImageState.get(String(slot.key || ""));
        if (!state || !state.img) return;

        const slotX = Number(slot.x || 0);
        const slotY = Number(slot.y || 0);
        const slotWidth = Number(slot.width || 0);
        const slotHeight = Number(slot.height || 0);
        const slotRadius = Number(slot.borderRadius || 0);
        const slotRotation = Number(slot.rotation || 0);
        const fitState = getSlotFitState(slot.key);

        ctx.save();
        if (slotRotation) {
          const centerX = slotX + slotWidth / 2;
          const centerY = slotY + slotHeight / 2;
          ctx.translate(centerX, centerY);
          ctx.rotate((slotRotation * Math.PI) / 180);
          drawRoundRectPath(ctx, -slotWidth / 2, -slotHeight / 2, slotWidth, slotHeight, slotRadius);
          ctx.clip();
          drawImageCover(ctx, state.img, -slotWidth / 2, -slotHeight / 2, slotWidth, slotHeight, fitState);
          ctx.restore();
          return;
        }

        drawRoundRectPath(ctx, slotX, slotY, slotWidth, slotHeight, slotRadius);
        ctx.clip();
        drawImageCover(ctx, state.img, slotX, slotY, slotWidth, slotHeight, fitState);
        ctx.restore();
      });

      const frameOverlay = await loadFrameOverlayImage();
      ctx.drawImage(frameOverlay, 0, 0, canvas.width, canvas.height);

      const sortedTexts = [...(activeTemplate.texts || [])].sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0));
      sortedTexts.forEach((textLayer) => {
        drawWrappedText(ctx, textLayer, getActiveTextValue(textLayer));
      });

      const outputDataUrl = canvas.toDataURL("image/png");
      setStatus(`Checking credits (${formatCreditsLabel(downloadCreditCost)})...`, "default");
      const creditPayload = await consumeDownloadCredit();

      const downloadLink = document.createElement("a");
      downloadLink.href = outputDataUrl;
      downloadLink.download = `${activeTemplate.slug || "photo-frame"}-${Date.now()}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      const chargedCredits = Number.isFinite(Number(creditPayload?.chargedCredits))
        ? Number(creditPayload.chargedCredits)
        : downloadCreditCost;
      setStatus(`Download complete. ${formatCreditsLabel(chargedCredits)} used.`, "success");
    } catch (err) {
      if (err && err.code === "LOGIN_REQUIRED") {
        setStatus(err.message || "Please login to continue.", "error");
        window.setTimeout(() => {
          window.location.href = loginUrl;
        }, 500);
      } else {
        setStatus(err?.message || "Download failed. Please try again.", "error");
      }
    } finally {
      if (downloadButton) {
        downloadButton.disabled = false;
        downloadButton.textContent = originalLabel;
      }
      isDownloadInProgress = false;
    }
  }

  function resetCurrentTemplate() {
    if (!activeTemplate) return;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    clearSlotImageState();
    resetSlotInputs();
    hideInlineTextEditor(true);
    textValues = new Map();
    textFontFamilyValues = new Map();
    let editableControlIndex = 0;
    const textareas = textControls ? Array.from(textControls.querySelectorAll("textarea")) : [];
    (activeTemplate.texts || []).forEach((textLayer) => {
      const key = String(textLayer.key || "");
      const defaultValue = String(textLayer.value || "");
      textValues.set(key, defaultValue);
      textFontFamilyValues.set(key, resolveFontFamilyValue(textLayer.fontFamily));
      if (textLayer.editable) {
        const textarea = textareas[editableControlIndex];
        if (textarea) textarea.value = defaultValue;
        editableControlIndex += 1;
      }
    });
    buildTextControls();
    buildSlotUploadControls();
    void preloadActiveTemplateFonts().then(() => {
      scheduleRenderBurst();
    });
    scheduleRenderBurst();
    setStatus("Current template reset ho gaya.", "default");
  }

  const onVisualViewportChange = () => {
    scheduleRenderEditorLayers();
  };

  window.addEventListener("resize", scheduleRenderEditorLayers);
  window.addEventListener("load", scheduleRenderEditorLayers);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onVisualViewportChange);
    window.visualViewport.addEventListener("scroll", onVisualViewportChange);
  }
  setupStageResizeObserver();
  if (downloadButton) downloadButton.addEventListener("click", downloadComposedImage);
  if (resetButton) resetButton.addEventListener("click", resetCurrentTemplate);
  window.addEventListener("beforeunload", () => {
    clearDelayedRenderTimers();
    hideInlineTextEditor(true);
    if (isInlineTextEditorPointerListenerAttached) {
      document.removeEventListener("pointerdown", handleInlineTextEditorOutsidePointer, true);
      isInlineTextEditorPointerListenerAttached = false;
    }
    if (inlineTextEditor?.root && inlineTextEditor.root.parentNode) {
      inlineTextEditor.root.parentNode.removeChild(inlineTextEditor.root);
    }
    inlineTextEditor = null;
    activeInlineTextContext = null;
    if (stageResizeObserver) {
      stageResizeObserver.disconnect();
      stageResizeObserver = null;
    }
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", onVisualViewportChange);
      window.visualViewport.removeEventListener("scroll", onVisualViewportChange);
    }
    cleanupUserUploads();
  });

  setTemplate(selectedSlug);
})();
