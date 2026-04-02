/* ─── Page loading overlay ──────────────────────────────── */
function showPageLoading(label = "") {
    const overlay = document.getElementById("page-loading-overlay");
    const labelEl = document.getElementById("page-loading-label");
    if (!overlay) return;
    if (labelEl) labelEl.textContent = label;
    overlay.classList.add("active");
}

function hidePageLoading() {
    const overlay = document.getElementById("page-loading-overlay");
    if (!overlay) return;
    overlay.classList.remove("active");
}

function withLoading(label, delayMs, fn) {
    showPageLoading(label);
    setTimeout(() => {
        fn();
        hidePageLoading();
    }, delayMs);
}

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
const CART_STORAGE_KEY = "gmarket-purpose-cart";
const HISTORY_LIMIT = 6;

const state = {
    currentIntent: "",
    currentSessionId: "",
    rawQuery: "",
    choices: { size: "", wall: "", goal: "" },
    searchHistory: [],
    isHistoryPanelCollapsed: false,
    purposeCart: {},      // { sessionId: { intentKey, intentLabel, rawQuery, choices, selectedItems: { stepIdx: { productIdx, product } } } }
    activeTab: "cart"
};

/* ─── History persistence ───────────────────────────────────── */

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

/* ─── Cart persistence ──────────────────────────────────────── */

function loadCart() {
    try {
        const stored = window.localStorage.getItem(CART_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : {};
        return normalizeCartData(parsed);
    } catch (error) {
        return {};
    }
}

function persistCart() {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.purposeCart));
}

function normalizeCartData(cartData) {
    if (!cartData || typeof cartData !== "object" || Array.isArray(cartData)) {
        return {};
    }

    const normalized = {};

    Object.entries(cartData).forEach(([key, value], index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return;

        const hasSessionShape = typeof value.intentKey === "string";
        const sessionId = hasSessionShape ? key : `legacy-${key}-${index}`;

        normalized[sessionId] = {
            intentKey: hasSessionShape ? value.intentKey : key,
            intentLabel: value.intentLabel || solutionData[hasSessionShape ? value.intentKey : key]?.title || key,
            rawQuery: value.rawQuery || "",
            selectionSummary: value.selectionSummary || "",
            recommendationSummary: value.recommendationSummary || "",
            choices: value.choices || { size: "", wall: "", goal: "" },
            selectedItems: value.selectedItems || {},
            threadView: value.threadView || "solution",
            createdAt: value.createdAt || new Date().toISOString(),
            updatedAt: value.updatedAt || new Date().toISOString()
        };
    });

    return normalized;
}

function createCartSession(intentKey) {
    return {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        data: {
            intentKey,
            intentLabel: solutionData[intentKey]?.title || intentKey,
            rawQuery: state.rawQuery,
            selectionSummary: buildHistorySummary(),
            recommendationSummary: solutionData[intentKey]?.intentReason || "",
            choices: { ...state.choices },
            selectedItems: {},
            threadView: "solution",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    };
}

function getCartSession(sessionId) {
    return sessionId ? state.purposeCart[sessionId] : null;
}

function getActiveSessionForIntent(intentKey) {
    const activeSession = getCartSession(state.currentSessionId);
    if (activeSession?.intentKey === intentKey) {
        return { sessionId: state.currentSessionId, session: activeSession };
    }

    return null;
}

function getSessionSelectionState(intentKey, stepIdx) {
    const active = getActiveSessionForIntent(intentKey);
    return active?.session?.selectedItems?.[stepIdx] || null;
}

function calculateSessionTotals(session) {
    return Object.values(session?.selectedItems || {}).reduce(
        (acc, { product }) => {
            acc.count += 1;
            acc.price += parseInt(product.price.replace(/,/g, ""), 10) || 0;
            return acc;
        },
        { count: 0, price: 0 }
    );
}

function hydrateSessionContext(sessionId) {
    const session = getCartSession(sessionId);
    if (!session) return;

    state.currentSessionId = sessionId;
    state.currentIntent = session.intentKey;
    state.rawQuery = session.rawQuery || "";
    state.choices = {
        size: session.choices?.size || "",
        wall: session.choices?.wall || "",
        goal: session.choices?.goal || ""
    };

    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.value = state.rawQuery;
        updateSearchUI(state.rawQuery);
    }
}

function getCurrentVisibleThreadView() {
    if (!document.getElementById("order-complete-view")?.classList.contains("hidden")) return "complete";
    if (!document.getElementById("order-view")?.classList.contains("hidden")) return "order";
    if (!document.getElementById("solution-view")?.classList.contains("hidden")) return "solution";
    return "info";
}

function hideThreadViews() {
    const infoView = document.getElementById("info-view");
    const solutionView = document.getElementById("solution-view");
    const orderView = document.getElementById("order-view");
    const completeView = document.getElementById("order-complete-view");

    infoView?.classList.add("hidden");
    infoView?.classList.remove("flex");
    solutionView?.classList.add("hidden");
    orderView?.classList.add("hidden");
    orderView?.classList.remove("flex", "flex-col");
    completeView?.classList.add("hidden");
    completeView?.classList.remove("flex", "flex-col");
}

function showSolutionThread(session) {
    const solutionView = document.getElementById("solution-view");
    if (!session || !solutionView) return;

    hideThreadViews();
    closePDP();

    renderInfoView(session.intentKey);
    renderSolution(session.intentKey, session.rawQuery || session.intentLabel || session.intentKey);
    updateProductCardCartState(session.intentKey);
    updateBottomCheckoutBar();

    solutionView.classList.remove("hidden");

    requestAnimationFrame(() => {
        solutionView.scrollIntoView({ behavior: "smooth", block: "start" });
    });
}

/* ─── History panel collapse ────────────────────────────────── */

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

/* ─── History rendering ─────────────────────────────────────── */

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

function buildCartGroupSummary(cartGroup, intentData) {
    if (cartGroup?.selectionSummary) return cartGroup.selectionSummary;
    if (cartGroup?.rawQuery) return `"${cartGroup.rawQuery}" 기준 추천`;
    return intentData?.intentReason || "";
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

    state.currentSessionId = "";
    state.currentIntent = entry.intent;
    state.rawQuery = entry.query;
    state.choices = { ...entry.choices };

    if (searchInput) {
        searchInput.value = entry.query;
        updateSearchUI(entry.query);
    }

    executeSearch(entry.query, { resetChoices: false });
    renderSearchHistory();
    closeHistorySidebar();
}

/* ─── Sidebar open/close/collapse ──────────────────────────── */

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

/* ─── Tab switching ─────────────────────────────────────────── */

window.switchTab = function switchTab(tab) {
    state.activeTab = tab;

    const cartPanel = document.getElementById("cart-tab-panel");
    const cartTabBtn = document.getElementById("cartTabBtn");

    cartPanel?.classList.remove("hidden");
    cartTabBtn?.classList.add("sidebar-tab-active");
    cartTabBtn?.classList.remove("text-slate-400");
};

/* ─── Cart logic ─────────────────────────────────────────────── */

window.addToCart = function addToCart(intentKey, stepIdx, productIdx) {
    const intentData = solutionData[intentKey];
    if (!intentData) return;

    const product = intentData.steps[stepIdx]?.products[productIdx];
    if (!product) return;

    let sessionId = state.currentSessionId;
    let cartSession = getCartSession(sessionId);

    if (!cartSession || cartSession.intentKey !== intentKey) {
        const nextSession = createCartSession(intentKey);
        sessionId = nextSession.id;
        cartSession = nextSession.data;
        state.purposeCart[sessionId] = cartSession;
        state.currentSessionId = sessionId;
    }

    // Toggle: click same product → remove; click different → replace
    cartSession.rawQuery = state.rawQuery;
    cartSession.selectionSummary = buildHistorySummary();
    cartSession.recommendationSummary = intentData.intentReason;
    cartSession.choices = { ...state.choices };
    cartSession.threadView = getCurrentVisibleThreadView();
    cartSession.updatedAt = new Date().toISOString();

    const existing = cartSession.selectedItems[stepIdx];
    const isSame = existing && existing.productIdx === productIdx;

    if (isSame) {
        delete cartSession.selectedItems[stepIdx];
        // Clean up empty intent group
        if (!Object.keys(cartSession.selectedItems).length) {
            delete state.purposeCart[sessionId];
            if (state.currentSessionId === sessionId) {
                state.currentSessionId = "";
            }
        }
    } else {
        cartSession.selectedItems[stepIdx] = { productIdx, product };
    }

    persistCart();
    renderCart();
    updateProductCardCartState(intentKey);
    updateCartBadge();

    if (!isSame) {
        const toggleBtn = document.getElementById("historySidebarToggle");
        if (toggleBtn) {
            toggleBtn.classList.remove("cart-btn-shake");
            void toggleBtn.offsetWidth;
            toggleBtn.classList.add("cart-btn-shake");
            toggleBtn.addEventListener("animationend", () => toggleBtn.classList.remove("cart-btn-shake"), { once: true });
        }
    }

    // Show brief toast
    const toastMsg = isSame
        ? `'${product.name}' 이(가) 장바구니에서 제거됐어요`
        : `'${product.name}' 이(가) 장바구니에 담겼어요 🛒`;
    showMiniToast(toastMsg);
};

window.removeFromCart = function removeFromCart(intentKey, stepIdx, sessionIdOverride) {
    const activeSession = sessionIdOverride
        ? { sessionId: sessionIdOverride, session: getCartSession(sessionIdOverride) }
        : getActiveSessionForIntent(intentKey);
    const sessionId = activeSession?.sessionId;
    const cartSession = activeSession?.session;
    if (!sessionId || !cartSession) return;

    const removed = cartSession.selectedItems[stepIdx];
    delete cartSession.selectedItems[stepIdx];
    cartSession.updatedAt = new Date().toISOString();

    if (!Object.keys(cartSession.selectedItems).length) {
        delete state.purposeCart[sessionId];
        if (state.currentSessionId === sessionId) {
            state.currentSessionId = "";
        }
    }

    persistCart();
    renderCart();
    updateProductCardCartState(intentKey);
    updateCartBadge();

    if (removed) showMiniToast(`'${removed.product.name}' 이(가) 제거됐어요`);
};

window.clearCartIntent = function clearCartIntent(sessionId) {
    const cartSession = getCartSession(sessionId);
    if (!cartSession) return;

    delete state.purposeCart[sessionId];
    if (state.currentSessionId === sessionId) {
        state.currentSessionId = "";
    }
    persistCart();
    renderCart();
    updateProductCardCartState(cartSession.intentKey);
    updateCartBadge();
};

function getCartItemCount() {
    return Object.values(state.purposeCart).reduce(
        (sum, group) => sum + Object.keys(group.selectedItems).length, 0
    );
}

function updateCartBadge() {
    const badge = document.getElementById("cartBadge");
    if (!badge) return;
    const count = getCartItemCount();

    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove("hidden");
        badge.classList.add("badge-pop");
        setTimeout(() => badge.classList.remove("badge-pop"), 350);
    } else {
        badge.classList.add("hidden");
    }
}

function updateProductCardCartState(intentKey) {
    const intentData = solutionData[intentKey];
    if (!intentData) return;

    const activeSession = getActiveSessionForIntent(intentKey);
    const cartGroup = activeSession?.session;

    intentData.steps.forEach((step, stepIdx) => {
        step.products.forEach((product, productIdx) => {
            const cardEl = document.querySelector(`[data-product-card="${intentKey}-${stepIdx}-${productIdx}"]`);
            const btnEl = document.querySelector(`[data-cart-btn="${intentKey}-${stepIdx}-${productIdx}"]`);

            const isInCart = cartGroup?.selectedItems[stepIdx]?.productIdx === productIdx;

            if (cardEl) cardEl.classList.toggle("in-cart", isInCart);
            if (btnEl) {
                btnEl.classList.toggle("in-cart", isInCart);
                btnEl.textContent = isInCart ? "✓ 담았어요" : "담기";
            }
        });
    });
}

/* ─── Cart rendering ─────────────────────────────────────────── */

function renderCart() {
    const cartContent = document.getElementById("cart-content");
    const cartEmpty = document.getElementById("cart-empty");

    if (!cartContent || !cartEmpty) return;

    const cartKeys = Object.keys(state.purposeCart).sort((a, b) => {
        const aTime = new Date(state.purposeCart[a]?.updatedAt || 0).getTime();
        const bTime = new Date(state.purposeCart[b]?.updatedAt || 0).getTime();
        return bTime - aTime;
    });

    if (!cartKeys.length) {
        cartContent.classList.add("hidden");
        cartEmpty.classList.remove("hidden");
        return;
    }

    cartEmpty.classList.add("hidden");
    cartContent.classList.remove("hidden");

    cartContent.innerHTML = cartKeys.map(sessionId => {
        const cartGroup = state.purposeCart[sessionId];
        const intentData = solutionData[cartGroup.intentKey];
        if (!intentData) return "";
        const groupSummary = buildCartGroupSummary(cartGroup, intentData);
        const { count: selectedCount, price: subtotal } = calculateSessionTotals(cartGroup);
        let hasEssentialMissing = false;

        const stepsHtml = intentData.steps.map((step, stepIdx) => {
            const selected = cartGroup.selectedItems[stepIdx];

            if (selected) {
                return `
                    <div class="cart-item flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100 cart-item-enter">
                        <img src="${selected.product.img}" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" onerror="this.src='https://images.unsplash.com/photo-1560393464-5c69a73c5770?auto=format&fit=crop&q=80&w=100'" alt="${selected.product.name}">
                        <div class="flex-1 min-w-0">
                            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">${step.name}</p>
                            <p class="text-xs font-bold text-slate-800 truncate leading-tight">${selected.product.name}</p>
                            <p class="text-xs font-bold text-gmarket-blue">${selected.product.price}원</p>
                        </div>
                        <button onclick="removeFromCart('${cartGroup.intentKey}', ${stepIdx}, '${sessionId}')" class="flex-shrink-0 w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-400 transition-colors rounded-full hover:bg-red-50" title="제거">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                `;
            } else {
                if (step.essential) {
                    hasEssentialMissing = true;
                }
                return step.essential ? `
                    <div class="flex items-center gap-2.5 p-2.5 rounded-xl bg-amber-50 border border-dashed border-amber-200">
                        <div class="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                            <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[10px] font-bold text-amber-600 uppercase tracking-wider truncate">${step.name}</p>
                            <p class="text-[11px] text-amber-500 font-bold">꼭 필요한 상품이에요!</p>
                        </div>
                    </div>
                ` : `
                    <div class="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-dashed border-slate-200 opacity-50">
                        <div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                            <svg class="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">${step.name}</p>
                            <p class="text-[11px] text-slate-300 font-bold">선택 안 함</p>
                        </div>
                    </div>
                `;
            }
        }).join("");

        const totalSteps = intentData.steps.length;
        const isActive = state.currentSessionId === sessionId;
        const groupBorder = isActive
            ? "border-gmarket-blue bg-white"
            : (hasEssentialMissing ? "border-amber-200 bg-white" : "border-slate-200 bg-white");

        return `
            <div class="purpose-cart-group border ${groupBorder}">
                <div class="purpose-cart-header px-4 pt-4 pb-3 border-b border-slate-100/80">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold text-gmarket-blue uppercase tracking-[0.16em]">${cartGroup.intentLabel || cartGroup.intentKey}</span>
                        <div class="flex items-center gap-2">
                            <span class="purpose-cart-count text-[10px] text-slate-400 font-bold">${selectedCount}/${totalSteps} 선택</span>
                            <button onclick="clearCartIntent('${sessionId}')" class="text-[10px] text-slate-300 hover:text-red-400 transition-colors font-bold">전체삭제</button>
                        </div>
                    </div>
                    ${groupSummary ? `<p class="text-[11px] text-slate-500 font-bold mt-2 leading-relaxed">${groupSummary}</p>` : ""}
                    ${hasEssentialMissing ? `<p class="text-[10px] text-amber-500 font-bold mt-1.5 flex items-center gap-1"><span>⚠</span> 미선택 필수 상품이 있어요</p>` : ""}
                </div>
                <div class="purpose-cart-items px-4 py-3 space-y-2">
                    ${stepsHtml}
                </div>
                <div class="purpose-cart-footer px-4 pb-4 pt-2 border-t border-slate-100">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-xs text-slate-400 font-bold">합계</span>
                        <span class="text-sm font-bold text-slate-800">${subtotal.toLocaleString()}원</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <button onclick="continueCartSession('${sessionId}')" class="w-full py-2.5 bg-slate-100 text-slate-700 text-sm rounded-xl font-bold transition-all hover:bg-slate-200 active:scale-95">이어서 보기</button>
                        <button onclick="checkoutCart('${sessionId}')" class="w-full py-2.5 bg-gmarket-blue text-white text-sm rounded-xl font-bold transition-all hover:bg-blue-600 active:scale-95">구매하기</button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    updateBottomCheckoutBar();
}

/* ─── Checkout & warning toast ──────────────────────────────── */

window.checkoutCart = function checkoutCart(sessionId) {
    const cartGroup = getCartSession(sessionId);
    const intentData = solutionData[cartGroup?.intentKey];
    if (!intentData || !cartGroup) return;

    const missingEssentials = intentData.steps.filter(
        (step, idx) => step.essential && !cartGroup.selectedItems[idx]
    );

    if (missingEssentials.length > 0) {
        showMissingEssentialToast(missingEssentials, sessionId);
    } else {
        openOrderView(sessionId);
    }
};

window.openOrderView = function openOrderView(sessionId) {
    const cartGroup = getCartSession(sessionId);
    const intentData = solutionData[cartGroup?.intentKey];
    if (!cartGroup || !intentData) return;

    hydrateSessionContext(sessionId);

    // 주문 상품 목록 렌더링
    const itemsList = document.getElementById("order-items-list");
    const priceBreakdown = document.getElementById("order-price-breakdown");
    const totalPriceEl = document.getElementById("order-total-price");

    let subtotal = 0;
    let itemsHtml = "";
    let itemCount = 0;

    intentData.steps.forEach((step, stepIdx) => {
        const selected = cartGroup.selectedItems[stepIdx];
        if (!selected) return;

        const priceNum = parseInt(selected.product.price.replace(/,/g, ""), 10) || 0;
        subtotal += priceNum;
        itemCount += 1;

        itemsHtml += `
            <div class="flex items-center gap-4 py-3 border-b border-slate-100 last:border-0">
                <img src="${selected.product.img}" class="w-14 h-14 rounded-2xl object-cover flex-shrink-0 border border-slate-100"
                     onerror="this.src='https://images.unsplash.com/photo-1560393464-5c69a73c5770?auto=format&fit=crop&q=80&w=100'"
                     alt="${selected.product.name}">
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">${step.name}</p>
                    <p class="text-sm font-bold text-slate-800 leading-tight truncate">${selected.product.name}</p>
                    <p class="text-xs text-slate-400 font-bold mt-0.5">수량 1개</p>
                </div>
                <p class="text-sm font-bold text-slate-800 flex-shrink-0">${selected.product.price}원</p>
            </div>
        `;
    });

    const shipping = 0; // 무료 배송 가정
    const breakdownHtml = `
        <div class="flex justify-between text-slate-500">
            <span>상품 금액${itemCount ? ` (${itemCount}개)` : ""}</span>
            <span>${subtotal.toLocaleString()}원</span>
        </div>
        <div class="flex justify-between text-slate-500">
            <span>배송비</span>
            <span class="text-green-500 font-bold">무료</span>
        </div>
    `;

    if (itemsList) itemsList.innerHTML = itemsHtml;
    if (priceBreakdown) priceBreakdown.innerHTML = breakdownHtml;
    if (totalPriceEl) totalPriceEl.textContent = subtotal.toLocaleString() + "원";

    // 이전 주문완료 섹션 숨기기 & 버튼 리셋
    const prevComplete = document.getElementById("order-complete-view");
    if (prevComplete) {
        prevComplete.classList.add("hidden");
        prevComplete.classList.remove("flex", "flex-col");
    }
    const submitBtn = document.getElementById("order-submit-btn");
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "결제하기";
    }

    // 주문서 섹션 표시 후 스크롤
    showPageLoading("주문서를 준비하는 중...");
    setTimeout(() => {
        const orderView = document.getElementById("order-view");
        if (orderView) {
            orderView.classList.remove("hidden");
            orderView.classList.add("flex", "flex-col");
            orderView.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        hidePageLoading();
    }, 800);

    // 사이드바 닫기 (모바일)
    closeHistorySidebar();
};

window.closeOrderView = function closeOrderView() {
    const orderView = document.getElementById("order-view");
    if (orderView) {
        orderView.classList.add("hidden");
        orderView.classList.remove("flex", "flex-col");
    }
    // 솔루션 뷰로 스크롤백
    const solutionView = document.getElementById("solution-view");
    solutionView?.scrollIntoView({ behavior: "smooth", block: "start" });
    updateBottomCheckoutBar();
};

window.goBackToSolution = function goBackToSolution() {
    const completeView = document.getElementById("order-complete-view");
    if (completeView) {
        completeView.classList.add("hidden");
        completeView.classList.remove("flex", "flex-col");
    }
    const orderView = document.getElementById("order-view");
    if (orderView) {
        orderView.classList.add("hidden");
        orderView.classList.remove("flex", "flex-col");
    }
    const solutionView = document.getElementById("solution-view");
    solutionView?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.submitOrder = function submitOrder() {
    // 결제 버튼 비활성화
    const submitBtn = document.getElementById("order-submit-btn");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "✓ 결제 완료";
    }

    // 배송지 정보 복사
    const name = document.getElementById("order-name")?.value || "";
    const phone = document.getElementById("order-phone")?.value || "";
    const address = (document.getElementById("order-address")?.value || "") +
                    " " + (document.getElementById("order-address-detail")?.value || "");

    document.getElementById("complete-name").textContent = name;
    document.getElementById("complete-phone").textContent = phone;
    document.getElementById("complete-address").textContent = address.trim();

    // 주문번호 생성
    const orderNum = "GM" + Date.now().toString().slice(-8);
    document.getElementById("order-complete-number").textContent = orderNum;

    // 주문 상품 복사
    const srcItems = document.getElementById("order-items-list");
    const destItems = document.getElementById("complete-items-list");
    if (srcItems && destItems) {
        destItems.innerHTML = srcItems.innerHTML;
    }

    // 결제 금액 복사
    const totalPrice = document.getElementById("order-total-price")?.textContent || "";
    const completeTotal = document.getElementById("complete-total-price");
    if (completeTotal) completeTotal.textContent = totalPrice;

    // 주문완료 섹션 표시 후 스크롤
    showPageLoading("결제를 처리하는 중...");
    setTimeout(() => {
        const completeView = document.getElementById("order-complete-view");
        if (completeView) {
            completeView.classList.remove("hidden");
            completeView.classList.add("flex", "flex-col");
            completeView.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        hidePageLoading();
    }, 1000);
};

function showMissingEssentialToast(missingSteps, sessionId) {
    const cartSession = getCartSession(sessionId);
    const intentKey = cartSession?.intentKey || "";
    // Remove any existing toast
    document.getElementById("missing-toast")?.remove();

    const toast = document.createElement("div");
    toast.id = "missing-toast";
    toast.className = "fixed bottom-8 left-1/2 z-[200] bg-white rounded-[24px] shadow-2xl border border-amber-200 p-6 w-[calc(100vw-32px)] max-w-sm toast-anim";

    const stepNames = missingSteps.map(s => `<strong class="text-amber-700">${s.name}</strong>`).join(", ");

    toast.innerHTML = `
        <div class="flex items-start gap-4">
            <div class="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg class="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
            <div class="flex-1">
                <p class="text-sm font-bold text-slate-900 mb-1">${intentKey === "캠핑" ? "이거 챙기지 않으면 캠핑 현장에서 곤란해요! ⛺" : intentKey === "데스크탑" ? "이 부품 빠지면 조립 전에 바로 막혀요! 🖥️" : "이거 빠트리고 커튼 설치 할 뻔 했어요! 😅"}</p>
                <p class="text-xs text-slate-500 leading-relaxed">${stepNames} 상품을 아직 고르지 않으셨어요. 꼭 필요한 상품이에요!</p>
            </div>
            <button onclick="document.getElementById('missing-toast').remove()" class="text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="flex gap-2 mt-5">
            <button onclick="document.getElementById('missing-toast').remove(); switchTab('cart'); if(window.innerWidth < 1024) openHistorySidebar()" class="flex-1 py-2.5 bg-amber-500 text-white text-xs rounded-xl font-bold hover:bg-amber-600 transition-colors">상품 선택하기</button>
            <button onclick="document.getElementById('missing-toast').remove(); openOrderView('${sessionId}')" class="flex-1 py-2.5 bg-slate-100 text-slate-600 text-xs rounded-xl font-bold hover:bg-slate-200 transition-colors">그냥 구매하기</button>
        </div>
    `;

    document.body.appendChild(toast);

    // Auto-dismiss after 9s
    setTimeout(() => {
        if (document.getElementById("missing-toast") === toast) toast.remove();
    }, 9000);
}

function showMiniToast(message, type = "info") {
    document.getElementById("mini-toast")?.remove();

    const toast = document.createElement("div");
    toast.id = "mini-toast";
    const bg = type === "success" ? "bg-slate-900" : "bg-slate-800";
    toast.className = `fixed bottom-8 left-1/2 z-[200] ${bg} text-white rounded-full px-5 py-3 text-xs font-bold shadow-2xl whitespace-nowrap toast-anim`;
    toast.style.transform = "translateX(-50%)";
    toast.textContent = message;

    document.body.appendChild(toast);
    setTimeout(() => {
        if (document.getElementById("mini-toast") === toast) toast.remove();
    }, 3000);
}

/* ─── Search UI ─────────────────────────────────────────────── */

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

function executeSearch(query, options = {}) {
    const infoView = document.getElementById("info-view");
    if (!query) return;
    const { resetChoices = true } = options;

    state.currentSessionId = "";
    if (resetChoices) {
        state.choices = { size: "", wall: "", goal: "" };
    }

    const goToInfoView = (intent) => {
        state.currentIntent = intent;
        state.rawQuery = query;
        withLoading("맞춤 조건을 불러오는 중...", 800, () => {
            renderInfoView(intent);
            infoView?.classList.remove("hidden");
            infoView?.classList.add("flex");
            infoView?.scrollIntoView({ behavior: "smooth" });
        });
    };

    if (query.includes("커튼") || query.includes("커텐") || query.includes("而ㅽ듉") || query.includes("而ㅽ뀗")) {
        goToInfoView("커튼");
    } else if (query.includes("데스크탑") || query.includes("조립") || query.includes("pc") || query.includes("컴퓨터")) {
        goToInfoView("데스크탑");
    } else if (query.includes("캠핑") || query.includes("텐트") || query.includes("캠프") || query.includes("camping")) {
        goToInfoView("캠핑");
    }
}

const infoViewConfig = {
    "커튼": {
        q1: {
            label: "1. 설치할 창문 크기는 어느 정도인가요?",
            layout: "grid grid-cols-3 gap-3",
            options: [
                { main: "작음", sub: "작은 창", icon: true },
                { main: "보통", sub: "중간 창", icon: true },
                { main: "큼", sub: "전면 창문", icon: true }
            ],
            category: "size"
        },
        q2: {
            label: "2. 벽면 또는 천장 소재는 무엇인가요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "콘크리트", sub: "단단한 벽면", row: true },
                { main: "석고/목재", sub: "가벼운 벽면", row: true }
            ],
            category: "wall"
        },
        q3: {
            label: "3. 가장 중요하게 생각하는 효과는?",
            layout: "flex gap-3",
            options: [
                { main: "채광 조절" },
                { main: "아늑한 분위기" }
            ],
            category: "goal"
        }
    },
    "캠핑": {
        q1: {
            label: "1. 함께 가는 인원이 몇 명인가요?",
            layout: "grid grid-cols-3 gap-3",
            options: [
                { main: "1인", sub: "혼자", icon: true },
                { main: "2~3인", sub: "커플 / 소그룹", icon: true },
                { main: "4인+", sub: "가족 / 단체", icon: true }
            ],
            category: "size"
        },
        q2: {
            label: "2. 어떤 캠핑 스타일인가요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "🚗 오토캠핑", sub: "차로 이동", row: true },
                { main: "🎒 백패킹", sub: "도보 이동", row: true }
            ],
            category: "wall"
        },
        q3: {
            label: "3. 캠핑에서 가장 중요한 것은?",
            layout: "flex gap-3",
            options: [
                { main: "따뜻한 숙면" },
                { main: "편한 요리" },
                { main: "빠른 설치" }
            ],
            category: "goal"
        }
    },
    "데스크탑": {
        q1: {
            label: "1. 어떤 용도로 조립할 예정인가요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "사무용", sub: "문서 / 회의 / 웹", row: true },
                { main: "게이밍", sub: "고사양 게임", row: true },
                { main: "영상편집", sub: "크리에이티브 작업", row: true },
                { main: "올라운드", sub: "공부 / 취미 / 가정용", row: true }
            ],
            category: "size"
        },
        q2: {
            label: "2. 어떤 세팅을 가장 신경 쓰시나요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "가성비", sub: "예산 효율 우선", row: true },
                { main: "성능", sub: "업무 / 게임 속도", row: true },
                { main: "저소음", sub: "조용한 환경", row: true },
                { main: "감성 RGB", sub: "튜닝 / 비주얼", row: true }
            ],
            category: "wall"
        },
        q3: {
            label: "3. 꼭 넣고 싶은 포인트가 있나요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "화이트 셋업" },
                { main: "업그레이드 여유" },
                { main: "작은 공간" },
                { main: "듀얼모니터" }
            ],
            category: "goal"
        }
    }
};

function renderInfoView(intent) {
    const container = document.getElementById("questions-container");
    if (!container) return;
    const cfg = infoViewConfig[intent];
    if (!cfg) return;

    const buildQ = (q) => {
        const btnClass = "info-card border-2 border-slate-100 rounded-2xl transition-all bg-slate-50 hover:border-gmarket-blue";
        const buttons = q.options.map(opt => {
            const buttonAttrs = `data-choice-category="${q.category}" data-choice-value="${opt.main}"`;
            if (opt.row) {
                return `<button ${buttonAttrs} onclick="selectChoice(this, '${q.category}')" class="${btnClass} p-4 text-left flex items-center gap-4">
                    <span class="text-xl">${opt.main}</span>
                    <span class="text-xs font-bold text-slate-700">${opt.sub}</span>
                </button>`;
            } else if (opt.icon) {
                return `<button ${buttonAttrs} onclick="selectChoice(this, '${q.category}')" class="${btnClass} p-4 text-center group">
                    <span class="block text-xl mb-1">${opt.main}</span>
                    <span class="text-xs font-bold text-slate-700">${opt.sub}</span>
                </button>`;
            } else {
                return `<button ${buttonAttrs} onclick="selectChoice(this, '${q.category}')" class="flex-grow ${btnClass} p-4 text-center font-bold">
                    <span class="text-xs font-bold text-slate-700">${opt.main}</span>
                </button>`;
            }
        }).join("");
        return `<div>
            <label class="text-sm font-bold text-slate-400 mb-4 block">${q.label}</label>
            <div class="${q.layout}">${buttons}</div>
        </div>`;
    };

    container.innerHTML = buildQ(cfg.q1) + buildQ(cfg.q2) + buildQ(cfg.q3);

    Object.entries(state.choices).forEach(([category, value]) => {
        if (!value) return;
        const selectedButton = container.querySelector(
            `[data-choice-category="${category}"][data-choice-value="${value.replace(/"/g, '\\"')}"]`
        );
        selectedButton?.classList.add("active-card", "ring-4", "ring-blue-100");
    });
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

    const activeSession = getCartSession(state.currentSessionId);
    if (activeSession && activeSession.intentKey === state.currentIntent) {
        activeSession.rawQuery = state.rawQuery;
        activeSession.selectionSummary = buildHistorySummary();
        activeSession.choices = { ...state.choices };
        activeSession.threadView = "solution";
        activeSession.updatedAt = new Date().toISOString();
        persistCart();
        renderCart();
    }

    saveSearchHistory();
    withLoading("AI가 최적의 상품을 분석 중...", 1200, () => {
        solutionView?.classList.remove("hidden");
        renderSolution(state.currentIntent, state.rawQuery);
        solutionView?.scrollIntoView({ behavior: "smooth" });
        updateBottomCheckoutBar();
    });
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

    // Update PDP cart button state
    const pdpCartBtn = document.getElementById("pdp-cart-btn");
    const activeSession = getActiveSessionForIntent(state.currentIntent);
    if (pdpCartBtn) {
        const isInCart = activeSession?.session?.selectedItems?.[stepIdx]?.productIdx === prodIdx;
        pdpCartBtn.classList.toggle("in-cart", isInCart);
        pdpCartBtn.textContent = isInCart ? "✓ 장바구니에 담았어요" : "장바구니";
        pdpCartBtn.onclick = (e) => {
            e.stopPropagation();
            addToCart(state.currentIntent, stepIdx, prodIdx);
            const nowInCart = getActiveSessionForIntent(state.currentIntent)?.session?.selectedItems?.[stepIdx]?.productIdx === prodIdx;
            pdpCartBtn.classList.toggle("in-cart", nowInCart);
            pdpCartBtn.textContent = nowInCart ? "✓ 장바구니에 담았어요" : "장바구니";
        };
    }

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

window.continueCartSession = function continueCartSession(sessionId) {
    const session = getCartSession(sessionId);
    if (!session) return;

    hydrateSessionContext(sessionId);
    renderCart();
    closeHistorySidebar();
    showSolutionThread(session);
};

/* ─── Solution rendering ────────────────────────────────────── */

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
        const selectedState = getSessionSelectionState(key, stepIndex);
        const maxVisibleCount = Math.min(7, step.products.length);
        const minVisibleCount = Math.min(2, maxVisibleCount);
        const visibleCount = maxVisibleCount <= minVisibleCount
            ? maxVisibleCount
            : Math.floor(Math.random() * (maxVisibleCount - minVisibleCount + 1)) + minVisibleCount;
        const shuffledProducts = [...step.products]
            .map((product, originalIndex) => ({ product, originalIndex, sortKey: Math.random() }))
            .sort((a, b) => a.sortKey - b.sortKey);
        let visibleProducts = shuffledProducts.slice(0, visibleCount);

        if (
            selectedState &&
            !visibleProducts.some((entry) => entry.originalIndex === selectedState.productIdx)
        ) {
            const selectedEntry = shuffledProducts.find((entry) => entry.originalIndex === selectedState.productIdx);
            if (selectedEntry) {
                visibleProducts = [...visibleProducts.slice(0, Math.max(visibleProducts.length - 1, 0)), selectedEntry];
            }
        }

        const essentialBadge = step.essential
            ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600 uppercase tracking-wide">필수</span>`
            : `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400 uppercase tracking-wide">선택</span>`;

        const productHtml = visibleProducts
            .map(
                ({ product, originalIndex }) => {
                    const isInCart = selectedState?.productIdx === originalIndex;
                    return `
                    <div
                        data-product-card="${key}-${stepIndex}-${originalIndex}"
                        onclick="openPDP(${stepIndex}, ${originalIndex})"
                        class="product-card cursor-pointer snap-start flex-shrink-0 w-52 md:w-56 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden transition-all duration-300 relative group/card text-left font-bold ${isInCart ? "in-cart" : ""}">
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
                            <div class="flex gap-2">
                                <button class="flex-1 py-3 bg-slate-900 text-white text-[11px] rounded-xl font-bold transition-colors hover:bg-gmarket-blue">상세보기</button>
                                <button
                                    data-cart-btn="${key}-${stepIndex}-${originalIndex}"
                                    onclick="event.stopPropagation(); addToCart('${key}', ${stepIndex}, ${originalIndex})"
                                    class="cart-add-btn py-3 px-3 bg-slate-100 text-slate-700 text-[11px] rounded-xl font-bold ${isInCart ? "in-cart" : ""}">
                                    ${isInCart ? "✓ 담았어요" : "담기"}
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                }
            )
            .join("");

        stepEl.innerHTML = `
            <div class="absolute -left-[20px] top-0 w-10 h-10 rounded-full bg-slate-900 shadow-xl flex items-center justify-center font-bold text-white z-20 border-4 border-slate-50">
                ${stepIndex + 1}
            </div>
            <div class="mb-8 text-left">
                <h3 class="text-2xl font-bold text-slate-800 mb-3 flex items-center flex-wrap gap-1">${step.name}${essentialBadge}</h3>
                <p class="text-slate-500 text-sm leading-relaxed">${step.description || "지마켓 AI가 제안하는 단계별 상품입니다."}</p>
            </div>
            <div class="flex items-center justify-between gap-3 mb-4">
                <p class="text-xs font-bold text-slate-400">좌우로 넘겨 더 많은 상품을 볼 수 있어요</p>
            </div>
            <div class="flex gap-5 overflow-x-auto pb-8 -mx-2 px-2 scrollbar-hide text-left snap-x snap-mandatory">
                ${productHtml}
            </div>
        `;

        planContainer.appendChild(stepEl);
    });
}

/* ─── DOM ready ─────────────────────────────────────────────── */

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
    const cartTabBtn = document.getElementById("cartTabBtn");

    generateEqualizerRays();

    // Load persisted state
    state.searchHistory = loadSearchHistory();
    state.purposeCart = loadCart();
    state.isHistoryPanelCollapsed = loadHistoryPanelState();

    applyHistoryPanelState();
    renderSearchHistory();
    renderCart();
    updateCartBadge();
    updateSearchUI(searchInput?.value || "");

    // Initialise tab (cart is default)
    switchTab("cart");

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

    const campingTag = document.getElementById("campingTag");
    campingTag?.addEventListener("click", () => {
        const value = "캠핑 입문 준비";
        if (searchInput) searchInput.value = value;
        updateSearchUI(value);
        executeSearch(value);
    });

    const desktopTag = document.getElementById("desktopTag");
    desktopTag?.addEventListener("click", () => {
        const value = "데스크탑 조립 세팅";
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

    // Tab buttons
    cartTabBtn?.addEventListener("click", () => switchTab("cart"));

    // 초기 하단 바 상태 반영
    updateBottomCheckoutBar();

    historySidebarToggle?.addEventListener("click", openHistorySidebar);
    closeHistorySidebarBtn?.addEventListener("click", closeHistorySidebar);
    historySidebarBackdrop?.addEventListener("click", closeHistorySidebar);
    collapseHistorySidebarBtn?.addEventListener("click", toggleHistoryPanelCollapse);
});

/* ─── 솔루션 하단 구매하기 CTA ─────────────────────────────── */

function updateBottomCheckoutBar() {
    const cta = document.getElementById("solution-checkout-cta");
    const countEl = document.getElementById("solution-checkout-count");
    const priceEl = document.getElementById("solution-checkout-price");
    if (!cta) return;

    const solutionView = document.getElementById("solution-view");
    const isSolutionVisible = solutionView && !solutionView.classList.contains("hidden");

    const activeSession = getCartSession(state.currentSessionId);
    const totalItems = Object.keys(activeSession?.selectedItems || {}).length;

    if (!isSolutionVisible || totalItems === 0) {
        cta.classList.add("hidden");
        return;
    }

    const { price: totalPrice } = calculateSessionTotals(activeSession);

    if (countEl) countEl.textContent = `${totalItems}개 선택`;
    if (priceEl) priceEl.textContent = totalPrice.toLocaleString() + "원";

    cta.classList.remove("hidden");
}

window.handleBottomCheckout = function handleBottomCheckout() {
    const activeSession = getCartSession(state.currentSessionId);
    if (activeSession) {
        checkoutCart(state.currentSessionId);
    }
};
