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
    rawQuery: "",
    choices: { size: "", wall: "", goal: "" },
    searchHistory: [],
    isHistoryPanelCollapsed: false,
    purposeCart: {},      // { intentKey: { intentLabel, rawQuery, selectedItems: { stepIdx: { productIdx, product } } } }
    activeTab: "cart"     // "cart" | "history"
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
        return stored ? JSON.parse(stored) : {};
    } catch (error) {
        return {};
    }
}

function persistCart() {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.purposeCart));
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
    const historyPanel = document.getElementById("history-tab-panel");
    const cartTabBtn = document.getElementById("cartTabBtn");
    const historyTabBtn = document.getElementById("historyTabBtn");

    if (tab === "cart") {
        cartPanel?.classList.remove("hidden");
        historyPanel?.classList.add("hidden");
        cartTabBtn?.classList.add("sidebar-tab-active");
        cartTabBtn?.classList.remove("text-slate-400");
        historyTabBtn?.classList.remove("sidebar-tab-active");
        historyTabBtn?.classList.add("text-slate-400");
    } else {
        historyPanel?.classList.remove("hidden");
        cartPanel?.classList.add("hidden");
        historyTabBtn?.classList.add("sidebar-tab-active");
        historyTabBtn?.classList.remove("text-slate-400");
        cartTabBtn?.classList.remove("sidebar-tab-active");
        cartTabBtn?.classList.add("text-slate-400");
    }
};

/* ─── Cart logic ─────────────────────────────────────────────── */

window.addToCart = function addToCart(intentKey, stepIdx, productIdx) {
    const intentData = solutionData[intentKey];
    if (!intentData) return;

    const product = intentData.steps[stepIdx]?.products[productIdx];
    if (!product) return;

    if (!state.purposeCart[intentKey]) {
        state.purposeCart[intentKey] = {
            intentLabel: intentData.title,
            rawQuery: state.rawQuery,
            selectedItems: {}
        };
    }

    // Toggle: click same product → remove; click different → replace
    const existing = state.purposeCart[intentKey].selectedItems[stepIdx];
    const isSame = existing && existing.productIdx === productIdx;

    if (isSame) {
        delete state.purposeCart[intentKey].selectedItems[stepIdx];
        // Clean up empty intent group
        if (!Object.keys(state.purposeCart[intentKey].selectedItems).length) {
            delete state.purposeCart[intentKey];
        }
    } else {
        state.purposeCart[intentKey].selectedItems[stepIdx] = { productIdx, product };
    }

    persistCart();
    renderCart();
    updateProductCardCartState(intentKey);
    updateCartBadge();

    // Show brief toast
    const toastMsg = isSame
        ? `'${product.name}' 이(가) 장바구니에서 제거됐어요`
        : `'${product.name}' 이(가) 장바구니에 담겼어요 🛒`;
    showMiniToast(toastMsg);
};

window.removeFromCart = function removeFromCart(intentKey, stepIdx) {
    if (!state.purposeCart[intentKey]) return;
    const removed = state.purposeCart[intentKey].selectedItems[stepIdx];
    delete state.purposeCart[intentKey].selectedItems[stepIdx];

    if (!Object.keys(state.purposeCart[intentKey].selectedItems).length) {
        delete state.purposeCart[intentKey];
    }

    persistCart();
    renderCart();
    updateProductCardCartState(intentKey);
    updateCartBadge();

    if (removed) showMiniToast(`'${removed.product.name}' 이(가) 제거됐어요`);
};

window.clearCartIntent = function clearCartIntent(intentKey) {
    delete state.purposeCart[intentKey];
    persistCart();
    renderCart();
    updateProductCardCartState(intentKey);
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

    const cartGroup = state.purposeCart[intentKey];

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

    const cartKeys = Object.keys(state.purposeCart);

    if (!cartKeys.length) {
        cartContent.classList.add("hidden");
        cartEmpty.classList.remove("hidden");
        return;
    }

    cartEmpty.classList.add("hidden");
    cartContent.classList.remove("hidden");

    cartContent.innerHTML = cartKeys.map(intentKey => {
        const cartGroup = state.purposeCart[intentKey];
        const intentData = solutionData[intentKey];
        if (!intentData) return "";

        let subtotal = 0;
        let hasEssentialMissing = false;

        const stepsHtml = intentData.steps.map((step, stepIdx) => {
            const selected = cartGroup.selectedItems[stepIdx];

            if (selected) {
                const priceNum = parseInt(selected.product.price.replace(/,/g, ""), 10) || 0;
                subtotal += priceNum;
                return `
                    <div class="cart-item flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100 cart-item-enter">
                        <img src="${selected.product.img}" class="w-10 h-10 rounded-lg object-cover flex-shrink-0" onerror="this.src='https://images.unsplash.com/photo-1560393464-5c69a73c5770?auto=format&fit=crop&q=80&w=100'" alt="${selected.product.name}">
                        <div class="flex-1 min-w-0">
                            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">${step.name}</p>
                            <p class="text-xs font-bold text-slate-800 truncate leading-tight">${selected.product.name}</p>
                            <p class="text-xs font-bold text-gmarket-blue">${selected.product.price}원</p>
                        </div>
                        <button onclick="removeFromCart('${intentKey}', ${stepIdx})" class="flex-shrink-0 w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-400 transition-colors rounded-full hover:bg-red-50" title="제거">
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

        const selectedCount = Object.keys(cartGroup.selectedItems).length;
        const totalSteps = intentData.steps.length;
        const groupBorder = hasEssentialMissing ? "border-amber-200 bg-amber-50/20" : "border-slate-200 bg-white";

        return `
            <div class="purpose-cart-group border ${groupBorder}">
                <div class="purpose-cart-header px-4 pt-4 pb-3 border-b border-slate-100/80">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold text-gmarket-blue uppercase tracking-[0.16em]">${cartGroup.intentLabel || intentKey}</span>
                        <div class="flex items-center gap-2">
                            <span class="purpose-cart-count text-[10px] text-slate-400 font-bold">${selectedCount}/${totalSteps} 선택</span>
                            <button onclick="clearCartIntent('${intentKey}')" class="text-[10px] text-slate-300 hover:text-red-400 transition-colors font-bold">전체삭제</button>
                        </div>
                    </div>
                    ${hasEssentialMissing ? `<p class="text-[10px] text-amber-500 font-bold mt-1.5 flex items-center gap-1"><span>⚠</span> 미선택 필수 상품이 있어요</p>` : ""}
                </div>
                <div class="purpose-cart-items px-4 py-3 space-y-2">
                    ${stepsHtml}
                </div>
                <div class="purpose-cart-footer px-4 pb-4 pt-2 border-t border-slate-100">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-xs text-slate-400 font-bold">선택 상품 소계</span>
                        <span class="text-sm font-bold text-slate-800">${subtotal.toLocaleString()}원</span>
                    </div>
                    <button onclick="checkoutCart('${intentKey}')" class="w-full py-2.5 bg-gmarket-blue text-white text-sm rounded-xl font-bold transition-all hover:bg-blue-600 active:scale-95">구매하기</button>
                </div>
            </div>
        `;
    }).join("");

    updateBottomCheckoutBar();
}

/* ─── Checkout & warning toast ──────────────────────────────── */

window.checkoutCart = function checkoutCart(intentKey) {
    const cartGroup = state.purposeCart[intentKey];
    const intentData = solutionData[intentKey];
    if (!intentData || !cartGroup) return;

    const missingEssentials = intentData.steps.filter(
        (step, idx) => step.essential && !cartGroup.selectedItems[idx]
    );

    if (missingEssentials.length > 0) {
        showMissingEssentialToast(missingEssentials, intentKey);
    } else {
        openOrderView(intentKey);
    }
};

window.openOrderView = function openOrderView(intentKey) {
    const cartGroup = state.purposeCart[intentKey];
    const intentData = solutionData[intentKey];
    if (!cartGroup || !intentData) return;

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
    const orderView = document.getElementById("order-view");
    if (orderView) {
        orderView.classList.remove("hidden");
        orderView.classList.add("flex", "flex-col");
        setTimeout(() => {
            orderView.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
    }

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
    const completeView = document.getElementById("order-complete-view");
    if (completeView) {
        completeView.classList.remove("hidden");
        completeView.classList.add("flex", "flex-col");
        setTimeout(() => {
            completeView.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
    }
};

function showMissingEssentialToast(missingSteps, intentKey) {
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
                <p class="text-sm font-bold text-slate-900 mb-1">${intentKey === "캠핑" ? "이거 챙기지 않으면 캠핑 현장에서 곤란해요! ⛺" : "이거 빠트리고 커튼 설치 할 뻔 했어요! 😅"}</p>
                <p class="text-xs text-slate-500 leading-relaxed">${stepNames} 상품을 아직 고르지 않으셨어요. 꼭 필요한 상품이에요!</p>
            </div>
            <button onclick="document.getElementById('missing-toast').remove()" class="text-slate-300 hover:text-slate-500 transition-colors flex-shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
        <div class="flex gap-2 mt-5">
            <button onclick="document.getElementById('missing-toast').remove(); switchTab('cart'); if(window.innerWidth < 1024) openHistorySidebar()" class="flex-1 py-2.5 bg-amber-500 text-white text-xs rounded-xl font-bold hover:bg-amber-600 transition-colors">상품 선택하기</button>
            <button onclick="document.getElementById('missing-toast').remove(); openOrderView('${intentKey}')" class="flex-1 py-2.5 bg-slate-100 text-slate-600 text-xs rounded-xl font-bold hover:bg-slate-200 transition-colors">그냥 구매하기</button>
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

function executeSearch(query) {
    const infoView = document.getElementById("info-view");
    if (!query) return;

    if (query.includes("커튼") || query.includes("커텐") || query.includes("而ㅽ듉") || query.includes("而ㅽ뀗")) {
        state.currentIntent = "커튼";
        state.rawQuery = query;
        renderInfoView("커튼");
        infoView?.classList.remove("hidden");
        infoView?.classList.add("flex");
        infoView?.scrollIntoView({ behavior: "smooth" });
    } else if (query.includes("캠핑") || query.includes("텐트") || query.includes("캠프") || query.includes("camping")) {
        state.currentIntent = "캠핑";
        state.rawQuery = query;
        renderInfoView("캠핑");
        infoView?.classList.remove("hidden");
        infoView?.classList.add("flex");
        infoView?.scrollIntoView({ behavior: "smooth" });
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
    }
};

function renderInfoView(intent) {
    const container = document.getElementById("questions-container");
    if (!container) return;
    const cfg = infoViewConfig[intent];
    if (!cfg) return;
    state.choices = { size: "", wall: "", goal: "" };

    const buildQ = (q) => {
        const btnClass = "info-card border-2 border-slate-100 rounded-2xl transition-all bg-slate-50 hover:border-gmarket-blue";
        const buttons = q.options.map(opt => {
            if (opt.row) {
                return `<button onclick="selectChoice(this, '${q.category}')" class="${btnClass} p-4 text-left flex items-center gap-4">
                    <span class="text-xl">${opt.main}</span>
                    <span class="text-xs font-bold text-slate-700">${opt.sub}</span>
                </button>`;
            } else if (opt.icon) {
                return `<button onclick="selectChoice(this, '${q.category}')" class="${btnClass} p-4 text-center group">
                    <span class="block text-xl mb-1">${opt.main}</span>
                    <span class="text-xs font-bold text-slate-700">${opt.sub}</span>
                </button>`;
            } else {
                return `<button onclick="selectChoice(this, '${q.category}')" class="flex-grow ${btnClass} p-4 text-center font-bold">
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
    updateBottomCheckoutBar();
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
    if (pdpCartBtn) {
        const isInCart = state.purposeCart[state.currentIntent]?.selectedItems[stepIdx]?.productIdx === prodIdx;
        pdpCartBtn.classList.toggle("in-cart", isInCart);
        pdpCartBtn.textContent = isInCart ? "✓ 장바구니에 담았어요" : "장바구니";
        pdpCartBtn.onclick = (e) => {
            e.stopPropagation();
            addToCart(state.currentIntent, stepIdx, prodIdx);
            const nowInCart = state.purposeCart[state.currentIntent]?.selectedItems[stepIdx]?.productIdx === prodIdx;
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

        const essentialBadge = step.essential
            ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600 uppercase tracking-wide">필수</span>`
            : `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400 uppercase tracking-wide">선택</span>`;

        const productHtml = step.products
            .map(
                (product, productIndex) => {
                    const isInCart = state.purposeCart[key]?.selectedItems[stepIndex]?.productIdx === productIndex;
                    return `
                    <div
                        data-product-card="${key}-${stepIndex}-${productIndex}"
                        onclick="openPDP(${stepIndex}, ${productIndex})"
                        class="product-card cursor-pointer flex-shrink-0 w-52 md:w-56 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden transition-all duration-300 relative group/card text-left font-bold ${isInCart ? "in-cart" : ""}">
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
                                    data-cart-btn="${key}-${stepIndex}-${productIndex}"
                                    onclick="event.stopPropagation(); addToCart('${key}', ${stepIndex}, ${productIndex})"
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
                <p class="text-slate-500 text-sm leading-relaxed">지마켓 AI가 제안하는 단계별 상품입니다.</p>
            </div>
            <div class="flex gap-5 overflow-x-auto pb-8 -mx-2 px-2 scrollbar-hide text-left">
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
    const historyTabBtn = document.getElementById("historyTabBtn");

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
    historyTabBtn?.addEventListener("click", () => switchTab("history"));

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

    const cartKeys = Object.keys(state.purposeCart);
    const totalItems = getCartItemCount();

    if (!isSolutionVisible || totalItems === 0) {
        cta.classList.add("hidden");
        return;
    }

    let totalPrice = 0;
    cartKeys.forEach(intentKey => {
        const group = state.purposeCart[intentKey];
        Object.values(group.selectedItems).forEach(({ product }) => {
            totalPrice += parseInt(product.price.replace(/,/g, ""), 10) || 0;
        });
    });

    if (countEl) countEl.textContent = `${totalItems}개 선택`;
    if (priceEl) priceEl.textContent = totalPrice.toLocaleString() + "원";

    cta.classList.remove("hidden");
}

window.handleBottomCheckout = function handleBottomCheckout() {
    const cartKeys = Object.keys(state.purposeCart);
    if (!cartKeys.length) return;

    // 현재 인텐트가 카트에 있으면 우선, 없으면 첫 번째 인텐트 사용
    const targetKey = cartKeys.includes(state.currentIntent)
        ? state.currentIntent
        : cartKeys[0];

    checkoutCart(targetKey);
};
