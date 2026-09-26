/**
 * Adobe Tracker Pro — Live Cloud Scraper Engine
 * Anti-Bot Bypass with Apify Proxy
 */

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR_ID = "kawsar~adobe-stock-scraper";
const DB_NAME = "AdobeTrackerProDB";
const STORE_NAME = "savedSearches";

// Global Application State (Live Real Data Only)
const state = {
  tokens: [],
  activeToken: "",
  rawItems: [],
  filteredItems: [],
  currentPage: 1,
  itemsPerPage: 24,
  activeRunId: null,
  pollTimer: null,
  currentModalIndex: 0,
  layout: "grid",
  db: null
};

// DOM Helper
const $ = (id) => document.getElementById(id);

/* ==========================================================
   Initialization
   ========================================================== */
document.addEventListener("DOMContentLoaded", () => {
  initDB();
  loadSavedTokens();
  setupKeyboardNav();
});

// Setup Keyboard Navigation for modal & ESC
function setupKeyboardNav() {
  document.addEventListener("keydown", (e) => {
    const modal = $("assetModal");
    if (!modal.classList.contains("open")) return;
    if (e.key === "Escape") closeAssetModal();
    if (e.key === "ArrowLeft") stepAsset(-1);
    if (e.key === "ArrowRight") stepAsset(1);
  });
}

/* ==========================================================
   Token Management
   ========================================================== */
function loadSavedTokens() {
  try {
    const raw = localStorage.getItem("adobe_tracker_tokens");
    if (raw) {
      state.tokens = JSON.parse(raw);
      const active = state.tokens.find(t => t.valid !== false && t.value);
      state.activeToken = active ? active.value : (state.tokens[0]?.value || "");
    }
  } catch (err) {
    console.error("Error reading tokens from storage", err);
    state.tokens = [];
  }
  updateHeaderTokenIndicator();
}

function updateHeaderTokenIndicator() {
  const indicator = $("headerKeyIndicator");
  const text = $("tokenStatusText");
  if (state.activeToken) {
    indicator.className = "status-indicator ready";
    text.textContent = `Apify Ready (${state.activeToken.substring(0, 10)}…)`;
  } else {
    indicator.className = "status-indicator";
    text.textContent = "Connect Apify Token";
  }
}

function openTokenModal() {
  renderTokenRows();
  $("tokenModal").classList.add("open");
}

function closeTokenModal() {
  $("tokenModal").classList.remove("open");
}

function renderTokenRows() {
  const list = $("tokenInputsList");
  list.innerHTML = "";

  if (state.tokens.length === 0) {
    state.tokens.push({ value: "", valid: null });
  }

  state.tokens.forEach((t, idx) => {
    const row = document.createElement("div");
    row.className = "token-row";
    
    let statusClass = "testing";
    let statusText = "Untested";
    if (t.valid === true) {
      statusClass = "valid";
      statusText = "✓ Valid";
    } else if (t.valid === false) {
      statusClass = "invalid";
      statusText = "✕ Invalid";
    }

    row.innerHTML = `
      <input type="text" class="token-val-input" placeholder="apify_api_xxxxxxxxxxxxxxxxxxxx" value="${escapeHtml(t.value || '')}" onchange="updateTokenVal(${idx}, this.value)">
      <span class="token-status-pill ${statusClass}" id="tokenStatusPill_${idx}">${statusText}</span>
      <button type="button" class="btn-remove-row" onclick="removeTokenRow(${idx})" title="Remove">✕</button>
    `;
    list.appendChild(row);
  });
}

function addNewTokenRow() {
  state.tokens.push({ value: "", valid: null });
  renderTokenRows();
}

function removeTokenRow(idx) {
  state.tokens.splice(idx, 1);
  if (state.tokens.length === 0) state.tokens.push({ value: "", valid: null });
  renderTokenRows();
}

function updateTokenVal(idx, val) {
  if (state.tokens[idx]) {
    state.tokens[idx].value = val.trim();
    state.tokens[idx].valid = null;
  }
}

async function testActiveTokens() {
  const inputs = document.querySelectorAll(".token-val-input");
  inputs.forEach((inp, i) => {
    if (state.tokens[i]) state.tokens[i].value = inp.value.trim();
  });

  for (let i = 0; i < state.tokens.length; i++) {
    const t = state.tokens[i];
    const pill = $(`tokenStatusPill_${i}`);
    if (!t.value) {
      if (pill) { pill.className = "token-status-pill invalid"; pill.textContent = "Empty"; }
      continue;
    }

    if (pill) { pill.className = "token-status-pill testing"; pill.textContent = "Testing…"; }
    try {
      const res = await fetch(`${APIFY_BASE}/users/me?token=${encodeURIComponent(t.value)}`);
      if (res.ok) {
        t.valid = true;
        if (pill) { pill.className = "token-status-pill valid"; pill.textContent = "✓ Valid"; }
      } else {
        t.valid = false;
        if (pill) { pill.className = "token-status-pill invalid"; pill.textContent = "✕ Invalid"; }
      }
    } catch {
      t.valid = false;
      if (pill) { pill.className = "token-status-pill invalid"; pill.textContent = "✕ Network Err"; }
    }
  }
}

function saveTokensFromModal() {
  const inputs = document.querySelectorAll(".token-val-input");
  inputs.forEach((inp, i) => {
    if (state.tokens[i]) state.tokens[i].value = inp.value.trim();
  });

  state.tokens = state.tokens.filter(t => t.value !== "");
  localStorage.setItem("adobe_tracker_tokens", JSON.stringify(state.tokens));

  const validToken = state.tokens.find(t => t.valid === true) || state.tokens[0];
  state.activeToken = validToken ? validToken.value : "";

  updateHeaderTokenIndicator();
  closeTokenModal();
  showToast("Apify token saved & active", "success");
}

/* ==========================================================
   Live Search & Real Extraction Execution
   ========================================================== */
function quickSearch(keyword) {
  $("searchQuery").value = keyword;
  $("clearSearchBtn").style.display = "block";
  handleAnalyzeSubmit(new Event("submit"));
}

function clearSearchInput() {
  $("searchQuery").value = "";
  $("clearSearchBtn").style.display = "none";
}

$("searchQuery").addEventListener("input", (e) => {
  $("clearSearchBtn").style.display = e.target.value ? "block" : "none";
});

function updateRangeVal(val) {
  $("maxItemsVal").textContent = `${val} items`;
}

async function handleAnalyzeSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  const query = $("searchQuery").value.trim();
  const assetType = $("assetTypeSelect").value;
  const order = $("orderSelect").value;
  const aiFilter = $("aiFilterSelect").value;
  const maxItems = parseInt($("maxItemsRange").value, 10) || 50;

  if (!state.activeToken) {
    showToast("Please enter your Apify API Token to run live queries", "error");
    openTokenModal();
    return;
  }

  $("activeQueryTitle").textContent = query ? `Live Market: "${query}"` : "General Adobe Stock Live Trends";
  $("activeQuerySubtitle").textContent = `Category: ${assetType.toUpperCase()} • Sorting: ${order} • AI Filter: ${aiFilter} • Via Apify Proxy`;

  await executeLiveApifyScraper({ query, assetType, order, aiFilter, maxItems });
}

/* ==========================================================
   Live Cloud Scraper Execution
   Using Anti-Bot Apify Proxy (proxyConfiguration: { useApifyProxy: true })
   ========================================================== */
async function executeLiveApifyScraper({ query, assetType, order, aiFilter, maxItems }) {
  setScraperRunning(true);
  updateRunStatus("Starting Cloud Scraper...", "Connecting to Apify Proxy Engine...", 10);

  // Exact payload required by scraper engine
  const payload = {
    assetType: assetType || "all",
    order: order || "downloads",
    aiFilter: aiFilter || "all",
    maxItems: maxItems || 50,
    proxyConfiguration: { useApifyProxy: true }
  };
  if (query) payload.query = query;

  try {
    // Step 1: Start Actor Run on Apify Cloud
    const runRes = await fetch(`${APIFY_BASE}/actors/${ACTOR_ID}/runs?token=${encodeURIComponent(state.activeToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!runRes.ok) {
      const errData = await runRes.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${runRes.status}: Failed to start scraper.`);
    }

    const runData = await runRes.json();
    state.activeRunId = runData.data?.id;
    const datasetId = runData.data?.defaultDatasetId;

    if (!state.activeRunId || !datasetId) {
      throw new Error("Invalid response from Apify: Missing run or dataset ID.");
    }

    updateRunStatus("Scraping Live Adobe Stock...", "Bypassing Cloudflare via Apify Proxy & extracting records...", 25);

    // Step 2: Poll Actor Status & Stream Real Dataset Items
    let startTime = Date.now();

    state.pollTimer = setInterval(async () => {
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
      $("runTimeElapsed").textContent = `${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(elapsedSec % 60).padStart(2, '0')}`;

      try {
        const checkRes = await fetch(`${APIFY_BASE}/actor-runs/${state.activeRunId}?token=${encodeURIComponent(state.activeToken)}`);
        const checkData = await checkRes.json();
        const runStatus = checkData?.data?.status;

        // Fetch dataset items collected so far
        const itemsRes = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${encodeURIComponent(state.activeToken)}&format=json&clean=true`);
        if (itemsRes.ok) {
          const items = await itemsRes.json();
          if (Array.isArray(items) && items.length > 0) {
            state.rawItems = items;
            applyFiltersAndSort();
            const pct = Math.min(95, Math.round((items.length / maxItems) * 80) + 15);
            updateRunStatus(`Extracted ${items.length} Real Assets`, "Streaming verified market data...", pct);
          }
        }

        if (runStatus === "SUCCEEDED") {
          clearInterval(state.pollTimer);
          updateRunStatus("Extraction Complete!", `Collected ${state.rawItems.length} real assets from Adobe Stock.`, 100);
          setTimeout(() => setScraperRunning(false), 800);
          showToast(`Successfully extracted ${state.rawItems.length} live assets!`, "success");
        } else if (runStatus === "FAILED" || runStatus === "ABORTED" || runStatus === "TIMED-OUT") {
          clearInterval(state.pollTimer);
          setScraperRunning(false);
          const errorMsg = checkData?.data?.statusMessage || `Actor run ended with status: ${runStatus}`;
          showToast(errorMsg, "error");
        }
      } catch (pollErr) {
        console.warn("Polling retry error:", pollErr);
      }
    }, 2500);

  } catch (err) {
    setScraperRunning(false);
    showToast(err.message, "error");
    console.error("Scraper execution error:", err);
  }
}

function stopCurrentRun() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.activeRunId && state.activeToken) {
    fetch(`${APIFY_BASE}/actor-runs/${state.activeRunId}/abort?token=${encodeURIComponent(state.activeToken)}`, {
      method: "POST"
    }).catch(console.error);
  }
  setScraperRunning(false);
  showToast("Extraction cancelled", "info");
}

function setScraperRunning(isRunning) {
  $("analyzeBtn").disabled = isRunning;
  $("stopRunBtn").style.display = isRunning ? "flex" : "none";
  $("runStatusCard").style.display = isRunning ? "flex" : "none";
}

function updateRunStatus(title, subtext, pct) {
  $("runStepTitle").textContent = title;
  $("runSubtext").textContent = subtext;
  $("runPct").textContent = `${pct}%`;
  $("progressBarFill").style.width = `${pct}%`;
}

/* ==========================================================
   Analytics Engine & Calculations
   ========================================================== */
function updateAnalytics(items) {
  if (!items || items.length === 0) {
    $("kpiAssets").textContent = "0";
    $("kpiDownloads").textContent = "0";
    $("kpiViews").textContent = "0";
    $("kpiMedian").textContent = "0";
    $("kpiOpportunity").textContent = "0";
    $("scoreCircleFill").setAttribute("stroke-dasharray", "0, 100");
    $("insightsBar").style.display = "none";
    $("exportCsvBtn").disabled = true;
    $("exportJsonBtn").disabled = true;
    $("saveLibraryBtn").disabled = true;
    return;
  }

  $("exportCsvBtn").disabled = false;
  $("exportJsonBtn").disabled = false;
  $("saveLibraryBtn").disabled = false;

  const totalAssets = items.length;
  const downloadsList = items.map(it => getDownloadCount(it)).filter(d => d !== null);
  const viewsList = items.map(it => getViewCount(it)).filter(v => v !== null);

  const totalDownloads = downloadsList.reduce((acc, curr) => acc + curr, 0);
  const totalViews = viewsList.reduce((acc, curr) => acc + curr, 0);
  const medianDownloads = calculateMedian(downloadsList);

  // Opportunity Score calculation
  let oppScore = 50;
  if (totalAssets > 0 && totalDownloads > 0) {
    const highPerformers = downloadsList.filter(d => d > (medianDownloads || 0)).length;
    const demandVelocity = Math.min(50, Math.round(Math.log10(totalDownloads + 1) * 12));
    const consistency = Math.round((highPerformers / totalAssets) * 50);
    oppScore = Math.min(99, Math.max(15, demandVelocity + consistency));
  }

  // Update KPI Cards
  $("kpiAssets").textContent = formatNumber(totalAssets);
  $("kpiDownloads").textContent = formatNumber(totalDownloads);
  $("kpiViews").textContent = formatNumber(totalViews);
  $("kpiMedian").textContent = formatNumber(medianDownloads || 0);
  $("kpiOpportunity").textContent = oppScore;

  // Update Opportunity Circle Gauge
  $("scoreCircleFill").setAttribute("stroke-dasharray", `${oppScore}, 100`);
  const ratingTag = $("scoreRatingText");
  if (oppScore >= 75) {
    ratingTag.textContent = "High Opportunity 🔥";
    ratingTag.style.color = "var(--accent-emerald)";
    $("scoreCircleFill").style.stroke = "var(--accent-emerald)";
  } else if (oppScore >= 50) {
    ratingTag.textContent = "Moderate Potential ⭐";
    ratingTag.style.color = "var(--accent-cyan)";
    $("scoreCircleFill").style.stroke = "var(--accent-cyan)";
  } else {
    ratingTag.textContent = "Saturated Niche ⚠️";
    ratingTag.style.color = "var(--accent-amber)";
    $("scoreCircleFill").style.stroke = "var(--accent-amber)";
  }

  // AI Saturation & Trending Insights
  const aiCount = items.filter(it => isAiItem(it)).length;
  const aiPct = Math.round((aiCount / totalAssets) * 100);
  $("aiSaturationBar").style.width = `${aiPct}%`;
  $("aiSaturationText").textContent = `${aiPct}% (${aiCount}/${totalAssets})`;

  // Top Creator
  const creatorMap = {};
  items.forEach(it => {
    const name = getCreatorName(it);
    if (!creatorMap[name]) creatorMap[name] = { count: 0, downloads: 0 };
    creatorMap[name].count++;
    creatorMap[name].downloads += getDownloadCount(it) || 0;
  });
  const sortedCreators = Object.entries(creatorMap).sort((a, b) => b[1].downloads - a[1].downloads);
  const topCreator = sortedCreators[0];
  $("topCreatorTag").textContent = topCreator ? `${topCreator[0]} (${formatNumber(topCreator[1].downloads)} dl)` : "—";

  const highPerformersCount = downloadsList.filter(d => d > (medianDownloads || 0)).length;
  $("highPerformerRatio").textContent = `${Math.round((highPerformersCount / totalAssets) * 100)}% beats median`;
  $("insightsBar").style.display = "flex";

  // Build Analytics Charts
  renderDownloadDistributionChart(downloadsList);
  renderAiCompositionChart(aiCount, totalAssets - aiCount);
  renderMediaTypeChart(items);
  renderKeywordCloud(items);
  renderTopCreatorsTable(sortedCreators);
}

/* ==========================================================
   Visual Analytics Charts Renderers
   ========================================================== */
function renderDownloadDistributionChart(list) {
  const container = $("downloadDistChart");
  container.innerHTML = "";

  const brackets = [
    { label: "0 - 100", count: 0, color: "#64748b" },
    { label: "101 - 500", count: 0, color: "#06b6d4" },
    { label: "501 - 1,000", count: 0, color: "#6366f1" },
    { label: "1,001 - 5,000", count: 0, color: "#a855f7" },
    { label: "5,000+", count: 0, color: "#ec4899" }
  ];

  list.forEach(val => {
    if (val <= 100) brackets[0].count++;
    else if (val <= 500) brackets[1].count++;
    else if (val <= 1000) brackets[2].count++;
    else if (val <= 5000) brackets[3].count++;
    else brackets[4].count++;
  });

  const maxBracket = Math.max(...brackets.map(b => b.count), 1);

  brackets.forEach(b => {
    const pct = Math.round((b.count / maxBracket) * 100);
    const row = document.createElement("div");
    row.className = "chart-bar-row";
    row.innerHTML = `
      <span class="chart-bar-label">${b.label}</span>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width: ${pct}%; background: ${b.color};"></div>
      </div>
      <span class="chart-bar-val">${b.count}</span>
    `;
    container.appendChild(row);
  });
}

function renderAiCompositionChart(aiCount, humanCount) {
  const container = $("aiCompositionChart");
  container.innerHTML = "";

  const total = aiCount + humanCount || 1;
  const aiPct = Math.round((aiCount / total) * 100);
  const humanPct = Math.round((humanCount / total) * 100);

  const row1 = document.createElement("div");
  row1.className = "chart-bar-row";
  row1.innerHTML = `
    <span class="chart-bar-label">Generative AI</span>
    <div class="chart-bar-track">
      <div class="chart-bar-fill" style="width: ${aiPct}%; background: #ea580c;"></div>
    </div>
    <span class="chart-bar-val">${aiPct}%</span>
  `;

  const row2 = document.createElement("div");
  row2.className = "chart-bar-row";
  row2.innerHTML = `
    <span class="chart-bar-label">Human Verified</span>
    <div class="chart-bar-track">
      <div class="chart-bar-fill" style="width: ${humanPct}%; background: #10b981;"></div>
    </div>
    <span class="chart-bar-val">${humanPct}%</span>
  `;

  container.appendChild(row1);
  container.appendChild(row2);
}

function renderMediaTypeChart(items) {
  const container = $("mediaTypeChart");
  container.innerHTML = "";

  const typeCounts = {};
  items.forEach(it => {
    const t = getAssetType(it);
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  const maxCount = Math.max(...Object.values(typeCounts), 1);

  Object.entries(typeCounts).forEach(([type, count]) => {
    const pct = Math.round((count / maxCount) * 100);
    const row = document.createElement("div");
    row.className = "chart-bar-row";
    row.innerHTML = `
      <span class="chart-bar-label" style="text-transform: capitalize;">${type}</span>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width: ${pct}%; background: #8b5cf6;"></div>
      </div>
      <span class="chart-bar-val">${count}</span>
    `;
    container.appendChild(row);
  });
}

function renderKeywordCloud(items) {
  const container = $("tagCloudContainer");
  container.innerHTML = "";

  const freq = {};
  items.forEach(it => {
    const kwList = extractKeywords(it);
    kwList.forEach(k => {
      const clean = String(k).trim().toLowerCase();
      if (clean.length > 2) freq[clean] = (freq[clean] || 0) + 1;
    });
  });

  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 32);

  if (sorted.length === 0) {
    container.innerHTML = `<span style="color:var(--text-muted);font-size:12px;">No keywords found in asset batch.</span>`;
    return;
  }

  sorted.forEach(([word, count]) => {
    const tag = document.createElement("span");
    tag.className = "tag-cloud-item";
    tag.innerHTML = `
      <span>${escapeHtml(word)}</span>
      <span class="tag-freq-count">${count}</span>
    `;
    tag.onclick = () => {
      quickSearch(word);
    };
    container.appendChild(tag);
  });
}

function renderTopCreatorsTable(sortedCreators) {
  const tbody = $("creatorsTableBody");
  tbody.innerHTML = "";

  sortedCreators.slice(0, 10).forEach(([creatorName, meta], idx) => {
    const rank = idx + 1;
    let rankBadgeClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-other";
    const avgDl = Math.round(meta.downloads / meta.count);
    const portfolioUrl = `https://stock.adobe.com/search?creator=${encodeURIComponent(creatorName)}`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="rank-pill ${rankBadgeClass}">${rank}</span></td>
      <td><strong>${escapeHtml(creatorName)}</strong></td>
      <td>${meta.count}</td>
      <td><span class="stat-highlight">${formatNumber(meta.downloads)}</span></td>
      <td>${formatNumber(avgDl)}</td>
      <td><a href="${portfolioUrl}" target="_blank" rel="noopener noreferrer" class="btn-portfolio-link">Portfolio ↗</a></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================================
   Results Grid & Layout Rendering
   ========================================================== */
function applyFiltersAndSort() {
  const typeFilter = $("localTypeFilter").value;
  const aiFilter = $("localAiFilter").value;
  const sortMode = $("localSortSelect").value;

  let items = [...state.rawItems];

  // Local Type Filter
  if (typeFilter !== "all") {
    items = items.filter(it => getAssetType(it).toLowerCase().includes(typeFilter));
  }

  // Local AI Filter
  if (aiFilter === "ai") {
    items = items.filter(it => isAiItem(it));
  } else if (aiFilter === "human") {
    items = items.filter(it => !isAiItem(it));
  }

  // Sort
  items.sort((a, b) => {
    if (sortMode === "downloads") return (getDownloadCount(b) || 0) - (getDownloadCount(a) || 0);
    if (sortMode === "views") return (getViewCount(b) || 0) - (getViewCount(a) || 0);
    if (sortMode === "score") return calculateScore(b) - calculateScore(a);
    if (sortMode === "newest") return getCreatedTime(b) - getCreatedTime(a);
    if (sortMode === "oldest") return getCreatedTime(a) - getCreatedTime(b);
    return 0;
  });

  state.filteredItems = items;
  state.currentPage = 1;

  $("resultsCount").textContent = items.length;
  updateAnalytics(state.filteredItems);
  renderResultsPage();
}

function renderResultsPage() {
  const grid = $("assetsGrid");
  const items = state.filteredItems;
  const medianDownloads = calculateMedian(items.map(it => getDownloadCount(it)).filter(d => d !== null));

  if (!items || items.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚡</div>
        <h3>Ready for Live Market Extraction</h3>
        <p>Enter any keyword or category in the sidebar, verify your Apify API key, and click <strong>Analyze Market</strong> to scrape real-time data directly from Adobe Stock using Apify Proxy.</p>
        <button class="btn-demo-trigger" onclick="openTokenModal()">
          <span>🔑</span> Configure Apify API Token
        </button>
      </div>
    `;
    $("paginationBar").style.display = "none";
    return;
  }

  const totalPages = Math.ceil(items.length / state.itemsPerPage);
  const startIdx = (state.currentPage - 1) * state.itemsPerPage;
  const pageItems = items.slice(startIdx, startIdx + state.itemsPerPage);

  grid.innerHTML = pageItems.map((item, idx) => {
    const globalIdx = startIdx + idx;
    const title = getTitle(item);
    const imgUrl = getImageUrl(item);
    const assetType = getAssetType(item);
    const isAi = isAiItem(item);
    const downloads = getDownloadCount(item);
    const views = getViewCount(item);
    const creator = getCreatorName(item);
    const score = calculateScore(item);
    const isHot = downloads > (medianDownloads * 1.5);

    return `
      <div class="asset-card" onclick="openAssetModal(${globalIdx})">
        <div class="card-thumb-wrap">
          <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80'">
          <div class="card-badges">
            <span class="badge-pill badge-${assetType}">${assetType}</span>
            <span class="badge-pill ${isAi ? 'badge-ai' : 'badge-human'}">${isAi ? 'AI Gen' : 'Human'}</span>
          </div>
          <div class="score-badge ${score >= 70 ? 'high' : 'medium'}">
            ★ ${score}
          </div>
        </div>

        <div class="card-body">
          <h4 class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</h4>
          <div class="card-creator-row">
            <span class="card-creator">👤 ${escapeHtml(creator)}</span>
          </div>
          <div class="card-stats-row">
            <span class="stat-item ${isHot ? 'stat-hot' : 'stat-highlight'}">
              ${isHot ? '🔥' : '⬇'} ${formatNumber(downloads)} dl
            </span>
            <span class="stat-item">
              👁 ${formatNumber(views)} views
            </span>
          </div>
        </div>
      </div>
    `;
  }).join("");

  renderPagination(items.length, totalPages);
}

function renderPagination(totalItems, totalPages) {
  const bar = $("paginationBar");
  if (totalPages <= 1) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";

  const start = (state.currentPage - 1) * state.itemsPerPage + 1;
  const end = Math.min(totalItems, state.currentPage * state.itemsPerPage);
  $("pageInfoText").textContent = `Showing ${start}-${end} of ${totalItems} assets`;

  const btnContainer = $("pageButtonsContainer");
  btnContainer.innerHTML = "";

  const prevBtn = document.createElement("button");
  prevBtn.className = "pbtn";
  prevBtn.textContent = "← Prev";
  prevBtn.disabled = state.currentPage === 1;
  prevBtn.onclick = () => { state.currentPage--; renderResultsPage(); window.scrollTo({ top: 350, behavior: 'smooth' }); };
  btnContainer.appendChild(prevBtn);

  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= state.currentPage - 1 && p <= state.currentPage + 1)) {
      const pbtn = document.createElement("button");
      pbtn.className = `pbtn ${p === state.currentPage ? 'active' : ''}`;
      pbtn.textContent = p;
      pbtn.onclick = () => { state.currentPage = p; renderResultsPage(); window.scrollTo({ top: 350, behavior: 'smooth' }); };
      btnContainer.appendChild(pbtn);
    }
  }

  const nextBtn = document.createElement("button");
  nextBtn.className = "pbtn";
  nextBtn.textContent = "Next →";
  nextBtn.disabled = state.currentPage === totalPages;
  nextBtn.onclick = () => { state.currentPage++; renderResultsPage(); window.scrollTo({ top: 350, behavior: 'smooth' }); };
  btnContainer.appendChild(nextBtn);
}

function setLayout(layout) {
  state.layout = layout;
  $("layoutGridBtn").classList.toggle("active", layout === "grid");
  $("layoutListBtn").classList.toggle("active", layout === "list");
  $("assetsGrid").classList.toggle("list-layout", layout === "list");
}

function switchResultTab(tab) {
  $("tabGridBtn").classList.toggle("active", tab === "grid");
  $("tabAnalyticsBtn").classList.toggle("active", tab === "analytics");
  $("tabCreatorsBtn").classList.toggle("active", tab === "creators");

  $("tabGridContent").style.display = tab === "grid" ? "block" : "none";
  $("tabAnalyticsContent").style.display = tab === "analytics" ? "block" : "none";
  $("tabCreatorsContent").style.display = tab === "creators" ? "block" : "none";
}

/* ==========================================================
   Asset Inspector & Lightbox Modal with Plain Text Copy
   ========================================================== */
function extractKeywords(item) {
  if (!item) return [];
  const candidates = [
    item.keywords,
    item.tags,
    item.keyword_list,
    item.tag_list,
    item.search_terms,
    item.searchTerms,
    item.asset_keywords
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c.map(k => typeof k === "string" ? k.trim() : (k.name || k.title || k.keyword || "")).filter(Boolean);
    }
    if (typeof c === "string" && c.trim()) {
      if (c.includes(",")) return c.split(",").map(s => s.trim()).filter(Boolean);
      if (c.includes(";")) return c.split(";").map(s => s.trim()).filter(Boolean);
      return c.split(/\s+/).map(s => s.trim()).filter(Boolean);
    }
  }

  // Fallback: If scraper does not return explicit keyword array, generate tags from title words!
  const title = getTitle(item);
  if (title) {
    const stopWords = new Set(["a", "an", "the", "and", "or", "in", "on", "at", "for", "with", "by", "of", "to", "is", "it", "different", "illustration", "vector", "stock", "adobe"]);
    const words = title.toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
    if (words.length > 0) {
      return [...new Set(words)];
    }
  }
  return [];
}

function copyAssetTitle() {
  const item = state.filteredItems[state.currentModalIndex];
  if (!item) return;
  const title = getTitle(item);
  navigator.clipboard.writeText(title).then(() => {
    showToast(`✓ Title copied: "${title.substring(0, 35)}..."`, "success");
  });
}

function copyKeywordsComma() {
  const item = state.filteredItems[state.currentModalIndex];
  if (!item) return;
  const kws = extractKeywords(item);
  if (kws.length === 0) {
    showToast("No keywords found to copy", "info");
    return;
  }
  const text = kws.join(", ");
  navigator.clipboard.writeText(text).then(() => {
    showToast(`✓ Copied ${kws.length} keywords (comma-separated plain text)!`, "success");
  });
}

function copyKeywordsSpace() {
  const item = state.filteredItems[state.currentModalIndex];
  if (!item) return;
  const kws = extractKeywords(item);
  if (kws.length === 0) {
    showToast("No keywords found to copy", "info");
    return;
  }
  const text = kws.join(" ");
  navigator.clipboard.writeText(text).then(() => {
    showToast(`✓ Copied ${kws.length} keywords (space-separated plain text)!`, "success");
  });
}

function copyAssetId() {
  const item = state.filteredItems[state.currentModalIndex];
  if (!item) return;
  const id = String(item.id || item.assetId || "");
  if (!id) return;
  navigator.clipboard.writeText(id).then(() => {
    showToast(`✓ Asset ID #${id} copied!`, "success");
  });
}

function copySingleKeyword(kw) {
  navigator.clipboard.writeText(kw).then(() => {
    showToast(`✓ Keyword copied: "${kw}"`, "success");
  });
}

function openAssetModal(index) {
  state.currentModalIndex = index;
  const item = state.filteredItems[index];
  if (!item) return;

  const title = getTitle(item);
  const imgUrl = getImageUrl(item);
  const assetType = getAssetType(item);
  const isAi = isAiItem(item);
  const downloads = getDownloadCount(item);
  const views = getViewCount(item);
  const score = calculateScore(item);
  const creator = getCreatorName(item);
  const detailsUrl = getDetailsUrl(item);
  const keywords = extractKeywords(item);

  $("modalPreviewImg").src = imgUrl;
  $("modalPreviewImg").alt = title;
  $("modalAssetTitle").textContent = title;
  $("modalTypeBadge").textContent = assetType;
  $("modalTypeBadge").className = `badge-pill badge-${assetType}`;
  $("modalAiBadge").textContent = isAi ? "AI Generated" : "Human Made";
  $("modalAiBadge").className = `badge-pill ${isAi ? 'badge-ai' : 'badge-human'}`;
  $("modalAssetId").textContent = `ID: #${item.id || item.assetId || 'N/A'}`;

  $("modalCreatorName").textContent = creator;
  $("modalUploadDate").textContent = item.createdAt ? `Created: ${new Date(item.createdAt).toLocaleDateString()}` : "Created: Standard Catalog";
  $("modalPortfolioLink").href = `https://stock.adobe.com/search?creator=${encodeURIComponent(creator)}`;

  $("modalDownloads").textContent = formatNumber(downloads);
  $("modalViews").textContent = formatNumber(views);
  $("modalScore").textContent = score;

  $("modalViewOnAdobeBtn").href = detailsUrl || `https://stock.adobe.com/search?k=${encodeURIComponent(title)}`;

  // Keywords list with count and click-to-copy
  $("modalKeywordsCount").textContent = keywords.length;
  const kwContainer = $("modalKeywordsList");
  kwContainer.innerHTML = "";
  if (keywords.length > 0) {
    keywords.forEach(kw => {
      const tag = document.createElement("span");
      tag.className = "modal-tag";
      tag.title = `Click to copy "${kw}"`;
      tag.textContent = kw;
      tag.onclick = () => copySingleKeyword(kw);
      kwContainer.appendChild(tag);
    });
  } else {
    kwContainer.innerHTML = `<span style="color:var(--text-muted);font-size:11px;">Standard catalog tags</span>`;
  }

  $("assetModal").classList.add("open");
}

function closeAssetModal() {
  $("assetModal").classList.remove("open");
}

function stepAsset(delta) {
  const nextIdx = state.currentModalIndex + delta;
  if (nextIdx >= 0 && nextIdx < state.filteredItems.length) {
    openAssetModal(nextIdx);
  }
}

function copyAssetDetails() {
  const item = state.filteredItems[state.currentModalIndex];
  if (!item) return;
  const text = JSON.stringify(item, null, 2);
  navigator.clipboard.writeText(text).then(() => {
    showToast("Full Metadata JSON copied to clipboard!", "success");
  });
}

function handleModalBackdropClick(e) {
  if (e.target.classList.contains("modal-backdrop")) {
    e.target.classList.remove("open");
  }
}

/* ==========================================================
   Export & Import Engine
   ========================================================== */
function exportData(format) {
  if (!state.filteredItems || state.filteredItems.length === 0) {
    showToast("No active data to export", "info");
    return;
  }

  const filename = `adobe-tracker-${new Date().toISOString().slice(0, 10)}`;

  if (format === "json") {
    const jsonStr = JSON.stringify(state.filteredItems, null, 2);
    downloadFile(jsonStr, `${filename}.json`, "application/json");
    showToast("Exported JSON dataset", "success");
  } else if (format === "csv") {
    const headers = ["ID", "Title", "AssetType", "IsGenerativeAI", "Downloads", "Views", "Score", "Creator", "DetailsURL"];
    const rows = state.filteredItems.map(it => [
      `"${it.id || it.assetId || ''}"`,
      `"${getTitle(it).replace(/"/g, '""')}"`,
      `"${getAssetType(it)}"`,
      isAiItem(it) ? "TRUE" : "FALSE",
      getDownloadCount(it) || 0,
      getViewCount(it) || 0,
      calculateScore(it),
      `"${getCreatorName(it).replace(/"/g, '""')}"`,
      `"${getDetailsUrl(it)}"`
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    downloadFile(csvContent, `${filename}.csv`, "text/csv;charset=utf-8;");
    showToast("Exported CSV dataset", "success");
  }
}

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function triggerImportFileInput() {
  $("importFileInput").click();
}

function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const items = JSON.parse(ev.target.result);
      if (!Array.isArray(items)) throw new Error("Dataset is not an array");
      state.rawItems = items;
      $("activeQueryTitle").textContent = `Imported Dataset (${file.name})`;
      $("activeQuerySubtitle").textContent = `Loaded from local JSON backup`;
      applyFiltersAndSort();
      toggleLibraryDrawer();
      showToast(`Imported ${items.length} assets successfully!`, "success");
    } catch {
      showToast("Invalid JSON file format", "error");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* ==========================================================
   IndexedDB Library (Saved Searches)
   ========================================================== */
function initDB() {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = (e) => {
    state.db = e.target.result;
    if (!state.db.objectStoreNames.contains(STORE_NAME)) {
      state.db.createObjectStore(STORE_NAME, { keyPath: "id" });
    }
  };
  req.onsuccess = (e) => {
    state.db = e.target.result;
    updateLibraryCountBadge();
  };
}

function toggleLibraryDrawer() {
  const drawer = $("libraryDrawer");
  const overlay = $("drawerOverlay");
  const isOpen = drawer.classList.contains("open");
  drawer.classList.toggle("open", !isOpen);
  overlay.classList.toggle("open", !isOpen);
  if (!isOpen) renderSavedSearchesList();
}

function openSaveSearchModal() {
  if (!state.rawItems || state.rawItems.length === 0) return;
  const currentQuery = $("searchQuery").value.trim() || "Saved Search";
  $("bookmarkNameInput").value = currentQuery;
  $("bookmarkModal").classList.add("open");
}

function closeBookmarkModal() {
  $("bookmarkModal").classList.remove("open");
}

function confirmSaveBookmark() {
  const name = $("bookmarkNameInput").value.trim() || "Untitled Search";
  if (!state.db) return;

  const record = {
    id: Date.now().toString(),
    title: name,
    date: Date.now(),
    itemsCount: state.rawItems.length,
    items: state.rawItems
  };

  const tx = state.db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).add(record);
  tx.oncomplete = () => {
    updateLibraryCountBadge();
    closeBookmarkModal();
    showToast(`Saved "${name}" to Library`, "success");
  };
}

function updateLibraryCountBadge() {
  if (!state.db) return;
  const tx = state.db.transaction(STORE_NAME, "readonly");
  const req = tx.objectStore(STORE_NAME).count();
  req.onsuccess = () => {
    $("libraryCountBadge").textContent = req.result;
  };
}

function renderSavedSearchesList() {
  if (!state.db) return;
  const list = $("libraryItemsList");
  list.innerHTML = "";

  const tx = state.db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const req = store.openCursor();
  let count = 0;

  req.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      count++;
      const data = cursor.value;
      const card = document.createElement("div");
      card.className = "lib-card";
      card.innerHTML = `
        <div class="lib-card-info" onclick="loadSavedSearch('${data.id}')">
          <strong>${escapeHtml(data.title)}</strong>
          <small>${data.itemsCount} assets • ${new Date(data.date).toLocaleDateString()}</small>
        </div>
        <button class="btn-del-lib" onclick="deleteSavedSearch('${data.id}', event)" title="Delete">✕</button>
      `;
      list.appendChild(card);
      cursor.continue();
    } else {
      if (count === 0) {
        list.innerHTML = `
          <div class="empty-drawer">
            <span>📂</span>
            <p>No saved searches yet.<br>Click "Bookmark Search" after analyzing to save snapshots.</p>
          </div>
        `;
      }
    }
  };
}

function loadSavedSearch(id) {
  if (!state.db) return;
  const tx = state.db.transaction(STORE_NAME, "readonly");
  const req = tx.objectStore(STORE_NAME).get(id);
  req.onsuccess = (e) => {
    const data = e.target.result;
    if (data) {
      state.rawItems = data.items;
      $("activeQueryTitle").textContent = data.title;
      $("activeQuerySubtitle").textContent = `Restored from saved search library`;
      applyFiltersAndSort();
      toggleLibraryDrawer();
      showToast(`Loaded "${data.title}" from library`, "info");
    }
  };
}

function deleteSavedSearch(id, ev) {
  if (ev) ev.stopPropagation();
  if (!state.db) return;
  const tx = state.db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  tx.oncomplete = () => {
    updateLibraryCountBadge();
    renderSavedSearchesList();
    showToast("Deleted from library", "info");
  };
}

function clearLibrary() {
  if (!confirm("Are you sure you want to clear all saved searches?")) return;
  if (!state.db) return;
  const tx = state.db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  tx.oncomplete = () => {
    updateLibraryCountBadge();
    renderSavedSearchesList();
    showToast("Cleared all library entries", "info");
  };
}

/* ==========================================================
   Help Modal
   ========================================================== */
function openHelpModal() {
  $("helpModal").classList.add("open");
}
function closeHelpModal() {
  $("helpModal").classList.remove("open");
}

/* ==========================================================
   Field Extractors & Math Utilities
   ========================================================== */
function getFirst(o, keys) {
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return null;
}

function getTitle(o) {
  return getFirst(o, ["assetTitle", "title", "name", "headline"]) || "Untitled Asset";
}

function getImageUrl(o) {
  return getFirst(o, ["thumb500Url", "thumbUrl", "thumb1000Url", "compUrl", "thumbnail_url", "preview_url"]) || "";
}

function getDetailsUrl(o) {
  return getFirst(o, ["detailsUrl", "url", "asset_url"]) || "";
}

function getCreatorName(o) {
  return getFirst(o, ["creatorName", "creator_name", "creator", "author"]) || "Contributor";
}

function getDownloadCount(o) {
  const v = getFirst(o, ["downloadCount", "nb_downloads", "downloads", "sales"]);
  if (v === null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function getViewCount(o) {
  const v = getFirst(o, ["viewCount", "nb_views", "views", "impressions"]);
  if (v === null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isAiItem(o) {
  const v = getFirst(o, ["isGenerativeAi", "is_gentech", "ai", "generativeAi"]);
  return v === true || String(v).toLowerCase() === "true";
}

function getAssetType(o) {
  const v = String(getFirst(o, ["assetType", "asset_type", "media_type", "mediaType", "type"]) || "vector").toLowerCase();
  if (v.includes("photo") || v.includes("image")) return "photo";
  if (v.includes("illust")) return "illustration";
  if (v.includes("vect")) return "vector";
  if (v.includes("3d")) return "3d";
  if (v.includes("video")) return "video";
  return "vector";
}

function getCreatedTime(o) {
  const d = getFirst(o, ["createdAt", "creation_date", "upload_date", "created_at"]);
  if (!d) return 0;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
}

function calculateScore(item) {
  const d = getDownloadCount(item) || 0;
  const v = getViewCount(item) || 0;
  return Math.max(10, Math.min(99, Math.round(Math.log10(d + 1) * 18 + (v ? Math.min(12, Math.log10(v + 1) * 2) : 0))));
}

function calculateMedian(arr) {
  if (!arr || !arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString();
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ==========================================================
   Toast Notification System
   ========================================================== */
function showToast(message, type = "info") {
  const container = $("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  toast.innerHTML = `<strong>${icon}</strong><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
