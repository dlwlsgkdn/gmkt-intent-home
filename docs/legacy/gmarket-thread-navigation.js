(function () {
    function getSession(sessionId) {
        if (typeof getCartSession !== "function") return null;
        return getCartSession(sessionId);
    }

    function persistThreadState() {
        if (typeof persistCart === "function") persistCart();
        if (typeof renderCart === "function") renderCart();
    }

    function setPhase(sessionId, phase) {
        if (typeof setSessionThreadView === "function") {
            setSessionThreadView(sessionId, phase);
            return;
        }

        const session = getSession(sessionId);
        if (!session) return;
        session.threadView = phase;
        session.updatedAt = new Date().toISOString();
    }

    function ensureBaseThread(sessionId) {
        const session = getSession(sessionId);
        if (!session) return false;

        if (typeof hydrateSessionContext === "function") {
            hydrateSessionContext(sessionId);
        }

        if (typeof window.renderThreadBase === "function") {
            return window.renderThreadBase(session, { persistView: false, scrollIntoView: false });
        }

        if (typeof window.showSolutionThread === "function") {
            window.showSolutionThread(session);
            return true;
        }

        if (typeof hideThreadViews === "function") hideThreadViews();
        if (typeof closePDP === "function") closePDP();
        if (typeof closeDeliveryPanel === "function") closeDeliveryPanel();
        if (typeof renderInfoView === "function") renderInfoView(session.intentKey);
        if (typeof renderSolution === "function") {
            renderSolution(session.intentKey, session.rawQuery || session.intentLabel || session.intentKey);
        }
        if (typeof updateProductCardCartState === "function") {
            updateProductCardCartState(session.intentKey);
        }
        if (typeof updateBottomCheckoutBar === "function") {
            updateBottomCheckoutBar();
        }

        const solutionView = document.getElementById("solution-view");
        solutionView?.classList.remove("hidden");
        return true;
    }

    function fallbackOrderMeta(sessionId) {
        const session = getSession(sessionId);
        if (!session || session.orderMeta) return;

        const latest = typeof state === "object" ? state.latestOrder : null;
        const subtotal = typeof buildSessionOrderItems === "function"
            ? buildSessionOrderItems(sessionId).subtotal
            : 0;

        session.orderMeta = {
            orderNumber: latest?.orderNumber || `GM${Date.now().toString().slice(-8)}`,
            recipient: {
                name: document.getElementById("complete-name")?.textContent || document.getElementById("order-name")?.value || "",
                phone: document.getElementById("complete-phone")?.textContent || document.getElementById("order-phone")?.value || "",
                address: document.getElementById("complete-address")?.textContent || `${document.getElementById("order-address")?.value || ""} ${document.getElementById("order-address-detail")?.value || ""}`.trim()
            },
            totalPrice: document.getElementById("complete-total-price")?.textContent || document.getElementById("order-total-price")?.textContent || `${subtotal.toLocaleString()}원`,
            latestOrder: latest && latest.sessionId === sessionId ? latest : null,
            purchaseConfirmed: false,
            purchaseConfirmedAt: null
        };
    }

    function scrollToPhase(phase) {
        const targetId = phase === "complete" || phase === "confirmed"
            ? "order-complete-view"
            : (phase === "claim" ? "order-claim-view" : (phase === "order" ? "order-view" : "solution-view"));
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function restoreThread(sessionId) {
        const session = getSession(sessionId);
        if (!session) return false;
        const savedPhase = session.orderMeta?.claimMeta?.status
            ? "claim"
            : (session.orderMeta?.purchaseConfirmed ? "confirmed" : (session.threadView || "solution"));

        if (typeof closeHistorySidebar === "function") closeHistorySidebar();
        if (!ensureBaseThread(sessionId)) return false;

        if (savedPhase === "order" || savedPhase === "complete" || savedPhase === "confirmed" || savedPhase === "claim") {
            if (typeof restoreOrderThread === "function") {
                restoreOrderThread(sessionId, { scrollIntoView: false });
            } else if (typeof window.openOrderView === "function") {
                window.openOrderView(sessionId);
            }
        }

        if (savedPhase === "complete" || savedPhase === "confirmed" || savedPhase === "claim") {
            fallbackOrderMeta(sessionId);
            if (typeof restoreCompleteThread === "function") {
                restoreCompleteThread(sessionId);
            }
        }

        if (savedPhase === "claim") {
            fallbackOrderMeta(sessionId);
            if (typeof restoreClaimThread === "function") {
                restoreClaimThread(sessionId);
            }
        }

        setPhase(sessionId, savedPhase);
        persistThreadState();
        scrollToPhase(savedPhase);
        return true;
    }

    window.moveToCartThread = function moveToCartThread(sessionId) {
        restoreThread(sessionId);
    };

    window.continueCartSession = function continueCartSession(sessionId) {
        restoreThread(sessionId);
    };

    const prevOpenOrderView = window.openOrderView;
    if (typeof prevOpenOrderView === "function") {
        window.openOrderView = function openOrderViewWithPhase(sessionId) {
            const result = prevOpenOrderView(sessionId);
            setPhase(sessionId, "order");
            persistThreadState();
            return result;
        };
    }

    const prevCloseOrderView = window.closeOrderView;
    if (typeof prevCloseOrderView === "function") {
        window.closeOrderView = function closeOrderViewWithPhase() {
            const activeSessionId = typeof state === "object" ? state.currentSessionId : "";
            const result = prevCloseOrderView();
            if (activeSessionId) {
                setPhase(activeSessionId, "solution");
                persistThreadState();
            }
            return result;
        };
    }

    const prevGoBackToSolution = window.goBackToSolution;
    if (typeof prevGoBackToSolution === "function") {
        window.goBackToSolution = function goBackToSolutionWithPhase() {
            const activeSessionId = typeof state === "object" ? state.currentSessionId : "";
            const result = prevGoBackToSolution();
            if (activeSessionId) {
                setPhase(activeSessionId, "solution");
                persistThreadState();
            }
            return result;
        };
    }

    const prevSubmitOrder = window.submitOrder;
    if (typeof prevSubmitOrder === "function") {
        window.submitOrder = function submitOrderWithPhase() {
            const activeSessionId = typeof state === "object" ? state.currentSessionId : "";
            const result = prevSubmitOrder();
            const session = getSession(activeSessionId);

            if (session) {
                fallbackOrderMeta(activeSessionId);
                session.orderMeta = {
                    ...(session.orderMeta || {}),
                    orderNumber: document.getElementById("order-complete-number")?.textContent || session.orderMeta?.orderNumber || "",
                    recipient: {
                        name: document.getElementById("complete-name")?.textContent || session.orderMeta?.recipient?.name || "",
                        phone: document.getElementById("complete-phone")?.textContent || session.orderMeta?.recipient?.phone || "",
                        address: document.getElementById("complete-address")?.textContent || session.orderMeta?.recipient?.address || ""
                    },
                    totalPrice: document.getElementById("complete-total-price")?.textContent || document.getElementById("order-total-price")?.textContent || session.orderMeta?.totalPrice || "",
                    latestOrder: typeof state === "object" ? state.latestOrder : null,
                    purchaseConfirmed: session.orderMeta?.purchaseConfirmed || false,
                    purchaseConfirmedAt: session.orderMeta?.purchaseConfirmedAt || null
                };
                setPhase(activeSessionId, "complete");
                persistThreadState();
            }

            return result;
        };
    }
})();
