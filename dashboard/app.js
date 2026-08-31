function fmtPct(x) {
  return (x * 100).toFixed(1) + "%";
}

function fmtNum(x) {
  return new Intl.NumberFormat("en-US").format(x);
}

function renderSummary(summary) {
  const el = document.getElementById("summary");
  el.innerHTML = "";
  const cards = [
    { label: "files", value: fmtNum(summary.file_count) },
    { label: "original tokens", value: fmtNum(summary.total_original_tokens) },
    { label: "result tokens", value: fmtNum(summary.total_result_tokens) },
    { label: "overall savings", value: fmtPct(summary.overall_savings_ratio), good: true },
  ];
  for (const card of cards) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML =
      '<div class="value' + (card.good ? " good" : "") + '">' + card.value + "</div>" +
      '<div class="label">' + card.label + "</div>";
    el.appendChild(div);
  }
}

function renderByType(byType) {
  const el = document.getElementById("by-type");
  el.innerHTML = "";
  const entries = Object.entries(byType).sort((a, b) => b[1].savings_ratio - a[1].savings_ratio);
  for (const [name, bucket] of entries) {
    const row = document.createElement("div");
    row.className = "type-row";
    const pct = Math.max(0, Math.min(1, bucket.savings_ratio));
    row.innerHTML =
      '<div class="name">' + name + "</div>" +
      '<div class="bar-track"><div class="bar-fill" style="width:' + (pct * 100) + '%"></div></div>' +
      '<div class="pct">' + fmtPct(bucket.savings_ratio) + "</div>";
    el.appendChild(row);
  }
}

function renderRows(rows) {
  const tbody = document.querySelector("#rows-table tbody");
  tbody.innerHTML = "";
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + row.name + "</td>" +
      "<td>" + row.content_type + "</td>" +
      "<td>" + row.level + "</td>" +
      "<td>" + row.method + "</td>" +
      '<td class="num">' + fmtNum(row.original_tokens) + "</td>" +
      '<td class="num">' + fmtNum(row.result_tokens) + "</td>" +
      '<td class="num">' + fmtPct(row.savings_ratio) + "</td>";
    tbody.appendChild(tr);
  }
}

async function loadMetrics() {
  const res = await fetch("/api/metrics", { cache: "no-store" });
  const data = await res.json();
  renderSummary(data.summary);
  renderByType(data.summary.by_content_type);
  renderRows(data.rows);
  const generated = data.generated_at ? new Date(data.generated_at * 1000) : null;
  document.getElementById("generated-at").textContent = generated ? generated.toLocaleString() : "-";
}

document.getElementById("refresh").addEventListener("click", loadMetrics);
loadMetrics();