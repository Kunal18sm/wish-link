(function () {
  const bootstrapNode = document.getElementById("frameTemplateBootstrap");
  const jsonNode = document.getElementById("frameTemplateEditableTemplateData");

  let editableTemplate = null;
  if (jsonNode?.textContent) {
    try {
      editableTemplate = JSON.parse(jsonNode.textContent);
    } catch (_err) {
      editableTemplate = null;
    }
  }

  const isReady = String(bootstrapNode?.dataset?.ready || "") === "1";
  const editorMode = String(bootstrapNode?.dataset?.mode || "create");

  const form = document.getElementById("frameTemplateForm");
  if (!form) return;

  const frameImageInput = document.getElementById("adminFrameImageInput");
  const framePreviewImage = document.getElementById("adminFramePreviewImage");
  const previewStage = document.getElementById("adminFramePreviewStage");
  const slotLayer = document.getElementById("adminFramePreviewSlots");
  const textLayer = document.getElementById("adminFramePreviewTexts");
  const canvasWidthInput = document.getElementById("canvasWidthInput");
  const canvasHeightInput = document.getElementById("canvasHeightInput");
  const nameInput = document.getElementById("templateNameInput");
  const slugInput = document.getElementById("templateSlugInput");
  const descriptionInput = document.getElementById("templateDescriptionInput");
  const activeInput = document.getElementById("templateActiveInput");

  const addSlotBtn = document.getElementById("addSlotBtn");
  const addTextBtn = document.getElementById("addTextBtn");
  const duplicateLayerBtn = document.getElementById("duplicateLayerBtn");
  const deleteLayerBtn = document.getElementById("deleteLayerBtn");
  const layerList = document.getElementById("layerList");
  const layerSettings = document.getElementById("layerSettings");
  const hintNode = document.getElementById("frameEditorHint");
  const slotsPayloadInput = document.getElementById("slotsPayloadInput");
  const textsPayloadInput = document.getElementById("textsPayloadInput");

  let slots = [];
  let texts = [];
  let selected = null;
  let dragState = null;
  let frameObjectUrl = "";
  const SLOT_MAX_Z = 999;
  const TEXT_MIN_Z = 1000;
  const TEXT_MAX_Z = 2000;

  function ensureFramePreviewVisible() {
    if (!framePreviewImage) return;
    framePreviewImage.style.display = "block";
    framePreviewImage.style.visibility = "visible";
  }

  function clamp(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function getCanvasSize() {
    return {
      width: clamp(canvasWidthInput?.value, 100, 5000, 1080),
      height: clamp(canvasHeightInput?.value, 100, 5000, 1080),
    };
  }

  function getScale() {
    const canvas = getCanvasSize();
    const stageRect = previewStage.getBoundingClientRect();
    if (!stageRect.width || !canvas.width) return 1;
    return stageRect.width / canvas.width;
  }

  function pointerToCanvas(event) {
    const canvas = getCanvasSize();
    const rect = previewStage.getBoundingClientRect();
    const scale = getScale();
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;
    return {
      x: clamp(x, -2000, canvas.width + 2000, 0),
      y: clamp(y, -2000, canvas.height + 2000, 0),
    };
  }

  function ensureUniqueKey(type, rawKey) {
    const fallbackPrefix = type === "slot" ? "slot" : "text";
    const base = String(rawKey || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || `${fallbackPrefix}_layer`;

    const source = type === "slot" ? slots : texts;
    let candidate = base;
    let index = 1;
    while (source.some((item) => item.key === candidate)) {
      candidate = `${base}_${index}`;
      index += 1;
    }
    return candidate.slice(0, 60);
  }

  function createSlot(seed) {
    const key = ensureUniqueKey("slot", seed ? seed.key : `slot_${slots.length + 1}`);
    return {
      key,
      label: String(seed?.label || `Photo ${slots.length + 1}`).slice(0, 80),
      x: clamp(seed?.x, 0, 5000, 120),
      y: clamp(seed?.y, 0, 5000, 120),
      width: clamp(seed?.width, 20, 5000, 260),
      height: clamp(seed?.height, 20, 5000, 260),
      borderRadius: clamp(seed?.borderRadius, 0, 1000, 0),
      zIndex: clamp(seed?.zIndex, 0, SLOT_MAX_Z, 0),
      rotation: clamp(seed?.rotation, -360, 360, 0),
    };
  }

  function createText(seed) {
    const key = ensureUniqueKey("text", seed ? seed.key : `text_${texts.length + 1}`);
    return {
      key,
      value: String(seed?.value || "Your Text").slice(0, 240),
      editable: Boolean(seed?.editable !== false),
      x: clamp(seed?.x, 0, 5000, 140),
      y: clamp(seed?.y, 0, 5000, 760),
      width: clamp(seed?.width, 20, 5000, 760),
      height: clamp(seed?.height, 20, 5000, 140),
      color: String(seed?.color || "#ffffff").slice(0, 30),
      fontSize: clamp(seed?.fontSize, 8, 300, 48),
      fontFamily: String(seed?.fontFamily || "Poppins").slice(0, 80),
      fontWeight: String(seed?.fontWeight || "700").slice(0, 20),
      textAlign: ["left", "center", "right"].includes(String(seed?.textAlign))
        ? String(seed.textAlign)
        : "center",
      lineHeight: clamp(seed?.lineHeight, 0.6, 3, 1.2),
      letterSpacing: clamp(seed?.letterSpacing, -10, 30, 0),
      zIndex: clamp(seed?.zIndex, TEXT_MIN_Z, TEXT_MAX_Z, TEXT_MIN_Z),
      rotation: clamp(seed?.rotation, -360, 360, 0),
    };
  }

  function getSelectedLayer() {
    if (!selected) return null;
    const source = selected.type === "slot" ? slots : texts;
    const layer = source.find((item) => item.key === selected.key);
    if (!layer) return null;
    return { ...selected, layer };
  }

  function selectLayer(type, key) {
    selected = { type, key };
    renderAll();
  }

  function clearSelection() {
    selected = null;
    renderAll();
  }

  function updateHint(message) {
    if (!hintNode) return;
    hintNode.textContent = message || "";
  }

  function renderLayerList() {
    if (!layerList) return;
    layerList.innerHTML = "";

    const allLayers = [
      ...slots.map((slot) => ({ type: "slot", key: slot.key, label: slot.label || slot.key, z: Number(slot.zIndex || 0) })),
      ...texts.map((textItem) => ({ type: "text", key: textItem.key, label: textItem.value || textItem.key, z: Number(textItem.zIndex || 0) })),
    ].sort((a, b) => a.z - b.z);

    allLayers.forEach((entry, index) => {
      const selectedClass = selected && selected.type === entry.type && selected.key === entry.key;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `w-full text-left rounded-xl border px-3 py-2 transition ${selectedClass
        ? "border-amber-400 bg-amber-500/10"
        : "border-slate-700 bg-slate-950/50 hover:bg-slate-800"}`;
      button.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold ${entry.type === "slot" ? "text-indigo-200" : "text-emerald-200"}">
            ${entry.type === "slot" ? "Image" : "Text"} ${index + 1}
          </span>
          <span class="text-[11px] text-slate-500">z:${entry.z}</span>
        </div>
        <p class="text-xs text-slate-300 mt-1 truncate">${entry.label || "Layer"}</p>
      `;
      button.addEventListener("click", () => selectLayer(entry.type, entry.key));
      layerList.appendChild(button);
    });

    if (!allLayers.length) {
      const empty = document.createElement("p");
      empty.className = "text-xs text-slate-500";
      empty.textContent = "No layers yet.";
      layerList.appendChild(empty);
    }
  }

  function createRangeControl(label, value, min, max, step, onInput) {
    const wrapper = document.createElement("label");
    wrapper.className = "block space-y-1";
    wrapper.innerHTML = `<span class="text-xs text-slate-300">${label}</span>`;
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    range.className = "w-full accent-indigo-500";

    const valueNode = document.createElement("div");
    valueNode.className = "text-[11px] text-slate-500";
    valueNode.textContent = String(value);

    range.addEventListener("input", () => {
      valueNode.textContent = range.value;
      onInput(range.value);
    });

    wrapper.appendChild(range);
    wrapper.appendChild(valueNode);
    return wrapper;
  }

  function renderLayerSettings() {
    if (!layerSettings) return;
    layerSettings.innerHTML = "";

    const selectedLayerInfo = getSelectedLayer();
    if (!selectedLayerInfo) {
      const empty = document.createElement("p");
      empty.className = "text-xs text-slate-500";
      empty.textContent = "Layer select karein to settings yahan ayengi.";
      layerSettings.appendChild(empty);
      return;
    }

    const { type, layer } = selectedLayerInfo;

    const keyRow = document.createElement("p");
    keyRow.className = "text-xs text-slate-400";
    keyRow.textContent = `Selected: ${type} / ${layer.key}`;
    layerSettings.appendChild(keyRow);

    layerSettings.appendChild(
      createRangeControl("Rotation", layer.rotation || 0, -180, 180, 1, (val) => {
        layer.rotation = clamp(val, -360, 360, layer.rotation);
        renderCanvasLayers();
        syncPayloads();
      })
    );

    const zRangeMin = type === "text" ? TEXT_MIN_Z : 0;
    const zRangeMax = type === "text" ? TEXT_MAX_Z : SLOT_MAX_Z;
    layerSettings.appendChild(
      createRangeControl("zIndex", layer.zIndex || zRangeMin, zRangeMin, zRangeMax, 1, (val) => {
        layer.zIndex = clamp(val, zRangeMin, zRangeMax, layer.zIndex);
        renderCanvasLayers();
        renderLayerList();
        syncPayloads();
      })
    );

    if (type === "slot") {
      const labelWrap = document.createElement("label");
      labelWrap.className = "block space-y-1";
      labelWrap.innerHTML = '<span class="text-xs text-slate-300">Slot Label</span>';
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.maxLength = 80;
      labelInput.value = layer.label || "";
      labelInput.className = "w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500";
      labelInput.addEventListener("input", () => {
        layer.label = labelInput.value.slice(0, 80);
        renderCanvasLayers();
        renderLayerList();
        syncPayloads();
      });
      labelWrap.appendChild(labelInput);
      layerSettings.appendChild(labelWrap);

      layerSettings.appendChild(
        createRangeControl("Border Radius", layer.borderRadius || 0, 0, 280, 1, (val) => {
          layer.borderRadius = clamp(val, 0, 1000, layer.borderRadius);
          renderCanvasLayers();
          syncPayloads();
        })
      );
      return;
    }

    const textValueWrap = document.createElement("label");
    textValueWrap.className = "block space-y-1";
    textValueWrap.innerHTML = '<span class="text-xs text-slate-300">Text</span>';
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.maxLength = 240;
    textarea.value = layer.value || "";
    textarea.className = "w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500";
    textarea.addEventListener("input", () => {
      layer.value = textarea.value.slice(0, 240);
      renderCanvasLayers();
      renderLayerList();
      syncPayloads();
    });
    textValueWrap.appendChild(textarea);
    layerSettings.appendChild(textValueWrap);

    const colorWrap = document.createElement("label");
    colorWrap.className = "block space-y-1";
    colorWrap.innerHTML = '<span class="text-xs text-slate-300">Text Color</span>';
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = /^#([0-9A-Fa-f]{3}){1,2}$/.test(layer.color || "") ? layer.color : "#ffffff";
    colorInput.className = "h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-2";
    colorInput.addEventListener("input", () => {
      layer.color = colorInput.value;
      renderCanvasLayers();
      syncPayloads();
    });
    colorWrap.appendChild(colorInput);
    layerSettings.appendChild(colorWrap);

    const alignWrap = document.createElement("label");
    alignWrap.className = "block space-y-1";
    alignWrap.innerHTML = '<span class="text-xs text-slate-300">Align</span>';
    const alignSelect = document.createElement("select");
    alignSelect.className = "w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500";
    ["left", "center", "right"].forEach((item) => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      if (layer.textAlign === item) option.selected = true;
      alignSelect.appendChild(option);
    });
    alignSelect.addEventListener("change", () => {
      layer.textAlign = alignSelect.value;
      renderCanvasLayers();
      syncPayloads();
    });
    alignWrap.appendChild(alignSelect);
    layerSettings.appendChild(alignWrap);

    const weightWrap = document.createElement("label");
    weightWrap.className = "block space-y-1";
    weightWrap.innerHTML = '<span class="text-xs text-slate-300">Weight</span>';
    const weightSelect = document.createElement("select");
    weightSelect.className = "w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500";
    ["400", "500", "600", "700", "800"].forEach((item) => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      if (String(layer.fontWeight) === item) option.selected = true;
      weightSelect.appendChild(option);
    });
    weightSelect.addEventListener("change", () => {
      layer.fontWeight = weightSelect.value;
      renderCanvasLayers();
      syncPayloads();
    });
    weightWrap.appendChild(weightSelect);
    layerSettings.appendChild(weightWrap);

    layerSettings.appendChild(
      createRangeControl("Font Size", layer.fontSize || 32, 10, 180, 1, (val) => {
        layer.fontSize = clamp(val, 8, 300, layer.fontSize);
        renderCanvasLayers();
        syncPayloads();
      })
    );

    layerSettings.appendChild(
      createRangeControl("Line Height", layer.lineHeight || 1.2, 0.8, 2.4, 0.1, (val) => {
        layer.lineHeight = clamp(val, 0.6, 3, layer.lineHeight);
        renderCanvasLayers();
        syncPayloads();
      })
    );

    layerSettings.appendChild(
      createRangeControl("Letter Spacing", layer.letterSpacing || 0, -5, 20, 0.2, (val) => {
        layer.letterSpacing = clamp(val, -10, 30, layer.letterSpacing);
        renderCanvasLayers();
        syncPayloads();
      })
    );

    const editableWrap = document.createElement("label");
    editableWrap.className = "inline-flex items-center gap-2 text-xs text-slate-300";
    const editableInput = document.createElement("input");
    editableInput.type = "checkbox";
    editableInput.checked = Boolean(layer.editable);
    editableInput.className = "accent-indigo-500";
    editableInput.addEventListener("change", () => {
      layer.editable = Boolean(editableInput.checked);
      syncPayloads();
    });
    editableWrap.appendChild(editableInput);
    const editableText = document.createElement("span");
    editableText.textContent = "User editable";
    editableWrap.appendChild(editableText);
    layerSettings.appendChild(editableWrap);
  }

  function createLayerElement(item, type) {
    const scale = getScale();
    const element = document.createElement("div");
    const isSelected = selected && selected.type === type && selected.key === item.key;

    element.className = `ft-layer ${type === "text" ? "is-text" : ""} ${isSelected ? "selected" : ""}`;
    element.dataset.type = type;
    element.dataset.key = item.key;
    element.style.left = `${item.x * scale}px`;
    element.style.top = `${item.y * scale}px`;
    element.style.width = `${Math.max(12, item.width * scale)}px`;
    element.style.height = `${Math.max(12, item.height * scale)}px`;
    element.style.borderRadius = `${Math.max(0, item.borderRadius || 0) * scale}px`;
    element.style.zIndex = String(Number(item.zIndex || 0));
    element.style.transform = `rotate(${Number(item.rotation || 0)}deg)`;
    element.style.transformOrigin = "center";
    element.style.pointerEvents = "auto";

    if (type === "text") {
      const textNode = document.createElement("div");
      textNode.className = "absolute inset-0 px-1 overflow-hidden break-words pointer-events-none whitespace-pre-line";
      textNode.textContent = item.value || "Text";
      textNode.style.color = item.color || "#ffffff";
      textNode.style.fontSize = `${Math.max(8, Number(item.fontSize || 24) * scale)}px`;
      textNode.style.fontFamily = item.fontFamily || "Poppins";
      textNode.style.fontWeight = item.fontWeight || "600";
      textNode.style.lineHeight = String(item.lineHeight || 1.2);
      textNode.style.letterSpacing = `${Number(item.letterSpacing || 0) * scale}px`;
      textNode.style.textAlign = item.textAlign || "center";
      element.appendChild(textNode);
    } else {
      const slotLabel = document.createElement("div");
      slotLabel.className = "absolute left-1 top-1 rounded bg-slate-950/65 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-100 pointer-events-none";
      slotLabel.textContent = item.label || item.key;
      element.appendChild(slotLabel);
    }

    const resizeHandle = document.createElement("span");
    resizeHandle.className = "ft-handle resize";
    resizeHandle.dataset.action = "resize";
    element.appendChild(resizeHandle);

    const rotateHandle = document.createElement("span");
    rotateHandle.className = "ft-handle rotate";
    rotateHandle.dataset.action = "rotate";
    element.appendChild(rotateHandle);

    return element;
  }

  function renderCanvasLayers() {
    const canvas = getCanvasSize();
    previewStage.style.aspectRatio = `${canvas.width}/${canvas.height}`;

    slotLayer.innerHTML = "";
    textLayer.innerHTML = "";

    slots
      .slice()
      .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
      .forEach((slot) => {
        slotLayer.appendChild(createLayerElement(slot, "slot"));
      });

    texts
      .slice()
      .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
      .forEach((textItem) => {
        textLayer.appendChild(createLayerElement(textItem, "text"));
      });
  }

  function renderAll() {
    renderCanvasLayers();
    renderLayerList();
    renderLayerSettings();
    syncPayloads();
  }

  function syncPayloads() {
    if (slotsPayloadInput) slotsPayloadInput.value = JSON.stringify(slots);
    if (textsPayloadInput) textsPayloadInput.value = JSON.stringify(texts);
  }

  function startDrag(event, type, key, action) {
    const source = type === "slot" ? slots : texts;
    const layer = source.find((item) => item.key === key);
    if (!layer) return;

    const startPoint = pointerToCanvas(event);
    const startLayer = { ...layer };
    let rotationOffset = 0;

    if (action === "rotate") {
      const centerX = startLayer.x + startLayer.width / 2;
      const centerY = startLayer.y + startLayer.height / 2;
      const pointerAngle = (Math.atan2(startPoint.y - centerY, startPoint.x - centerX) * 180) / Math.PI;
      rotationOffset = pointerAngle - Number(startLayer.rotation || 0);
    }

    dragState = {
      action,
      type,
      key,
      startPoint,
      startLayer,
      rotationOffset,
      pointerId: event.pointerId,
    };

    updateHint(
      action === "drag"
        ? "Layer moving..."
        : action === "resize"
          ? "Layer resizing..."
          : "Layer rotating..."
    );
  }

  function handlePointerDown(event) {
    const targetLayer = event.target.closest(".ft-layer");
    if (!targetLayer || !previewStage.contains(targetLayer)) {
      clearSelection();
      return;
    }

    const type = targetLayer.dataset.type;
    const key = targetLayer.dataset.key;
    if (!type || !key) return;

    selectLayer(type, key);

    const actionTarget = event.target.closest("[data-action]");
    const action = actionTarget?.dataset.action || "drag";

    event.preventDefault();
    previewStage.setPointerCapture(event.pointerId);
    startDrag(event, type, key, action);
  }

  function handlePointerMove(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const source = dragState.type === "slot" ? slots : texts;
    const layer = source.find((item) => item.key === dragState.key);
    if (!layer) return;

    const point = pointerToCanvas(event);
    const canvas = getCanvasSize();

    if (dragState.action === "drag") {
      const dx = point.x - dragState.startPoint.x;
      const dy = point.y - dragState.startPoint.y;
      layer.x = clamp(dragState.startLayer.x + dx, 0, Math.max(0, canvas.width - layer.width), layer.x);
      layer.y = clamp(dragState.startLayer.y + dy, 0, Math.max(0, canvas.height - layer.height), layer.y);
    }

    if (dragState.action === "resize") {
      const dx = point.x - dragState.startPoint.x;
      const dy = point.y - dragState.startPoint.y;
      layer.width = clamp(
        dragState.startLayer.width + dx,
        20,
        Math.max(20, canvas.width - layer.x),
        layer.width
      );
      layer.height = clamp(
        dragState.startLayer.height + dy,
        20,
        Math.max(20, canvas.height - layer.y),
        layer.height
      );
    }

    if (dragState.action === "rotate") {
      const centerX = layer.x + layer.width / 2;
      const centerY = layer.y + layer.height / 2;
      const pointerAngle = (Math.atan2(point.y - centerY, point.x - centerX) * 180) / Math.PI;
      layer.rotation = clamp(pointerAngle - dragState.rotationOffset, -360, 360, layer.rotation);
    }

    renderCanvasLayers();
    renderLayerSettings();
    syncPayloads();
  }

  function handlePointerUp(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    updateHint("Drag/resize/rotate complete.");
  }

  function deleteSelectedLayer() {
    const active = getSelectedLayer();
    if (!active) return;

    if (active.type === "slot") {
      slots = slots.filter((item) => item.key !== active.layer.key);
    } else {
      texts = texts.filter((item) => item.key !== active.layer.key);
    }

    selected = null;
    renderAll();
  }

  function duplicateSelectedLayer() {
    const active = getSelectedLayer();
    if (!active) return;

    if (active.type === "slot") {
      const clone = createSlot({ ...active.layer, x: active.layer.x + 24, y: active.layer.y + 24, key: `${active.layer.key}_copy` });
      slots.push(clone);
      selected = { type: "slot", key: clone.key };
    } else {
      const clone = createText({ ...active.layer, x: active.layer.x + 24, y: active.layer.y + 24, key: `${active.layer.key}_copy` });
      texts.push(clone);
      selected = { type: "text", key: clone.key };
    }

    renderAll();
  }

  function initializeEditorData() {
    if (editableTemplate && typeof editableTemplate === "object") {
      nameInput.value = editableTemplate.name || "";
      slugInput.value = editableTemplate.slug || "";
      descriptionInput.value = editableTemplate.description || "";
      activeInput.checked = Boolean(editableTemplate.isActive);

      if (editableTemplate.canvas) {
        canvasWidthInput.value = clamp(editableTemplate.canvas.width, 100, 5000, 1080);
        canvasHeightInput.value = clamp(editableTemplate.canvas.height, 100, 5000, 1080);
      }

      if (editableTemplate.frameImage?.previewUrl || editableTemplate.frameImage?.url) {
        framePreviewImage.src = editableTemplate.frameImage.previewUrl || editableTemplate.frameImage.url;
        ensureFramePreviewVisible();
      }

      slots = Array.isArray(editableTemplate.imageSlots)
        ? editableTemplate.imageSlots.map((item) => createSlot(item))
        : [];
      texts = Array.isArray(editableTemplate.texts)
        ? editableTemplate.texts.map((item) => createText(item))
        : [];
    }

    if (!slots.length) slots.push(createSlot());
    if (!texts.length) texts.push(createText());

    selected = { type: "slot", key: slots[0].key };
  }

  addSlotBtn?.addEventListener("click", () => {
    const slot = createSlot();
    slots.push(slot);
    selectLayer("slot", slot.key);
  });

  addTextBtn?.addEventListener("click", () => {
    const textItem = createText();
    texts.push(textItem);
    selectLayer("text", textItem.key);
  });

  duplicateLayerBtn?.addEventListener("click", duplicateSelectedLayer);
  deleteLayerBtn?.addEventListener("click", deleteSelectedLayer);

  canvasWidthInput?.addEventListener("input", renderCanvasLayers);
  canvasHeightInput?.addEventListener("input", renderCanvasLayers);
  window.addEventListener("resize", renderCanvasLayers);

  previewStage.addEventListener("pointerdown", handlePointerDown);
  previewStage.addEventListener("pointermove", handlePointerMove);
  previewStage.addEventListener("pointerup", handlePointerUp);
  previewStage.addEventListener("pointercancel", handlePointerUp);

  frameImageInput?.addEventListener("change", () => {
    if (frameObjectUrl) {
      URL.revokeObjectURL(frameObjectUrl);
      frameObjectUrl = "";
    }

    const file = frameImageInput.files?.[0];
    if (!file) {
      if (!framePreviewImage?.src) {
        updateHint("Frame image select karo to preview canvas me dikh jayega.");
      }
      return;
    }

    frameObjectUrl = URL.createObjectURL(file);
    framePreviewImage.src = frameObjectUrl;
    ensureFramePreviewVisible();
    updateHint("Frame image preview loaded.");

    const image = new Image();
    image.onload = () => {
      if (editorMode !== "edit" && !editableTemplate) {
        canvasWidthInput.value = Math.round(image.width || 1080);
        canvasHeightInput.value = Math.round(image.height || 1080);
      }
      renderCanvasLayers();
    };
    image.src = frameObjectUrl;
  });

  form.addEventListener("submit", (event) => {
    syncPayloads();

    if (!isReady) {
      event.preventDefault();
      window.alert("Permanent storage अभी configured nahi hai.");
      return;
    }

    if (!slots.length) {
      event.preventDefault();
      window.alert("At least one image slot required.");
      return;
    }

    if (editorMode !== "edit" && !frameImageInput?.files?.length && !framePreviewImage?.src) {
      event.preventDefault();
      window.alert("Frame image required for new template.");
    }
  });

  window.addEventListener("beforeunload", () => {
    if (frameObjectUrl) URL.revokeObjectURL(frameObjectUrl);
  });

  if (framePreviewImage) {
    framePreviewImage.addEventListener("load", ensureFramePreviewVisible);
    framePreviewImage.addEventListener("error", () => {
      updateHint("Frame preview load issue. Image dobara upload karein.");
    });
  }

  try {
    initializeEditorData();
    renderAll();
    updateHint("Layer select karo, then mouse/touch se move-resize-rotate karo.");
  } catch (_err) {
    slots = [createSlot()];
    texts = [createText()];
    selected = { type: "slot", key: slots[0].key };
    renderAll();
    updateHint("Editor reset mode me open hua. Ab aap layers add/edit kar sakte ho.");
  }
})();
