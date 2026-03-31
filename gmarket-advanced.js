function generateEqualizerRays() {
    const container = document.getElementById("equalizer-rays");
    if (!container) return;

    const totalRays = 36;
    container.innerHTML = "";

    for (let i = 0; i < totalRays; i += 1) {
        const ray = document.createElement("div");
        const rotation = (360 / totalRays) * i;
        const duration = 4 + Math.random() * 2;
        const delay = Math.random() * -5;

        ray.className = "ray";
        ray.style.setProperty("--rot", `${rotation}deg`);
        ray.style.setProperty("--dur", `${duration}s`);
        ray.style.setProperty("--delay", `${delay}s`);
        container.appendChild(ray);
    }
}

const solutionData = window.solutionData || {};
const HISTORY_STORAGE_KEY = "gmarket-solution-search-history";
const HISTORY_PANEL_STATE_KEY = "gmarket-history-panel-collapsed";
const HISTORY_LIMIT = 6;

const state = {
    currentIntent: "",
    rawQuery: "",
    choices: { size: "", wall: "", goal: "" },
    searchHistory: [],
    isHistoryPanelCollapsed: false
};

function loadSearchHistory() {
    try {
        const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function persistSearchHistory() {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.searchHistory));
}

function loadHistoryPanelState() {
    try {
        return window.localStorage.getItem(HISTORY_PANEL_STATE_KEY) === "true";
    } catch (error) {
        return false;
    }
}

function persistHistoryPanelState() {
    window.localStorage.setItem(HISTORY_PANEL_STATE_KEY, String(state.isHistoryPanelCollapsed));
}

function applyHistoryPanelState() {
    const panel = document.getElementById("history-panel");
    const icon = document.getElementById("collapseHistorySidebarIcon");
    if (!panel) return;

    panel.classList.toggle("history-sidebar-collapsed", state.isHistoryPanelCollapsed);
    document.body.classList.toggle("history-panel-collapsed", state.isHistoryPanelCollapsed);

    if (icon) {
        icon.classList.toggle("rotate-180", state.isHistoryPanelCollapsed);
    }
}

function formatHistoryTimestamp(isoString) {
    if (!isoString) return "";

    try {
        return new Intl.DateTimeFormat("ko-KR", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        }).format(new Date(isoString));
    } catch (error) {
        return "";
    }
}

function renderSearchHistory() {
    const historyList = document.getElementById("history-list");
    const emptyState = document.getElementById("history-empty");
    const clearButton = document.getElementById("clearHistoryBtn");

    if (!historyList || !emptyState || !clearButton) return;

    if (!state.searchHistory.length) {
        historyList.classList.add("hidden");
        emptyState.classList.remove("hidden");
        clearButton.classList.add("hidden");
        historyList.innerHTML = "";
        return;
    }

    emptyState.classList.add("hidden");
    historyList.classList.remove("hidden");
    clearButton.classList.remove("hidden");

    historyList.innerHTML = state.searchHistory
        .map(
            (item, index) => `
                <button type="button" class="history-item w-full text-left rounded-[20px] border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all duration-300 px-4 py-4" data-history-index="${index}">
                    <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2 mb-2">
                                <span class="history-item-intent inline-flex items-center rounded-full bg-gmarket-blue/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-gmarket-blue">${item.intent}</span>
                                <span class="history-item-time text-[11px] text-slate-400 font-bold">${formatHistoryTimestamp(item.createdAt)}</span>
                            </div>
                            <p class="history-item-query text-[15px] text-slate-800 font-bold leading-snug break-words">${item.query}</p>
                            <p class="history-item-summary text-xs text-slate-500 mt-2 font-bold leading-relaxed">${item.summary}</p>
                        </div>
                        <span class="history-item-arrow flex-shrink-0 text-slate-300 transition-transform duration-300">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M9 5l7 7-7 7"></path></svg>
                        </span>
                    </div>
                </button>
            `
        )
        .join("");
}

function buildHistorySummary() {
    return [state.choices.size, state.choices.wall, state.choices.goal].filter(Boolean).join(" / ");
}

function saveSearchHistory() {
    const query = state.rawQuery?.trim();
    if (!query || !state.currentIntent) return;

    const nextEntry = {
        query,
        intent: state.currentIntent,
        summary: buildHistorySummary(),
        choices: { ...state.choices },
        createdAt: new Date().toISOString()
    };

    state.searchHistory = [
        nextEntry,
        ...state.searchHistory.filter((item) => item.query !== nextEntry.query)
    ].slice(0, HISTORY_LIMIT);

    persistSearchHistory();
    renderSearchHistory();
}

function applyHistoryEntry(index) {
    const entry = state.searchHistory[index];
    const searchInput = document.getElementById("searchInput");

    if (!entry) return;

    state.currentIntent = entry.intent;
    state.rawQuery = entry.query;
    state.choices = { ...entry.choices };

    if (searchInput) {
        searchInput.value = entry.query;
        updateSearchUI(entry.query);
    }

    executeSearch(entry.query);
    renderSearchHistory();
    closeHistorySidebar();
}

function openHistorySidebar() {
    const sidebar = document.getElementById("history-panel");
    const backdrop = document.getElementById("history-sidebar-backdrop");
    if (!sidebar || !backdrop) return;

    sidebar.classList.add("history-sidebar-open");
    backdrop.classList.remove("hidden");
    document.body.classList.add("history-sidebar-active");
}

function closeHistorySidebar() {
    const sidebar = document.getElementById("history-panel");
    const backdrop = document.getElementById("history-sidebar-backdrop");
    if (!sidebar || !backdrop) return;

    sidebar.classList.remove("history-sidebar-open");
    backdrop.classList.add("hidden");
    document.body.classList.remove("history-sidebar-active");
}

function toggleHistoryPanelCollapse() {
    state.isHistoryPanelCollapsed = !state.isHistoryPanelCollapsed;
    persistHistoryPanelState();
    applyHistoryPanelState();
}

function updateSearchUI(value) {
    const submitBtn = document.getElementById("submitBtn");
    if (!submitBtn) return;

    const hasValue = value.trim().length > 0;
    submitBtn.disabled = !hasValue;
    submitBtn.classList.toggle("bg-gradient-to-tr", hasValue);
    submitBtn.classList.toggle("from-gmarket", hasValue);
    submitBtn.classList.toggle("to-gmarket-blue", hasValue);
    submitBtn.classList.toggle("bg-slate-200", !hasValue);
}

function executeSearch(query) {
    const infoView = document.getElementById("info-view");
    if (!query) return;

    if (query.includes("커튼") || query.includes("커텐") || query.includes("而ㅽ듉") || query.includes("而ㅽ뀗")) {
        state.currentIntent = "커튼";
        state.rawQuery = query;
        infoView?.classList.remove("hidden");
        infoView?.classList.add("flex");
        infoView?.scrollIntoView({ behavior: "smooth" });
    }
}

window.selectChoice = function selectChoice(btn, category) {
    const buttons = btn.parentElement.querySelectorAll("button");
    buttons.forEach((button) => button.classList.remove("active-card", "ring-4", "ring-blue-100"));
    btn.classList.add("active-card", "ring-4", "ring-blue-100");
    state.choices[category] = btn.innerText.trim();
};

window.generatePlan = function generatePlan() {
    const solutionView = document.getElementById("solution-view");
    if (!state.choices.size || !state.choices.wall || !state.choices.goal) return;
    if (!state.currentIntent) state.currentIntent = "커튼";
    if (!state.rawQuery) state.rawQuery = "커튼 설치";
    saveSearchHistory();
    solutionView?.classList.remove("hidden");
    renderSolution(state.currentIntent, state.rawQuery);
    solutionView?.scrollIntoView({ behavior: "smooth" });
};

window.openPDP = function openPDP(stepIdx, prodIdx) {
    const intentData = solutionData[state.currentIntent];
    if (!intentData) return;

    const product = intentData.steps[stepIdx]?.products[prodIdx];
    if (!product) return;

    document.getElementById("pdp-image").src = product.img;
    document.getElementById("pdp-title").innerText = product.name;
    document.getElementById("pdp-price").innerText = product.price;
    document.getElementById("pdp-original-price").innerText = `${product.originalPrice}원`;
    document.getElementById("pdp-match-score").innerText = product.score;
    document.getElementById("pdp-intent-reason-text").innerText = intentData.intentReason;
    document.getElementById("pdp-spec-size").innerText = product.spec.size;
    document.getElementById("pdp-spec-feature").innerText = product.spec.feature;

    const readyBadge = document.getElementById("ai-ready-badge");
    const speechBubble = document.getElementById("ai-speech-bubble");
    const loadingRing = document.getElementById("ai-loading-ring");
    const statusText = document.getElementById("ai-status-text");
    const summaryList = document.getElementById("pdp-ai-summary-list");

    readyBadge?.classList.add("hidden");
    speechBubble?.classList.add("hidden");
    loadingRing?.classList.remove("hidden");

    if (statusText) {
        statusText.innerText = "Analyzing G-Data Signal...";
        statusText.classList.remove("opacity-0");
    }

    if (summaryList) {
        summaryList.innerHTML = "";
        product.aiSummary.forEach((text, index) => {
            const item = document.createElement("div");
            item.className = "flex gap-6 items-start transition-all hover:translate-x-1 duration-300 text-left font-bold";
            item.innerHTML = `
                <div class="w-8 h-8 rounded-full bg-slate-900 text-white text-[14px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5 shadow-[0_4px_10px_rgba(0,0,0,0.2)]">${index + 1}</div>
                <p class="text-[17px] text-slate-600 leading-relaxed font-medium text-left">${text}</p>
            `;
            summaryList.appendChild(item);
        });
    }

    setTimeout(() => {
        loadingRing?.classList.add("hidden");
        readyBadge?.classList.remove("hidden");

        if (statusText) {
            statusText.innerText = "Optimization Complete!";
            setTimeout(() => statusText.classList.add("opacity-0"), 2000);
        }
    }, 1800);

    const scrollArea = document.querySelector("#pdp-floating-card .overflow-y-auto");
    if (scrollArea) scrollArea.scrollTop = 0;
    document.body.classList.add("pdp-active");
};

window.toggleAISpeechBubble = function toggleAISpeechBubble() {
    const speechBubble = document.getElementById("ai-speech-bubble");
    const readyBadge = document.getElementById("ai-ready-badge");
    if (!speechBubble) return;

    speechBubble.classList.toggle("hidden");
    if (!speechBubble.classList.contains("hidden")) {
        readyBadge?.classList.add("hidden");
    }
};

window.closePDP = function closePDP() {
    document.body.classList.remove("pdp-active");
};

function renderSolution(key, rawQuery) {
    const data = solutionData[key];
    const planContainer = document.getElementById("plan-container");
    const intentTitle = document.getElementById("intent-title");

    if (!data || !planContainer || !intentTitle) return;

    intentTitle.innerHTML = `
        "<span class="font-bold text-slate-900">${rawQuery}</span>"에 대한<br />
        <span class="font-bold text-gmarket-blue underline decoration-gmarket-yellow decoration-4 underline-offset-8">
            지마켓 맞춤 계획
        </span>입니다
    `;

    planContainer.innerHTML = "";

    data.steps.forEach((step, stepIndex) => {
        const stepEl = document.createElement("div");
        stepEl.className = "relative pl-8 md:pl-12 border-l-2 border-slate-200 pb-4 text-left font-bold";

        const productHtml = step.products
            .map(
                (product, productIndex) => `
                    <div onclick="openPDP(${stepIndex}, ${productIndex})" class="product-card cursor-pointer flex-shrink-0 w-52 md:w-56 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden transition-all duration-300 relative group/card text-left font-bold">
                        <div class="absolute top-3 left-3 z-20 bg-white/95 backdrop-blur px-2.5 py-1.5 rounded-xl border border-slate-100 flex items-center shadow-sm">
                            <span class="text-[10px] font-bold text-slate-400 mr-1.5 uppercase tracking-tighter">Match</span>
                            <span class="text-xs font-bold text-gmarket-blue">${product.score}%</span>
                        </div>
                        <div class="h-44 bg-slate-100 flex items-center justify-center overflow-hidden">
                            <img src="${product.img}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" onerror="this.src='https://images.unsplash.com/photo-1560393464-5c69a73c5770?auto=format&fit=crop&q=80&w=400'" alt="${product.name}">
                        </div>
                        <div class="p-5 text-left">
                            <h4 class="text-sm font-bold text-slate-800 mb-1.5 truncate leading-tight">${product.name}</h4>
                            <div class="flex items-baseline mb-4 text-left">
                                <span class="text-lg font-bold text-gmarket-blue">${product.price}</span>
                                <span class="text-xs font-medium text-slate-400 ml-0.5">원</span>
                            </div>
                            <button class="w-full py-3 bg-slate-900 text-white text-[11px] rounded-xl font-bold transition-colors hover:bg-gmarket-blue">상세보기</button>
                        </div>
                    </div>
                `
            )
            .join("");

        stepEl.innerHTML = `
            <div class="absolute -left-[20px] top-0 w-10 h-10 rounded-full bg-slate-900 shadow-xl flex items-center justify-center font-bold text-white z-20 border-4 border-slate-50">
                ${stepIndex + 1}
            </div>
            <div class="mb-8 text-left">
                <h3 class="text-2xl font-bold text-slate-800 mb-3">${step.name}</h3>
                <p class="text-slate-500 text-sm leading-relaxed">지마켓 AI가 제안하는 단계별 상품입니다.</p>
            </div>
            <div class="flex gap-5 overflow-x-auto pb-8 -mx-2 px-2 scrollbar-hide text-left">
                ${productHtml}
            </div>
        `;

        planContainer.appendChild(stepEl);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("searchInput");
    const searchForm = document.getElementById("searchForm");
    const curtainTag = document.getElementById("curtainTag");
    const historyList = document.getElementById("history-list");
    const clearHistoryBtn = document.getElementById("clearHistoryBtn");
    const historySidebarToggle = document.getElementById("historySidebarToggle");
    const closeHistorySidebarBtn = document.getElementById("closeHistorySidebar");
    const historySidebarBackdrop = document.getElementById("history-sidebar-backdrop");
    const collapseHistorySidebarBtn = document.getElementById("collapseHistorySidebar");

    generateEqualizerRays();
    state.searchHistory = loadSearchHistory();
    state.isHistoryPanelCollapsed = loadHistoryPanelState();
    applyHistoryPanelState();
    renderSearchHistory();
    updateSearchUI(searchInput?.value || "");

    searchInput?.addEventListener("input", (event) => {
        updateSearchUI(event.target.value);
    });

    searchForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        executeSearch(searchInput?.value.trim() || "");
    });

    curtainTag?.addEventListener("click", () => {
        const value = "커튼 달기";
        if (searchInput) searchInput.value = value;
        updateSearchUI(value);
        executeSearch(value);
    });

    historyList?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-history-index]");
        if (!button) return;

        applyHistoryEntry(Number(button.dataset.historyIndex));
    });

    clearHistoryBtn?.addEventListener("click", () => {
        state.searchHistory = [];
        window.localStorage.removeItem(HISTORY_STORAGE_KEY);
        renderSearchHistory();
    });

    historySidebarToggle?.addEventListener("click", openHistorySidebar);
    closeHistorySidebarBtn?.addEventListener("click", closeHistorySidebar);
    historySidebarBackdrop?.addEventListener("click", closeHistorySidebar);
    collapseHistorySidebarBtn?.addEventListener("click", toggleHistoryPanelCollapse);
});
