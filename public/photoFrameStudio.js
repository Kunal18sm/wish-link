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
  const selectedTemplateName = document.getElementById("selectedTemplateName");
  const selectedTemplateDesc = document.getElementById("selectedTemplateDesc");
  const selectedTemplateMeta = document.getElementById("selectedTemplateMeta");
  const frameEditorStage = document.getElementById("frameEditorStage");
  const frameImageSlotsLayer = document.getElementById("frameImageSlotsLayer");
  const frameTextLayer = document.getElementById("frameTextLayer");
  const frameOverlayImage = document.getElementById("frameOverlayImage");
  const textControls = document.getElementById("textControls");
  const statusNode = document.getElementById("frameStudioStatus");
  const downloadButton = document.getElementById("downloadFrameBtn");
  const resetButton = document.getElementById("resetFrameBtn");

  let activeTemplate = null;
  let slotInputRefs = new Map();
  let slotImageState = new Map();
  let textValues = new Map();
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const MAX_RENDER_RETRIES = 6;
  let renderRetryCount = 0;
  let renderRafId = null;
  let stageResizeObserver = null;
  let delayedRenderTimers = [];

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
    const fontFamily = String(textLayer.fontFamily || "Poppins");
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
    let mode = "none";
    let moved = false;
    let panPointerStart = null;
    let panStartOffsets = { offsetX: 0, offsetY: 0 };
    let pinchStart = null;

    const openPicker = () => {
      const input = slotInputRefs.get(slotKey);
      if (!input) return;
      input.click();
    };

    const getCurrentState = () => slotImageState.get(slotKey) || null;

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

        applySlotImageStyles(slotNode, slot, state, scale);
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

        applySlotImageStyles(slotNode, slot, state, scale);
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

    const stageRect = frameEditorStage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) {
      if (renderRetryCount < MAX_RENDER_RETRIES) {
        renderRetryCount += 1;
        scheduleRenderEditorLayers();
      }
      return;
    }

    const expectedHeight = (stageRect.width * canvasHeight) / Math.max(1, canvasWidth);
    if (Math.abs(stageRect.height - expectedHeight) > 4 && renderRetryCount < MAX_RENDER_RETRIES) {
      renderRetryCount += 1;
      scheduleRenderEditorLayers();
      return;
    }

    renderRetryCount = 0;
    const scale = stageRect.width ? stageRect.width / canvasWidth : 1;

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
    sortedTexts.forEach((textLayer) => {
      const value = getActiveTextValue(textLayer);
      if (!value) return;

      const textNode = document.createElement("div");
      textNode.className = "absolute pointer-events-none whitespace-pre-line";
      textNode.textContent = value;
      textNode.style.left = `${Number(textLayer.x || 0) * scale}px`;
      textNode.style.top = `${Number(textLayer.y || 0) * scale}px`;
      textNode.style.width = `${Number(textLayer.width || 200) * scale}px`;
      textNode.style.height = `${Number(textLayer.height || 120) * scale}px`;
      textNode.style.overflow = "hidden";
      textNode.style.color = String(textLayer.color || "#ffffff");
      textNode.style.fontFamily = String(textLayer.fontFamily || "Poppins");
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
      frameTextLayer.appendChild(textNode);
    });
  }

  function buildTextControls() {
    if (!textControls) return;

    textControls.innerHTML = "";
    (activeTemplate.texts || []).forEach((textLayer, index) => {
      const key = String(textLayer.key || `text_${index + 1}`);
      const currentValue = getActiveTextValue(textLayer);

      const control = document.createElement("div");
      control.className = "space-y-1";
      control.innerHTML = `
        <div class="flex items-center justify-between gap-2 pb-1 border-b border-slate-800/80">
          <h4 class="text-sm font-medium text-slate-200">${key}</h4>
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
      } else {
        const lockedValue = document.createElement("p");
        lockedValue.className = "text-sm text-slate-300";
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
    textValues = new Map();
    (selectedTemplate.texts || []).forEach((textLayer) => {
      textValues.set(String(textLayer.key || ""), String(textLayer.value || ""));
    });

    activeTemplate = selectedTemplate;
    rebuildSlotInputs();

    if (selectedTemplateName) selectedTemplateName.textContent = activeTemplate.name || "Photo Frame";
    if (selectedTemplateDesc) selectedTemplateDesc.textContent = activeTemplate.description || "Customize this frame and download.";
    if (selectedTemplateMeta) {
      selectedTemplateMeta.textContent = `${activeTemplate.canvas.width} x ${activeTemplate.canvas.height}px | ${activeTemplate.imageSlots.length} slots`;
    }

    buildTextControls();
    scheduleRenderBurst();
    setStatus("Slot par tap karke image upload karo. Drag se move, pinch se zoom.", "default");
  }

  async function downloadComposedImage() {
    if (!activeTemplate) return;

    try {
      setStatus("Preparing download image...", "default");
      const canvas = document.createElement("canvas");
      canvas.width = Number((activeTemplate.canvas && activeTemplate.canvas.width) || 1080);
      canvas.height = Number((activeTemplate.canvas && activeTemplate.canvas.height) || 1080);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not available.");

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

      const downloadLink = document.createElement("a");
      downloadLink.href = canvas.toDataURL("image/png");
      downloadLink.download = `${activeTemplate.slug || "photo-frame"}-${Date.now()}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      setStatus("Download complete.", "success");
    } catch (_err) {
      setStatus("Download failed. Please try again.", "error");
    }
  }

  function resetCurrentTemplate() {
    if (!activeTemplate) return;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    clearSlotImageState();
    resetSlotInputs();
    textValues = new Map();
    let editableControlIndex = 0;
    const textareas = textControls ? Array.from(textControls.querySelectorAll("textarea")) : [];
    (activeTemplate.texts || []).forEach((textLayer) => {
      const defaultValue = String(textLayer.value || "");
      textValues.set(String(textLayer.key || ""), defaultValue);
      if (textLayer.editable) {
        const textarea = textareas[editableControlIndex];
        if (textarea) textarea.value = defaultValue;
        editableControlIndex += 1;
      }
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
