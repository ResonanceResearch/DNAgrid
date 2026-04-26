/*
  DNA Sequence Walk: multi-sequence version.

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
  selectAllButton: document.getElementById("selectAllButton"),
  selectNoneButton: document.getElementById("selectNoneButton"),
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
  tooltip: document.getElementById("tooltip"),
  emptyState: document.getElementById("emptyState"),
  resetViewButton: document.getElementById("resetViewButton"),
  downloadSvgButton: document.getElementById("downloadSvgButton"),
  downloadPngButton: document.getElementById("downloadPngButton"),
  downloadHtmlButton: document.getElementById("downloadHtmlButton"),
  downloadCsvButton: document.getElementById("downloadCsvButton"),
};

const SVG_NS = "http://www.w3.org/2000/svg";
const COLOR_PALETTE = [
  "#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e",
  "#17becf", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22",
  "#003f5c", "#a05195", "#f95d6a", "#665191", "#ffa600"
];

let fastaRecords = [];
let plottedSeries = [];
let coordinateIndex = new Map();
let hoverCircle = null;
let view = null;
let dragging = false;
let dragStart = null;

function parseFastaOrRaw(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (!trimmed.startsWith(">")) {
    const sequence = cleanSequence(trimmed);
    return sequence ? [{ name: "Pasted sequence", sequence, rawLength: trimmed.length }] : [];
  }

  const records = [];
  let currentName = null;
  let currentLines = [];

  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      if (currentName !== null) {
        const sequence = cleanSequence(currentLines.join(""));
        if (sequence) records.push({ name: currentName, sequence, rawLength: currentLines.join("").length });
      }
      currentName = line.replace(/^>/, "").trim() || `Unnamed record ${records.length + 1}`;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentName !== null) {
    const sequence = cleanSequence(currentLines.join(""));
    if (sequence) records.push({ name: currentName, sequence, rawLength: currentLines.join("").length });
  }

  return records;
}

function cleanSequence(text) {
  return text.replace(/^>.*$/gm, "").replace(/[^A-Za-z]/g, "").toUpperCase();
}

function populateRecordSelect(records) {
  const oldSelected = new Set([...els.recordSelect.selectedOptions].map(o => o.value));
  fastaRecords = records;
  els.recordSelect.innerHTML = "";

  if (!records.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No FASTA records loaded";
    els.recordSelect.appendChild(option);
    els.recordSelect.disabled = true;
    els.selectAllButton.disabled = true;
    els.selectNoneButton.disabled = true;
    return;
  }

  records.forEach((record, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${record.name} (${record.sequence.length.toLocaleString()} bp)`;
    option.selected = oldSelected.size ? oldSelected.has(String(index)) : true;
    els.recordSelect.appendChild(option);
  });

  els.recordSelect.disabled = false;
  els.selectAllButton.disabled = false;
  els.selectNoneButton.disabled = false;
}

function refreshRecordListFromText() {
  const records = parseFastaOrRaw(els.sequenceInput.value);
  const oldKey = fastaRecords.map(r => `${r.name}|${r.sequence.length}|${r.sequence.slice(0,20)}`).join(";");
  const newKey = records.map(r => `${r.name}|${r.sequence.length}|${r.sequence.slice(0,20)}`).join(";");
  if (oldKey !== newKey) populateRecordSelect(records);
  return records;
}

function getSelectedRecords() {
  const records = refreshRecordListFromText();
  if (!records.length) return [];
  const selected = new Set([...els.recordSelect.selectedOptions].map(o => Number(o.value)));
  if (!selected.size) return [];
  return records.filter((_, index) => selected.has(index));
}

function makeWalk(record, seriesIndex, startPosition, endPosition, maxBases, skipAmbiguous) {
  const sequence = record.sequence;
  const startIndex = Math.max(0, startPosition - 1);
  const requestedEnd = endPosition ? Math.min(sequence.length, endPosition) : sequence.length;
  const cappedEnd = Math.min(requestedEnd, startIndex + maxBases);
  const segment = sequence.slice(startIndex, cappedEnd);

  let x = 0;
  let y = 0;
  const points = [{ x, y, base: "START", position: startPosition - 1, step: 0 }];
  const counts = { A: 0, T: 0, G: 0, C: 0, ambiguous: 0, plotted: 0 };
  const entries = [];

  for (let i = 0; i < segment.length; i++) {
    const base = segment[i];
    let moved = true;

    if (base === "A") { x += 1; counts.A++; }
    else if (base === "T") { x -= 1; counts.T++; }
    else if (base === "G") { y += 1; counts.G++; }
    else if (base === "C") { y -= 1; counts.C++; }
    else {
      counts.ambiguous++;
      moved = !skipAmbiguous;
    }

    if (moved) {
      counts.plotted++;
      const point = { x, y, base, position: startPosition + i, step: counts.plotted };
      points.push(point);
      entries.push({
        x, y, base, position: startPosition + i, step: counts.plotted,
        sequenceName: record.name, seriesIndex
      });
    }
  }

  return {
    name: record.name,
    color: COLOR_PALETTE[seriesIndex % COLOR_PALETTE.length],
    points,
    entries,
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
      wasCapped: requestedEnd > cappedEnd,
      maxBases,
    },
  };
}

function handlePlot() {
  const records = getSelectedRecords();
  if (!records.length) {
    showError("Please paste or upload FASTA data and select at least one sequence.");
    return;
  }

  const start = Number(els.startPosition.value || 1);
  const end = els.endPosition.value ? Number(els.endPosition.value) : null;
  const maxBases = Number(els.maxBases.value || 50000);

  if (!Number.isFinite(start) || start < 1) {
    showError("Start position must be at least 1.");
    return;
  }
  if (end !== null && (!Number.isFinite(end) || end < start)) {
    showError("End position must be empty or greater than or equal to the start position.");
    return;
  }
  if (!Number.isFinite(maxBases) || maxBases < 100) {
    showError("Maximum bases per sequence must be at least 100.");
    return;
  }

  const validRecords = records.filter(record => start <= record.sequence.length);
  if (!validRecords.length) {
    showError("The chosen start position is beyond the length of all selected sequences.");
    return;
  }

  plottedSeries = validRecords.map((record, index) => makeWalk(
    record,
    index,
    Math.floor(start),
    end ? Math.floor(end) : null,
    Math.floor(maxBases),
    els.skipAmbiguous.checked
  ));

  buildCoordinateIndex();
  initializeView();
  drawPlot();
  updateSummary();
  setExportEnabled(true);
  els.emptyState.style.display = "none";
  els.plotSubtitle.textContent = `${plottedSeries.length} sequence${plottedSeries.length === 1 ? "" : "s"} plotted`;
}

function buildCoordinateIndex() {
  coordinateIndex = new Map();
  for (const series of plottedSeries) {
    for (const entry of series.entries) {
      const key = coordKey(entry.x, entry.y);
      if (!coordinateIndex.has(key)) coordinateIndex.set(key, []);
      coordinateIndex.get(key).push(entry);
    }
  }
}

function coordKey(x, y) {
  return `${x},${y}`;
}

function initializeView() {
  const width = els.plotWrap.clientWidth || 900;
  const height = els.plotWrap.clientHeight || 650;
  const bounds = getCombinedBounds();
  const pad = 70;
  const dataWidth = Math.max(1, bounds.maxX - bounds.minX);
  const dataHeight = Math.max(1, bounds.maxY - bounds.minY);
  const baseScale = Math.min((width - 2 * pad) / dataWidth, (height - 2 * pad) / dataHeight) || 1;

  view = {
    width,
    height,
    bounds,
    baseScale: Math.max(0.001, baseScale),
    zoom: 1,
    tx: 0,
    ty: 0,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
  };
}

function getCombinedBounds() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const series of plottedSeries) {
    for (const p of series.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  if (minX === maxX) { minX -= 1; maxX += 1; }
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const marginX = Math.max(1, (maxX - minX) * 0.04);
  const marginY = Math.max(1, (maxY - minY) * 0.04);
  return { minX: minX - marginX, maxX: maxX + marginX, minY: minY - marginY, maxY: maxY + marginY };
}

function dataToScreen(x, y) {
  const scale = view.baseScale * view.zoom;
  return {
    sx: view.width / 2 + view.tx + (x - view.centerX) * scale,
    sy: view.height / 2 + view.ty - (y - view.centerY) * scale,
  };
}

function screenToData(sx, sy) {
  const scale = view.baseScale * view.zoom;
  return {
    x: view.centerX + (sx - view.width / 2 - view.tx) / scale,
    y: view.centerY - (sy - view.height / 2 - view.ty) / scale,
  };
}

function drawPlot() {
  if (!view || !plottedSeries.length) return;

  view.width = els.plotWrap.clientWidth || view.width;
  view.height = els.plotWrap.clientHeight || view.height;

  els.plotSvg.innerHTML = "";
  els.plotSvg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);

  drawGridAndAxes();
  drawSeries();
  drawAxisLabels();
}

function drawGridAndAxes() {
  const group = svgEl("g");
  const topLeft = screenToData(0, 0);
  const bottomRight = screenToData(view.width, view.height);
  const minX = Math.min(topLeft.x, bottomRight.x);
  const maxX = Math.max(topLeft.x, bottomRight.x);
  const minY = Math.min(topLeft.y, bottomRight.y);
  const maxY = Math.max(topLeft.y, bottomRight.y);
  const step = chooseNiceStep(90 / (view.baseScale * view.zoom));

  const xStart = Math.floor(minX / step) * step;
  const xEnd = Math.ceil(maxX / step) * step;
  const yStart = Math.floor(minY / step) * step;
  const yEnd = Math.ceil(maxY / step) * step;

  for (let x = xStart; x <= xEnd; x += step) {
    const p1 = dataToScreen(x, minY);
    const p2 = dataToScreen(x, maxY);
    group.appendChild(svgEl("line", {
      x1: p1.sx, y1: p1.sy, x2: p2.sx, y2: p2.sy,
      class: Math.abs(x) < step / 1000 ? "axis-line" : "grid-line",
    }));

    if (Math.abs(x) > step / 1000) {
      const axisY = clamp(dataToScreen(0, 0).sy, 18, view.height - 8);
      group.appendChild(svgEl("text", {
        x: dataToScreen(x, 0).sx + 3,
        y: axisY - 4,
        class: "tick-label",
      }, formatTick(x)));
    }
  }

  for (let y = yStart; y <= yEnd; y += step) {
    const p1 = dataToScreen(minX, y);
    const p2 = dataToScreen(maxX, y);
    group.appendChild(svgEl("line", {
      x1: p1.sx, y1: p1.sy, x2: p2.sx, y2: p2.sy,
      class: Math.abs(y) < step / 1000 ? "axis-line" : "grid-line",
    }));

    if (Math.abs(y) > step / 1000) {
      const axisX = clamp(dataToScreen(0, 0).sx, 6, view.width - 50);
      group.appendChild(svgEl("text", {
        x: axisX + 5,
        y: dataToScreen(0, y).sy - 3,
        class: "tick-label",
      }, formatTick(y)));
    }
  }

  const origin = dataToScreen(0, 0);
  if (origin.sx >= 0 && origin.sx <= view.width && origin.sy >= 0 && origin.sy <= view.height) {
    group.appendChild(svgEl("text", {
      x: origin.sx + 5,
      y: origin.sy - 5,
      class: "tick-label",
    }, "0"));
  }

  els.plotSvg.appendChild(group);
}

function chooseNiceStep(raw) {
  const value = Math.max(1e-9, raw);
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let nice;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function formatTick(value) {
  if (Math.abs(value) >= 10000) return value.toExponential(1);
  if (Math.abs(value) >= 1) return String(Math.round(value));
  return Number(value.toPrecision(2)).toString();
}

function drawSeries() {
  const group = svgEl("g");

  for (const series of plottedSeries) {
    const pathData = series.points.map((point, index) => {
      const p = dataToScreen(point.x, point.y);
      return `${index === 0 ? "M" : "L"} ${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`;
    }).join(" ");

    group.appendChild(svgEl("path", {
      d: pathData,
      class: "trace-line",
      stroke: series.color,
      opacity: plottedSeries.length > 1 ? 0.82 : 0.95,
    }));

    const start = dataToScreen(series.points[0].x, series.points[0].y);
    const endPoint = series.points[series.points.length - 1];
    const end = dataToScreen(endPoint.x, endPoint.y);

    group.appendChild(svgEl("circle", { cx: start.sx, cy: start.sy, r: 4.5, class: "start-dot" }));
    group.appendChild(svgEl("circle", { cx: end.sx, cy: end.sy, r: 4.5, class: "end-dot" }));
  }

  hoverCircle = svgEl("circle", { cx: -999, cy: -999, r: 7, class: "hover-dot" });
  group.appendChild(hoverCircle);
  els.plotSvg.appendChild(group);
}

function drawAxisLabels() {
  els.plotSvg.appendChild(svgEl("text", { x: view.width - 16, y: view.height / 2 - 10, class: "axis-label", "text-anchor": "end" }, "+A"));
  els.plotSvg.appendChild(svgEl("text", { x: 16, y: view.height / 2 - 10, class: "axis-label" }, "+T"));
  els.plotSvg.appendChild(svgEl("text", { x: view.width / 2 + 10, y: 22, class: "axis-label" }, "+G"));
  els.plotSvg.appendChild(svgEl("text", { x: view.width / 2 + 10, y: view.height - 14, class: "axis-label" }, "+C"));
}

function updateSummary() {
  const totalSteps = plottedSeries.reduce((sum, s) => sum + s.stats.plottedBases, 0);
  const capped = plottedSeries.filter(s => s.stats.wasCapped).length;

  let html = `<dl>
    <dt>Sequences plotted</dt><dd>${plottedSeries.length.toLocaleString()}</dd>
    <dt>Total plotted steps</dt><dd>${totalSteps.toLocaleString()}</dd>
    <dt>Hovered coordinates</dt><dd>${coordinateIndex.size.toLocaleString()} unique coordinates</dd>
    ${capped ? `<dt class="warning">Capped</dt><dd class="warning">${capped} sequence${capped === 1 ? "" : "s"} reached the maximum-base limit.</dd>` : ""}
  </dl>`;

  html += `<div class="legend">`;
  for (const series of plottedSeries) {
    const gc = series.stats.counts.G + series.stats.counts.C;
    const atgc = series.stats.counts.A + series.stats.counts.T + series.stats.counts.G + series.stats.counts.C;
    const gcPercent = atgc ? (100 * gc / atgc).toFixed(1) : "0.0";
    html += `<div class="legend-item"><span class="legend-swatch" style="background:${series.color}"></span><span>${escapeHtml(series.name)} · ${series.stats.plottedBases.toLocaleString()} steps · GC ${gcPercent}% · final (${series.stats.finalX}, ${series.stats.finalY})</span></div>`;
  }
  html += `</div>`;

  els.summary.innerHTML = html;
}

function showTooltip(event) {
  if (!view || !coordinateIndex.size || dragging) return;
  const rect = els.plotSvg.getBoundingClientRect();
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;
  const data = screenToData(sx, sy);
  const nearestX = Math.round(data.x);
  const nearestY = Math.round(data.y);
  const screenNearest = dataToScreen(nearestX, nearestY);
  const pixelDistance = Math.hypot(screenNearest.sx - sx, screenNearest.sy - sy);
  const threshold = Math.max(7, Math.min(18, (view.baseScale * view.zoom) * 0.45));

  if (pixelDistance > threshold) {
    hideTooltip();
    return;
  }

  const entries = coordinateIndex.get(coordKey(nearestX, nearestY));
  if (!entries || !entries.length) {
    hideTooltip();
    return;
  }

  if (hoverCircle) {
    hoverCircle.setAttribute("cx", screenNearest.sx);
    hoverCircle.setAttribute("cy", screenNearest.sy);
  }

  const grouped = groupEntriesForTooltip(entries);
  let html = `<strong>Coordinate (${nearestX}, ${nearestY})</strong>`;
  html += `<span class="muted">${entries.length.toLocaleString()} nucleotide step${entries.length === 1 ? "" : "s"} land here</span>`;
  html += `<ul>`;
  for (const line of grouped.visibleLines) html += `<li>${line}</li>`;
  if (grouped.hiddenCount) html += `<li class="muted">…and ${grouped.hiddenCount.toLocaleString()} more</li>`;
  html += `</ul>`;

  els.tooltip.innerHTML = html;
  els.tooltip.hidden = false;
  positionTooltip(event.clientX - rect.left, event.clientY - rect.top);
}

function groupEntriesForTooltip(entries) {
  const maxLines = 10;
  const lines = entries.slice(0, maxLines).map(entry => {
    const color = plottedSeries[entry.seriesIndex]?.color || "#fff";
    return `<span style="color:${color}">●</span> ${escapeHtml(entry.sequenceName)}: pos ${entry.position.toLocaleString()}, base ${escapeHtml(entry.base)}, step ${entry.step.toLocaleString()}`;
  });
  return { visibleLines: lines, hiddenCount: Math.max(0, entries.length - maxLines) };
}

function positionTooltip(x, y) {
  const pad = 12;
  const box = els.tooltip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + box.width > els.plotWrap.clientWidth - pad) left = x - box.width - 14;
  if (top + box.height > els.plotWrap.clientHeight - pad) top = y - box.height - 14;
  els.tooltip.style.left = `${Math.max(pad, left)}px`;
  els.tooltip.style.top = `${Math.max(pad, top)}px`;
}

function hideTooltip() {
  els.tooltip.hidden = true;
  if (hoverCircle) {
    hoverCircle.setAttribute("cx", -999);
    hoverCircle.setAttribute("cy", -999);
  }
}

function setExportEnabled(enabled) {
  els.resetViewButton.disabled = !enabled;
  els.downloadSvgButton.disabled = !enabled;
  els.downloadPngButton.disabled = !enabled;
  els.downloadHtmlButton.disabled = !enabled;
  els.downloadCsvButton.disabled = !enabled;
}

function resetView() {
  if (!plottedSeries.length) return;
  initializeView();
  drawPlot();
  hideTooltip();
}

function downloadSvg() {
  const svgText = getStandaloneSvg();
  downloadBlob(svgText, "dna-sequence-walk.svg", "image/svg+xml");
}

function getStandaloneSvg() {
  const clone = els.plotSvg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  clone.insertBefore(svgEl("style", {}, `
    .axis-label{fill:#111827;font:800 13px system-ui,sans-serif}.tick-label{fill:#6b7280;font:11px system-ui,sans-serif}.grid-line{stroke:#e5e7eb;stroke-width:1}.axis-line{stroke:#111827;stroke-width:1.6}.trace-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.start-dot{fill:#16a34a;stroke:#fff;stroke-width:1.5}.end-dot{fill:#dc2626;stroke:#fff;stroke-width:1.5}.hover-dot{display:none}
  `), clone.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`;
}

async function downloadPng() {
  const svgText = getStandaloneSvg();
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.decoding = "async";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = view.width * 2;
  canvas.height = view.height * 2;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);

  canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, "dna-sequence-walk.png", "image/png");
  }, "image/png");
}

function downloadHtml() {
  const svgText = getStandaloneSvg();
  const legend = plottedSeries.map(s => `<li><span style="color:${s.color};font-weight:800">●</span> ${escapeHtml(s.name)} — ${s.stats.plottedBases.toLocaleString()} plotted steps; final (${s.stats.finalX}, ${s.stats.finalY})</li>`).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>DNA Sequence Walk Export</title>
<style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;color:#1f2937}svg{max-width:100%;height:auto;border:1px solid #d8dee9;border-radius:12px}li{margin:6px 0}</style></head>
<body>
<h1>DNA Sequence Walk Export</h1>
${svgText}
<h2>Sequences</h2>
<ul>${legend}</ul>
</body></html>`;
  downloadBlob(html, "dna-sequence-walk.html", "text/html");
}

function downloadCsv() {
  if (!plottedSeries.length) return;
  const rows = ["sequence,step,sequence_position,base,x,y"];
  for (const series of plottedSeries) {
    for (const point of series.points) {
      rows.push([series.name, point.step, point.position, point.base, point.x, point.y].map(csvEscape).join(","));
    }
  }
  downloadBlob(rows.join("\n"), "dna-sequence-walk-coordinates.csv", "text/csv");
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function clearAll() {
  els.sequenceInput.value = "";
  els.fileInput.value = "";
  els.startPosition.value = "1";
  els.endPosition.value = "";
  els.maxBases.value = "50000";
  populateRecordSelect([]);
  plottedSeries = [];
  coordinateIndex = new Map();
  view = null;
  els.plotSvg.innerHTML = "";
  els.emptyState.style.display = "grid";
  els.summary.textContent = "No sequence plotted yet.";
  els.plotSubtitle.textContent = "Paste or upload one or more sequences to begin.";
  hideTooltip();
  setExportEnabled(false);
}

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== null) node.textContent = text;
  return node;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

els.fileInput.addEventListener("change", async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const text = await file.text();
  els.sequenceInput.value = text;
  const records = parseFastaOrRaw(text);
  populateRecordSelect(records);
  if (records.length) els.summary.textContent = `Loaded ${records.length} sequence${records.length === 1 ? "" : "s"} from ${file.name}.`;
  else showError("No DNA sequence could be read from this file.");
});

els.sequenceInput.addEventListener("input", refreshRecordListFromText);
els.selectAllButton.addEventListener("click", () => [...els.recordSelect.options].forEach(o => { o.selected = true; }));
els.selectNoneButton.addEventListener("click", () => [...els.recordSelect.options].forEach(o => { o.selected = false; }));
els.plotButton.addEventListener("click", handlePlot);
els.clearButton.addEventListener("click", clearAll);
els.resetViewButton.addEventListener("click", resetView);
els.downloadSvgButton.addEventListener("click", downloadSvg);
els.downloadPngButton.addEventListener("click", downloadPng);
els.downloadHtmlButton.addEventListener("click", downloadHtml);
els.downloadCsvButton.addEventListener("click", downloadCsv);

els.plotSvg.addEventListener("wheel", event => {
  if (!view) return;
  event.preventDefault();
  const rect = els.plotSvg.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;
  const before = screenToData(mx, my);
  const zoomFactor = event.deltaY < 0 ? 1.15 : 0.87;
  view.zoom = clamp(view.zoom * zoomFactor, 0.03, 250);
  const after = screenToData(mx, my);
  const scale = view.baseScale * view.zoom;
  view.tx += (after.x - before.x) * scale;
  view.ty -= (after.y - before.y) * scale;
  drawPlot();
  showTooltip(event);
}, { passive: false });

els.plotSvg.addEventListener("pointerdown", event => {
  if (!view) return;
  dragging = true;
  dragStart = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
  els.plotSvg.classList.add("dragging");
  els.plotSvg.setPointerCapture(event.pointerId);
  hideTooltip();
});

els.plotSvg.addEventListener("pointermove", event => {
  if (!view) return;
  if (dragging && dragStart) {
    view.tx = dragStart.tx + (event.clientX - dragStart.x);
    view.ty = dragStart.ty + (event.clientY - dragStart.y);
    drawPlot();
  } else {
    showTooltip(event);
  }
});

els.plotSvg.addEventListener("pointerup", event => {
  dragging = false;
  dragStart = null;
  els.plotSvg.classList.remove("dragging");
  try { els.plotSvg.releasePointerCapture(event.pointerId); } catch {}
});

els.plotSvg.addEventListener("pointerleave", () => {
  dragging = false;
  dragStart = null;
  els.plotSvg.classList.remove("dragging");
  hideTooltip();
});

window.addEventListener("resize", () => {
  if (!plottedSeries.length || !view) return;
  const oldWidth = view.width;
  const oldHeight = view.height;
  view.width = els.plotWrap.clientWidth || oldWidth;
  view.height = els.plotWrap.clientHeight || oldHeight;
  view.tx += (view.width - oldWidth) / 2;
  view.ty += (view.height - oldHeight) / 2;
  drawPlot();
});

els.sequenceInput.value = `>Example_AT_rich
ATATATATATATATATATATATATTTTTAAAATATATATATATATATAT
>Example_GC_rich
GCGCGCGCGCGCGCGCGGGGCCCCGCGCGCGCGCGCGCGCGCGC
>Example_mixed
ATGCGTACGATCGATCGGGATATATCCCGCGTATATGGCCATGC`;
populateRecordSelect(parseFastaOrRaw(els.sequenceInput.value));
