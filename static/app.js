const palette = {
  bgp: "#78a9ff",
  "ping-slash24": "#61d6c5",
  "merit-nt": "#f0bd70"
};

let chart;
const rangeSelect = document.querySelector("#time-range");
const refreshButton = document.querySelector("#refresh");
const metrics = document.querySelector("#metrics");
const toast = document.querySelector("#toast");

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatTime(timestamp) {
  if (!timestamp) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC"
  }).format(new Date(timestamp * 1000)) + " UTC";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function renderMetrics(data) {
  if (!data.series.length) {
    metrics.innerHTML = '<div class="metric-card"><strong>Measurements unavailable</strong><p class="metric-description">The provider did not return usable observations. Try refreshing in a moment.</p></div>';
    return;
  }
  metrics.innerHTML = data.series.map((item) => {
    const isAvailable = item.status === "available";
    return `
      <article class="metric-card">
        <div class="metric-top">
          <span class="metric-label">${item.label}</span>
          <span class="status-pill ${isAvailable ? "" : "error"}">${isAvailable ? "Data available" : "No data"}</span>
        </div>
        <div class="metric-value">${item.latest === null ? "—" : formatNumber(item.latest)}</div>
        <div class="metric-unit">${item.unit}</div>
        <p class="metric-description">${item.description}</p>
        <div class="metric-foot"><span>${item.observations} observations</span><span>Latest: ${formatTime(item.latest_at)}</span></div>
      </article>`;
  }).join("");
}

function renderChart(data) {
  const available = data.series.filter(item => item.points.length);
  const ctx = document.querySelector("#signals-chart");
  if (chart) chart.destroy();

  if (!available.length || typeof Chart === "undefined") {
    document.querySelector(".chart-wrap").innerHTML = '<p class="section-subtitle">Chart unavailable. Measurement cards may still contain the latest values.</p>';
    return;
  }

  chart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: available.map(item => ({
        label: item.label,
        data: item.points.filter(point => point.value !== null).map(point => ({
          x: point.timestamp * 1000,
          y: point.value
        })),
        borderColor: palette[item.id],
        backgroundColor: palette[item.id],
        borderWidth: 1.8,
        pointRadius: 0,
        pointHitRadius: 8,
        tension: .22
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a2a40",
          borderColor: "#344a65",
          borderWidth: 1,
          titleColor: "#dce7f3",
          bodyColor: "#b9c9db",
          callbacks: { label: context => ` ${context.dataset.label}: ${formatNumber(context.parsed.y)}` }
        }
      },
      scales: {
        x: {
          type: "time",
          time: { tooltipFormat: "dd MMM yyyy, HH:mm" },
          grid: { color: "rgba(145,162,185,.08)" },
          ticks: { color: "#7589a3", maxTicksLimit: 7, font: { size: 9 } }
        },
        y: {
          grid: { color: "rgba(145,162,185,.08)" },
          ticks: { color: "#7589a3", maxTicksLimit: 5, font: { size: 9 } }
        }
      }
    }
  });

  document.querySelector("#chart-legend").innerHTML = available.map(item => `
    <span class="legend-item"><i class="legend-dot" style="background:${palette[item.id]}"></i>${item.label}</span>
  `).join("");
}

function renderFeed(data) {
  const states = {
    available: ["Measurements updated", "All configured IODA measurement sources returned data."],
    partial: ["Partial measurements", "Some sources returned data; at least one source is unavailable."],
    unavailable: ["Provider unavailable", "No configured measurement source returned usable data."]
  };
  const [title, description] = states[data.feed_status];
  document.querySelector("#feed-title").textContent = title;
  document.querySelector("#feed-description").textContent = description;
  document.querySelector("#feed-icon").textContent = data.feed_status === "available" ? "✓" : "!";
  document.querySelector("#feed-time").textContent = `Updated ${formatTime(Date.parse(data.generated_at) / 1000)}`;
  document.querySelector("#updated-at").textContent = `Last checked ${formatTime(Date.parse(data.generated_at) / 1000)}`;
  document.querySelector("#method-note").textContent = data.notice;
}

async function loadDashboard(force = false) {
  refreshButton.disabled = true;
  refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Loading';
  try {
    const params = new URLSearchParams({ hours: rangeSelect.value });
    if (force) params.set("refresh", "true");
    const response = await fetch(`/api/dashboard?${params.toString()}`);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = await response.json();
    renderFeed(data);
    renderMetrics(data);
    renderChart(data);
    if (data.errors.length) showToast(`${data.errors.length} source(s) could not be loaded.`);
  } catch (error) {
    document.querySelector("#feed-title").textContent = "Could not load measurements";
    document.querySelector("#feed-description").textContent = error.message;
    document.querySelector("#feed-icon").textContent = "!";
    showToast("Could not reach the NetGuard API.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Refresh';
  }
}

rangeSelect.addEventListener("change", () => loadDashboard());
refreshButton.addEventListener("click", () => loadDashboard(true));
loadDashboard();
