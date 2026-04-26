/*
  DNA Sequence Walk
  Static GitHub Pages app.

  Movement rules:
  A: x + 1
  T: x - 1
  G: y + 1
  C: y - 1
*/

const els = {
  sequenceInput: document.getElementById("sequenceInput"),
  fileInput: document.getElementById("fileInput"),
  recordSelect: document.getElementById("recordSelect"),
  startPosition: document.getElementById("startPosition"),
  endPosition: document.getElementById("endPosition"),
  maxBases: document.getElementById("maxBases"),
  skipAmbiguous: document.getElementById("skipAmbiguous"),
  plotButton: document.getElementById("plotButton"),
  clearButton: document.getElementById("clearButton"),
  summary: document.getElementById("summary"),
  plotSubtitle: document.getElementById("plotSubtitle"),
  plotWrap: document.getElementById("plotWrap"),
  plotSvg: document.getElementById("plotSvg"),
  emptyState: document.getElementById("emptyState"),
  resetViewButton: document.getElementById("resetViewButton"),
  downloadSvgButton: document.getElementById("downloadSvgButton"),
  downloadCsvButton: document.getElementById("downloadCsvButton"),
};

let fastaRecords = [];
let currentPoints = [];
let currentStats = null;
let currentTransform = { scale: 1, tx: 0, ty: 0 };
let baseViewBox = null;
let dragging = false;
let dragStart = null;

const SVG_NS = "http://www.w3.org/2000/svg";

function parseFastaOrRaw(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (!trimmed.startsWith(">")) {
    return [{
      name: "Pasted sequence",
      sequence: cleanSequence(trimmed),
      rawLength: trimmed.length,
    }];
  }

  const records = [];
  const parts = trimmed.split(/\n(?=>)/g);

  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    const header = lines[0].replace(/^>/, "").trim() || "Unnamed record";
    const seq = cleanSequence(lines.slice(1).join(""));
    records.push({
      name: header,
      sequence: seq,
      rawLength: lines.slice(1).join("").length,
    });
  }

  return records.filter(record => record.sequence.length > 0);
}

function cleanSequence(text) {
  return text
    .replace(/^>.*$/gm, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

function populateRecordSelect(records) {
  fastaRecords = records;
  els.recordSelect.innerHTML = "";

  if (records.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No FASTA records loaded";
    els.recordSelect.appendChild(option);
    els.recordSelect.disabled = true;
    return;
  }

  records.forEach((record, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${record.name} (${record.sequence.length.toLocaleString()} bp)`;
    els.recordSelect.appendChild(option);
  });

  els.recordSelect.disabled = records.length <= 1;
}

function getSelectedRecord() {
  const text = els.sequenceInput.value;
  const parsed = parseFastaOrRaw(text);
  populateRecordSelectIfChanged(parsed);

  if (parsed.length === 0) return null;
  const selectedIndex = Math.max(0, Number(els.recordSelect.value || 0));
  return parsed[selectedIndex] || parsed[0];
}

function populateRecordSelectIfChanged(records) {
  const oldKey = fastaRecords.map(r => `${r.name}|${r.sequence.length}`).join(";");
  const newKey = records.map(r => `${r.name}|${r.sequence.length}`).join(";");

  if (oldKey !== newKey) {
    const oldValue = els.recordSelect.value;
    populateRecordSelect(records);
    if (oldValue && Number(oldValue) < records.length) {
      els.recordSelect.value = oldValue;
    }
  }
}

function makeWalk(sequence, startPosition, endPosition, maxBases, skipAmbiguous) {
  const startIndex = Math.max(0, startPosition - 1);
  const requestedEnd = endPosition ? Math.min(sequence.length, endPosition) : sequence.length;
  const cappedEnd = Math.min(requestedEnd, startIndex + maxBases);
  const segment = sequence.slice(startIndex, cappedEnd);

  let x = 0;
  let y = 0;
  const points = [{ x, y, base: "START", position: startPosition - 1 }];

  const counts = { A: 0, T: 0, G: 0, C: 0, ambiguous: 0, plotted: 0 };

  for (let i = 0; i < segment.length; i++) {
    const base = segment[i];
    let moved = true;

    if (base === "A") {
      x += 1;
      counts.A++;
    } else if (base === "T") {
      x -= 1;
      counts.T++;
    } else if (base === "G") {
      y += 1;
      counts.G++;
    } else if (base === "C") {
      y -= 1;
      counts.C++;
    } else {
      counts.ambiguous++;
      moved = !skipAmbiguous;
      if (!skipAmbiguous) {
        // Ambiguous bases are recorded as zero-length steps when not skipped.
      }
    }

    if (moved) {
      counts.plotted++;
      points.push({ x, y, base, position: startPosition + i });
    }
  }

  const wasCapped = requestedEnd > cappedEnd;

  return {
    points,
    stats: {
      sequenceLength: sequence.length,
      startPosition,
      endPosition: cappedEnd,
      requestedEnd,
      plottedBases: counts.plotted,
      skippedAmbiguous: skipAmbiguous ? counts.ambiguous : 0,
      counts,
      finalX: x,
      finalY: y,
      wasCapped,
      maxBases,
    },
  };
}

function plotWalk(points, stats, title) {
  currentPoints = points;
  currentStats = stats;

  els.plotSvg.innerHTML = "";
  els.emptyState.style.display = "none";

  const width = els.plotWrap.clientWidth || 800;
  const height = els.plotWrap.clientHeight || 600;
  els.plotSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const bounds = getBounds(points);
  const pad = 64;
  const dataWidth = Math.max(1, bounds.maxX - bounds.minX);
  const dataHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - 2 * pad) / dataWidth, (height - 2 * pad) / dataHeight);

  const effectiveScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  baseViewBox = {
    width,
    height,
    bounds,
    pad,
    scale: effectiveScale,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
  };

  currentTransform = { scale: 1, tx: 0, ty: 0 };

  drawPlot();
  updateSummary(stats);
  els.plotSubtitle.textContent = `${title} · ${stats.startPosition.toLocaleString()}–${stats.endPosition.toLocaleString()} bp plotted`;
  setExportEnabled(true);
}

function drawPlot() {
  if (!baseViewBox || currentPoints.length === 0) return;

  const { width, height } = baseViewBox;
  els.plotSvg.innerHTML = "";
  els.plotSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const mainGroup = svgEl("g", {
    transform: `translate(${currentTransform.tx} ${currentTransform.ty}) scale(${currentTransform.scale})`,
  });

  drawGrid(mainGroup);
  drawTrace(mainGroup);

  els.plotSvg.appendChild(mainGroup);
  drawOverlayLabels();
}

function project(point) {
  const { width, height, scale, centerX, centerY } = baseViewBox;
  return {
    sx: width / 2 + (point.x - centerX) * scale,
    sy: height / 2 - (point.y - centerY) * scale,
  };
}

function drawGrid(group) {
  const { bounds, width, height, scale, centerX, centerY } = baseViewBox;
  const step = chooseGridStep(bounds, width, height, scale);

  const xStart = Math.floor(bounds.minX / step) * step - step * 2;
  const xEnd = Math.ceil(bounds.maxX / step) * step + step * 2;
  const yStart = Math.floor(bounds.minY / step) * step - step * 2;
  const yEnd = Math.ceil(bounds.maxY / step) * step + step * 2;

  for (let x = xStart; x <= xEnd; x += step) {
    const p1 = project({ x, y: yStart });
    const p2 = project({ x, y: yEnd });
    group.appendChild(svgEl("line", {
      x1: p1.sx, y1: p1.sy, x2: p2.sx, y2: p2.sy,
      class: x === 0 ? "axis-line" : "grid-line",
    }));

    if (x !== 0) {
      const labelPos = project({ x, y: 0 });
      group.appendChild(svgEl("text", {
        x: labelPos.sx + 3,
        y: Math.min(height - 8, Math.max(12, labelPos.sy - 4)),
        class: "tick-label",
      }, String(x)));
    }
  }

  for (let y = yStart; y <= yEnd; y += step) {
    const p1 = project({ x: xStart, y });
    const p2 = project({ x: xEnd, y });
    group.appendChild(svgEl("line", {
      x1: p1.sx, y1: p1.sy, x2: p2.sx, y2: p2.sy,
      class: y === 0 ? "axis-line" : "grid-line",
    }));

    if (y !== 0) {
      const labelPos = project({ x: 0, y });
      group.appendChild(svgEl("text", {
        x: Math.min(width - 36, Math.max(6, labelPos.sx + 4)),
        y: labelPos.sy - 3,
        class: "tick-label",
      }, String(y)));
    }
  }
}

function drawTrace(group) {
  const pathData = currentPoints
    .map((point, index) => {
      const p = project(point);
      return `${index === 0 ? "M" : "L"} ${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`;
    })
    .join(" ");

  group.appendChild(svgEl("path", {
    d: pathData,
    class: "trace-line",
    "vector-effect": "non-scaling-stroke",
  }));

  const start = project(currentPoints[0]);
  const end = project(currentPoints[currentPoints.length - 1]);

  group.appendChild(svgEl("circle", {
    cx: start.sx, cy: start.sy, r: 5,
    class: "start-dot",
    "vector-effect": "non-scaling-stroke",
  }));

  group.appendChild(svgEl("circle", {
    cx: end.sx, cy: end.sy, r: 5,
    class: "end-dot",
    "vector-effect": "non-scaling-stroke",
  }));
}

function drawOverlayLabels() {
  const { width, height } = baseViewBox;

  els.plotSvg.appendChild(svgEl("text", {
    x: width - 18,
    y: height / 2 - 8,
    class: "axis-label",
    "text-anchor": "end",
  }, "+A"));

  els.plotSvg.appendChild(svgEl("text", {
    x: 18,
    y: height / 2 - 8,
    class: "axis-label",
  }, "+T"));

  els.plotSvg.appendChild(svgEl("text", {
    x: width / 2 + 8,
    y: 22,
    class: "axis-label",
  }, "+G"));

  els.plotSvg.appendChild(svgEl("text", {
    x: width / 2 + 8,
    y: height - 14,
    class: "axis-label",
  }, "+C"));
}

function chooseGridStep(bounds, width, height, scale) {
  const rawTarget = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, rawTarget))));
  const candidates = [1, 2, 5, 10].map(v => v * magnitude);

  for (const candidate of candidates) {
    if (candidate * scale >= 35) return candidate;
  }

  return candidates[candidates.length - 1] * 2;
}

function getBounds(points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  if (minX === maxX) {
    minX -= 1;
    maxX += 1;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }

  return { minX, maxX, minY, maxY };
}

function updateSummary(stats) {
  const gc = stats.counts.G + stats.counts.C;
  const atgc = stats.counts.A + stats.counts.T + stats.counts.G + stats.counts.C;
  const gcPercent = atgc ? (100 * gc / atgc).toFixed(2) : "0.00";

  els.summary.innerHTML = `
    <dl>
      <dt>Sequence length</dt><dd>${stats.sequenceLength.toLocaleString()} bp</dd>
      <dt>Plotted range</dt><dd>${stats.startPosition.toLocaleString()}–${stats.endPosition.toLocaleString()}</dd>
      <dt>Plotted steps</dt><dd>${stats.plottedBases.toLocaleString()}</dd>
      <dt>A / T / G / C</dt><dd>${stats.counts.A.toLocaleString()} / ${stats.counts.T.toLocaleString()} / ${stats.counts.G.toLocaleString()} / ${stats.counts.C.toLocaleString()}</dd>
      <dt>GC%</dt><dd>${gcPercent}%</dd>
      <dt>Final coordinate</dt><dd>(${stats.finalX.toLocaleString()}, ${stats.finalY.toLocaleString()})</dd>
      ${stats.skippedAmbiguous ? `<dt>Skipped ambiguous</dt><dd>${stats.skippedAmbiguous.toLocaleString()}</dd>` : ""}
      ${stats.wasCapped ? `<dt class="warning">Capped</dt><dd class="warning">Only first ${stats.maxBases.toLocaleString()} bases in selected range were plotted.</dd>` : ""}
    </dl>
  `;
}

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
}

function setExportEnabled(enabled) {
  els.resetViewButton.disabled = !enabled;
  els.downloadSvgButton.disabled = !enabled;
  els.downloadCsvButton.disabled = !enabled;
}

function handlePlot() {
  const record = getSelectedRecord();

  if (!record || !record.sequence) {
    showError("Please paste or upload a DNA sequence first.");
    return;
  }

  const start = Number(els.startPosition.value || 1);
  const end = els.endPosition.value ? Number(els.endPosition.value) : null;
  const maxBases = Number(els.maxBases.value || 50000);

  if (!Number.isFinite(start) || start < 1 || start > record.sequence.length) {
    showError(`Start position must be between 1 and ${record.sequence.length.toLocaleString()}.`);
    return;
  }

  if (end !== null && (!Number.isFinite(end) || end < start)) {
    showError("End position must be empty or greater than or equal to the start position.");
    return;
  }

  if (!Number.isFinite(maxBases) || maxBases < 100) {
    showError("Maximum bases to plot must be at least 100.");
    return;
  }

  const result = makeWalk(
    record.sequence,
    Math.floor(start),
    end ? Math.floor(end) : null,
    Math.floor(maxBases),
    els.skipAmbiguous.checked
  );

  plotWalk(result.points, result.stats, record.name);
}

function showError(message) {
  els.summary.innerHTML = `<span class="warning">${escapeHtml(message)}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function clearAll() {
  els.sequenceInput.value = "";
  els.fileInput.value = "";
  els.startPosition.value = "1";
  els.endPosition.value = "";
  els.maxBases.value = "50000";
  populateRecordSelect([]);
  currentPoints = [];
  currentStats = null;
  baseViewBox = null;
  els.plotSvg.innerHTML = "";
  els.emptyState.style.display = "grid";
  els.summary.textContent = "No sequence plotted yet.";
  els.plotSubtitle.textContent = "Paste or upload a sequence to begin.";
  setExportEnabled(false);
}

function resetView() {
  currentTransform = { scale: 1, tx: 0, ty: 0 };
  drawPlot();
}

function downloadSvg() {
  const clone = els.plotSvg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`;
  downloadBlob(svgText, "dna-sequence-walk.svg", "image/svg+xml");
}

function downloadCsv() {
  if (!currentPoints.length) return;

  const rows = ["step,sequence_position,base,x,y"];
  currentPoints.forEach((point, index) => {
    rows.push(`${index},${point.position},${point.base},${point.x},${point.y}`);
  });

  downloadBlob(rows.join("\n"), "dna-sequence-walk-coordinates.csv", "text/csv");
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

els.fileInput.addEventListener("change", async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const text = await file.text();
  els.sequenceInput.value = text;
  const records = parseFastaOrRaw(text);
  populateRecordSelect(records);

  if (records.length) {
    els.summary.textContent = `Loaded ${records.length} record${records.length === 1 ? "" : "s"} from ${file.name}.`;
  } else {
    showError("No DNA sequence could be read from this file.");
  }
});

els.sequenceInput.addEventListener("input", () => {
  const records = parseFastaOrRaw(els.sequenceInput.value);
  populateRecordSelect(records);
});

els.plotButton.addEventListener("click", handlePlot);
els.clearButton.addEventListener("click", clearAll);
els.resetViewButton.addEventListener("click", resetView);
els.downloadSvgButton.addEventListener("click", downloadSvg);
els.downloadCsvButton.addEventListener("click", downloadCsv);

els.plotSvg.addEventListener("wheel", event => {
  if (!baseViewBox) return;
  event.preventDefault();

  const rect = els.plotSvg.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const zoomFactor = event.deltaY < 0 ? 1.12 : 0.89;
  const oldScale = currentTransform.scale;
  const newScale = Math.min(80, Math.max(0.05, oldScale * zoomFactor));

  currentTransform.tx = mouseX - (mouseX - currentTransform.tx) * (newScale / oldScale);
  currentTransform.ty = mouseY - (mouseY - currentTransform.ty) * (newScale / oldScale);
  currentTransform.scale = newScale;

  drawPlot();
}, { passive: false });

els.plotSvg.addEventListener("pointerdown", event => {
  if (!baseViewBox) return;
  dragging = true;
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    tx: currentTransform.tx,
    ty: currentTransform.ty,
  };
  els.plotSvg.classList.add("dragging");
  els.plotSvg.setPointerCapture(event.pointerId);
});

els.plotSvg.addEventListener("pointermove", event => {
  if (!dragging || !dragStart) return;
  currentTransform.tx = dragStart.tx + (event.clientX - dragStart.x);
  currentTransform.ty = dragStart.ty + (event.clientY - dragStart.y);
  drawPlot();
});

els.plotSvg.addEventListener("pointerup", event => {
  dragging = false;
  dragStart = null;
  els.plotSvg.classList.remove("dragging");
  try {
    els.plotSvg.releasePointerCapture(event.pointerId);
  } catch {
    // Safe no-op when pointer capture has already been released.
  }
});

els.plotSvg.addEventListener("pointerleave", () => {
  dragging = false;
  dragStart = null;
  els.plotSvg.classList.remove("dragging");
});

window.addEventListener("resize", () => {
  if (currentPoints.length && currentStats) {
    plotWalk(currentPoints, currentStats, els.plotSubtitle.textContent.split(" · ")[0] || "Sequence");
  }
});

// Example sequence for immediate exploration.
els.sequenceInput.value = `>Example short sequence
ATGCGCGTATATATGGGCCCAAATTTGGCGCGCATATATATATGGGCCC`;
populateRecordSelect(parseFastaOrRaw(els.sequenceInput.value));
