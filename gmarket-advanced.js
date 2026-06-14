/* ─── Page loading overlay ──────────────────────────────── */
let _aiLoadingInterval = null;
let _aiProgressInterval = null;

const AI_SUB_MESSAGES = [
    "고객님의 구매 패턴을 학습하고 있어요",
    "수천 개의 상품 데이터를 비교하고 있어요",
    "최적의 가성비 조합을 계산하고 있어요",
    "리뷰와 평점을 종합 분석하고 있어요",
    "비슷한 고객들의 선택을 참고하고 있어요",
    "할인·쿠폰 적용 가능 여부를 확인하고 있어요",
    "배송 조건까지 고려해서 추천드릴게요",
];

const TIP_MESSAGES = [
    "💡 검색창에 상황을 그대로 적어보세요. 예: '캠핑 첫 입문자 장비 세트'",
    "💡 장바구니는 목적별로 여러 개 만들 수 있어요.",
    "💡 '일괄 결제하고 완수하기'로 선택한 상품을 한 번에 구매할 수 있어요.",
    "💡 조건을 선택하면 이 상황에 \"딱\" 맞는 상품만 골라드려요.",
    "💡 상품 카드를 클릭하면 상세 정보와 리뷰를 바로 확인할 수 있어요.",
    "💡 사이드바에서 진행 중인 장바구니를 언제든 다시 꺼내볼 수 있어요.",
    "💡 검색 태그(#커튼_달기 등)를 눌러 빠르게 탐색할 수 있어요.",
    "💡 여러 목적의 쇼핑을 동시에 진행하고 한 번에 완수해보세요.",
];

function showPageLoading(label = "", mode = "default") {
    const overlay  = document.getElementById("page-loading-overlay");
    const labelEl  = document.getElementById("page-loading-label");
    const subEl    = document.getElementById("page-loading-sublabel");
    const bar      = document.getElementById("ai-progress-bar");
    const bookEl   = document.getElementById("loading-book");
    if (!overlay) return;

    // mode 설정
    const clipboardEl  = document.getElementById("loading-clipboard");
    const payEl        = document.getElementById("loading-pay");
    overlay.dataset.mode = mode;
    if (bookEl)       bookEl.classList.toggle("hidden",      mode !== "book");
    if (clipboardEl)  clipboardEl.classList.toggle("hidden", mode !== "write");
    if (payEl)        payEl.classList.toggle("hidden",       mode !== "pay");

    if (labelEl) labelEl.textContent = label;
    overlay.classList.add("active");

    /* 서브텍스트 순환 — AI 관여 없는 모드(write/celebrate)는 표시 안 함 */
    const AI_MODES = ["default", "book"];
    clearInterval(_aiLoadingInterval);
    if (subEl) {
        const TIP_MODES = ["write", "pay"];
        if (AI_MODES.includes(mode)) {
            let idx = Math.floor(Math.random() * AI_SUB_MESSAGES.length);
            subEl.style.opacity = "0";
            setTimeout(() => { subEl.textContent = AI_SUB_MESSAGES[idx]; subEl.style.opacity = "1"; }, 100);
            _aiLoadingInterval = setInterval(() => {
                subEl.style.opacity = "0";
                setTimeout(() => {
                    idx = (idx + 1) % AI_SUB_MESSAGES.length;
                    subEl.textContent = AI_SUB_MESSAGES[idx];
                    subEl.style.opacity = "1";
                }, 300);
            }, 2200);
        } else if (TIP_MODES.includes(mode)) {
            const tip = TIP_MESSAGES[Math.floor(Math.random() * TIP_MESSAGES.length)];
            subEl.style.opacity = "0";
            setTimeout(() => { subEl.textContent = tip; subEl.style.opacity = "1"; }, 100);
        } else {
            subEl.textContent = "";
            subEl.style.opacity = "0";
        }
    }

    /* 프로그레스 바 */
    if (bar) {
        bar.style.width = "0%";
        let progress = 0;
        clearInterval(_aiProgressInterval);
        _aiProgressInterval = setInterval(() => {
            progress += Math.random() * 12 + 3;
            if (progress > 90) progress = 90;
            bar.style.width = progress + "%";
        }, 400);
    }
}

function hidePageLoading() {
    const overlay  = document.getElementById("page-loading-overlay");
    const bar      = document.getElementById("ai-progress-bar");
    const subEl    = document.getElementById("page-loading-sublabel");
    const bookEl   = document.getElementById("loading-book");
    if (!overlay) return;

    clearInterval(_aiLoadingInterval);
    clearInterval(_aiProgressInterval);

    /* 프로그레스 100%로 채운 후 닫기 */
    if (bar) bar.style.width = "100%";
    setTimeout(() => {
        overlay.classList.remove("active");
        overlay.dataset.mode = "default";
        if (bar) bar.style.width = "0%";
        if (subEl) { subEl.textContent = ""; subEl.style.opacity = "0"; }
        if (bookEl)      bookEl.classList.add("hidden");
    const clipboardEl2 = document.getElementById("loading-clipboard");
    const celebrateEl2 = document.getElementById("loading-celebrate");
    if (clipboardEl2) clipboardEl2.classList.add("hidden");
    const payEl2 = document.getElementById("loading-pay");
    if (payEl2) payEl2.classList.add("hidden");
    }, 350);
}

function withLoading(label, delayMs, fn, mode = "default") {
    showPageLoading(label, mode);
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
    currentScenarioId: "",
    currentSessionId: "",
    rawQuery: "",
    choices: getEmptyChoices(),
    surveyStepIndex: 0,
    isSurveyReviewMode: false,
    searchHistory: [],
    isHistoryPanelCollapsed: false,
    cartAccordionSessionId: "",
    purposeCart: {},      // { sessionId: { intentKey, intentLabel, rawQuery, choices, selectedItems: { stepIdx: { productIdx, product } } } }
    activeTab: "cart",
    latestOrder: null,
    activeDeliveryItemIndex: 0
};

function getEmptyChoices() {
    return { size: "", wall: "", goal: "", skin: "", mood: "", budget: "", occasion: "", experience: "", finish: "", intensity: "", photo: "", photoName: "" };
}

const BEAUTY_SCENARIOS = {
    "출근 10분룩": {
        id: "출근 10분룩",
        baseIntent: "메이크업",
        title: "출근 10분룩 맞춤 제안",
        reason: "짧은 아침 시간에 무너지지 않는 데일리 메이크업을 완성하는 목적",
        skipSurvey: false,
        match: ["출근", "10분", "등교", "데일리"]
    },
    "AI 페이스 메이크오버": {
        id: "AI 페이스 메이크오버",
        baseIntent: "메이크업",
        title: "AI 페이스 메이크오버 제안",
        reason: "얼굴 사진에 원하는 메이크업 무드를 입혀보고 같은 룩을 구현하는 목적",
        skipSurvey: false,
        hasPhotoUpload: true,
        match: ["사진", "얼굴", "ai", "AI", "시뮬레이션", "메이크오버"]
    },
    "립스틱 전색발색": {
        id: "립스틱 전색발색",
        baseIntent: "메이크업",
        title: "립스틱 전색 발색 비교",
        reason: "한 립스틱 라인의 모든 색상을 팔목에 발라 피부톤별 발색과 색상 차이를 비교하는 목적",
        skipSurvey: true,
        defaultChoices: { skin: "웜/쿨 비교", mood: "립스틱 전색 발색", budget: "컬러 비교 우선", occasion: "팔목 발색" },
        match: ["립스틱", "립스팁", "립", "전색", "전색발색", "발색", "팔목", "손목", "스와치", "컬러비교", "색상별"]
    },
    "성분 궁합 체크": {
        id: "성분 궁합 체크",
        baseIntent: "메이크업",
        title: "성분 궁합 체크 제안",
        reason: "민감 피부가 바로 확인할 수 있는 저자극 성분과 기본템 조합을 찾는 목적",
        skipSurvey: true,
        defaultChoices: { skin: "민감성", mood: "저자극 데일리", budget: "10만원 안쪽", occasion: "성분 체크" },
        match: ["성분", "민감", "트러블", "저자극", "궁합"]
    },
    "여행 파우치": {
        id: "여행 파우치",
        baseIntent: "메이크업",
        title: "여행 파우치 뷰티 구성",
        reason: "주말 여행에 필요한 최소 뷰티 파우치를 빠르게 구성하는 목적",
        skipSurvey: true,
        defaultChoices: { skin: "잘 모르겠어요", mood: "간편한 데일리", budget: "5만원 안쪽", occasion: "여행" },
        match: ["여행", "파우치", "1박", "출장", "휴대"]
    }
};

const SAMPLE_FACE_PHOTO = "./makeup-clone-assets/1cebcb36604d1166.avif";
const LIPSTICK_SWATCH_EXAMPLE_URL = "https://unpa.me/tip/detail/50a73d0b-81dd-4d11-b952-6045da3a71be";
const LIPSTICK_SWATCH_EXAMPLE_IMAGE = "https://d33ur1yh5ph6b5.cloudfront.net/2ed3f6d9-cf79-41af-bd8b-6e434d972fc2-mid";

function getLipstickSwatchSolutionData() {
    return {
        title: "립스틱 전색 발색 비교",
        intentReason: "팔목 발색 이미지 기준으로 웜톤 립 컬러와 제형을 비교하고 구매 후보를 좁히는 목적",
        steps: [
            {
                step: 1,
                name: "팔목 발색 기준 컬러",
                essential: true,
                description: "이미지 속 6개 컬러를 기준으로 누드, 코랄, 브릭, 글로스 계열을 먼저 나눠 비교합니다.",
                products: [
                    {
                        id: 9101,
                        name: "롬앤 제로매트 립스틱 쉘누드",
                        price: "9,900",
                        originalPrice: "13,000",
                        score: 97,
                        img: "https://images.unsplash.com/photo-1586495777744-4413f21062fa?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "이미지의 쉘누드처럼 베이스로 깔기 좋은 누드 코랄 계열입니다.",
                            "다른 립을 겹쳐 바를 때 색을 부드럽게 정돈하는 역할이 좋습니다.",
                            "흰기가 있는 누드가 피부 위에서 뜨는지 확인하기 좋은 기준 컬러입니다."
                        ],
                        spec: { size: "3.5g", feature: "누드 코랄 매트 립스틱" }
                    },
                    {
                        id: 9102,
                        name: "페리페라 잉크 무드 매트 립스틱 로즈픽션",
                        price: "10,800",
                        originalPrice: "15,000",
                        score: 94,
                        img: "https://images.unsplash.com/photo-1599305090598-fe179d501227?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "김여주집합처럼 핑크 레드 계열을 비교할 때 기준으로 삼기 좋습니다.",
                            "코랄보다 로즈기가 올라오는 컬러가 피부를 밝히는지 볼 수 있습니다.",
                            "매트하지만 너무 건조해 보이지 않는 중간 채도의 후보입니다."
                        ],
                        spec: { size: "3g", feature: "핑크 레드 매트 립스틱" }
                    },
                    {
                        id: 9103,
                        name: "웨이크메이크 워터 블러링 틴트 소프트브릭",
                        price: "12,600",
                        originalPrice: "18,000",
                        score: 96,
                        img: "https://images.unsplash.com/photo-1631730486572-226d1f595b68?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "이미지의 소프트브릭처럼 웜톤에서 얼굴을 또렷하게 잡는 브릭 레드 계열입니다.",
                            "코랄보다 깊고 레드보다 부드러운 색을 찾을 때 우선 비교할 만합니다.",
                            "착색과 지속력을 함께 보는 전색발색 시나리오에 잘 맞습니다."
                        ],
                        spec: { size: "3.5g", feature: "브릭 레드 블러 틴트" }
                    }
                ]
            },
            {
                step: 2,
                name: "코랄과 피치 후보",
                essential: true,
                description: "월간코랄, 퍼지코랄처럼 화사한 웜톤 컬러를 실제 피부 위에서 밝기와 채도 중심으로 비교합니다.",
                products: [
                    {
                        id: 9201,
                        name: "페리페라 잉크 무드 매트 틴트 스모키코랄",
                        price: "8,900",
                        originalPrice: "12,000",
                        score: 95,
                        img: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "월간코랄처럼 핑크가 섞인 코랄 후보를 비교하기 좋습니다.",
                            "너무 형광으로 올라오지 않는지 팔목 발색에서 먼저 확인할 수 있습니다.",
                            "봄웜 데일리 립 후보로 장바구니 우선순위가 높습니다."
                        ],
                        spec: { size: "4g", feature: "핑크 코랄 매트 틴트" }
                    },
                    {
                        id: 9202,
                        name: "하킷 레이어 퍼지 틴트 퍼지코랄",
                        price: "13,200",
                        originalPrice: "19,000",
                        score: 92,
                        img: "https://images.unsplash.com/photo-1615397349754-cfa2066a298e?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "퍼지코랄처럼 따뜻한 피치 코랄 계열을 확인하기 좋은 후보입니다.",
                            "베이스 립 위에 얹었을 때 생기가 더해지는지 보기 좋습니다.",
                            "묻어남과 밀착감을 함께 확인해야 하는 제형이라 비교 구매에 적합합니다."
                        ],
                        spec: { size: "4.2g", feature: "피치 코랄 퍼지 틴트" }
                    },
                    {
                        id: 9203,
                        name: "데이지크 무드 글로우 립스틱 핑크베리",
                        price: "15,900",
                        originalPrice: "22,000",
                        score: 88,
                        img: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "코랄보다 맑은 핑크기가 필요한 경우 비교할 수 있는 글로우 후보입니다.",
                            "팔목에서 투명하게 올라오는지, 입술에서 탁해지는지 확인하기 좋습니다.",
                            "매트 립이 부담스러운 사용자에게 대안이 됩니다."
                        ],
                        spec: { size: "3g", feature: "글로우 핑크 베리 립스틱" }
                    }
                ]
            },
            {
                step: 3,
                name: "글로스와 레이어링",
                essential: false,
                description: "나이트마린처럼 단독 색보다 광택과 펄감으로 립 컬러를 바꾸는 제품을 레이어링 후보로 봅니다.",
                products: [
                    {
                        id: 9301,
                        name: "롬앤 글래스팅 워터 글로스 나이트마린",
                        price: "8,900",
                        originalPrice: "12,000",
                        score: 93,
                        img: "https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "이미지 속 나이트마린처럼 컬러보다 투명 광택과 펄감을 확인하는 제품입니다.",
                            "매트 립 위에 얹어 색을 부드럽게 풀어주는 용도로 좋습니다.",
                            "팔목 발색에서는 투명도와 반짝임이 과하지 않은지 보기 쉽습니다."
                        ],
                        spec: { size: "4.5g", feature: "투명 펄 워터 글로스" }
                    },
                    {
                        id: 9302,
                        name: "코랄 립 베이스 밤",
                        price: "7,900",
                        originalPrice: "11,000",
                        score: 87,
                        img: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "쉘누드나 퍼지코랄 아래에 깔아 입술 바탕색을 정돈하기 좋습니다.",
                            "립스틱 전색 비교 전 입술 컨디션을 맞춰 실패를 줄입니다.",
                            "색이 강한 제품을 부담스럽지 않게 희석하는 역할을 합니다."
                        ],
                        spec: { size: "3.8g", feature: "코랄 보정 컬러 립밤" }
                    },
                    {
                        id: 9303,
                        name: "립 프라이머 스무딩 밤",
                        price: "9,500",
                        originalPrice: "14,000",
                        score: 84,
                        img: "https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "매트 립의 주름 부각을 줄이고 실제 발색을 더 고르게 보여줍니다.",
                            "팔목 발색은 예쁜데 입술에서 뭉치는 제품을 걸러내는 데 도움이 됩니다.",
                            "립 비교를 자주 하는 사용자에게 보조템으로 적합합니다."
                        ],
                        spec: { size: "3g", feature: "립결 보정 프라이머" }
                    }
                ]
            },
            {
                step: 4,
                name: "발색 확인 도구",
                essential: false,
                description: "전색발색은 같은 조명, 같은 양, 같은 순서로 비교해야 차이가 정확히 보이므로 보조 도구를 함께 구성합니다.",
                products: [
                    {
                        id: 9401,
                        name: "실리콘 립 브러시 2종 세트",
                        price: "6,900",
                        originalPrice: "9,900",
                        score: 91,
                        img: "https://images.unsplash.com/photo-1522338242992-e1a54906a8da?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "색상별 발색량을 일정하게 맞추기 쉬운 도구입니다.",
                            "팔목에 직사각형으로 펴 바를 때 경계가 깔끔하게 잡힙니다.",
                            "여러 립을 비교할 때 위생적으로 닦아가며 쓰기 좋습니다."
                        ],
                        spec: { size: "2종", feature: "실리콘 팁 립 브러시" }
                    },
                    {
                        id: 9402,
                        name: "포인트 메이크업 리무버 패드",
                        price: "7,500",
                        originalPrice: "10,000",
                        score: 89,
                        img: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "전색발색 후 팔목에 남는 착색을 확인하고 깔끔하게 지울 수 있습니다.",
                            "착색이 강한 틴트와 립스틱 비교에 특히 필요합니다.",
                            "리뷰용 발색을 반복할 때 피부 자극을 줄이는 선택입니다."
                        ],
                        spec: { size: "30매", feature: "립앤아이 리무버 패드" }
                    },
                    {
                        id: 9403,
                        name: "휴대용 자연광 LED 미러",
                        price: "18,900",
                        originalPrice: "27,000",
                        score: 86,
                        img: "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "조명 차이로 립 컬러가 다르게 보이는 문제를 줄여줍니다.",
                            "발색 이미지를 찍거나 실제 입술 위 색을 확인할 때 유용합니다.",
                            "온라인 구매 전 비교 기준을 일정하게 만드는 보조 도구입니다."
                        ],
                        spec: { size: "휴대형", feature: "3단 밝기 LED 미러" }
                    }
                ]
            }
        ]
    };
}

function ensureBeautyScenarioSolutionData() {
    Object.values(BEAUTY_SCENARIOS).forEach((scenario) => {
        if (scenario.id === "립스틱 전색발색") {
            solutionData[scenario.id] = getLipstickSwatchSolutionData();
            return;
        }
        const baseData = solutionData[scenario.baseIntent];
        if (baseData && !solutionData[scenario.id]) {
            solutionData[scenario.id] = {
                ...baseData,
                title: scenario.title,
                intentReason: scenario.reason
            };
        }
    });
}

ensureBeautyScenarioSolutionData();

function getBeautyScenario(intentOrQuery = "") {
    const value = String(intentOrQuery || "");
    if (BEAUTY_SCENARIOS[value]) return BEAUTY_SCENARIOS[value];

    const lowered = value.toLowerCase();
    return Object.values(BEAUTY_SCENARIOS).find((scenario) => (
        scenario.match.some((keyword) => lowered.includes(String(keyword).toLowerCase()))
    )) || null;
}

function isSurveySkipped(intent = state.currentIntent) {
    return Boolean(getBeautyScenario(intent)?.skipSurvey);
}

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
            orderMeta: value.orderMeta || null,
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
            scenarioId: state.currentScenarioId || intentKey,
            intentLabel: solutionData[intentKey]?.title || intentKey,
            rawQuery: state.rawQuery,
            selectionSummary: buildHistorySummary(),
            recommendationSummary: solutionData[intentKey]?.intentReason || "",
            choices: { ...state.choices },
            selectedItems: {},
            threadView: "solution",
            orderMeta: null,
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

function setSessionThreadView(sessionId, threadView) {
    const session = getCartSession(sessionId);
    if (!session) return;

    session.threadView = threadView;
    session.updatedAt = new Date().toISOString();
}

function buildSessionOrderItems(sessionId) {
    const session = getCartSession(sessionId);
    const intentData = solutionData[session?.intentKey];
    if (!session || !intentData) {
        return { itemsHtml: "", subtotal: 0, itemCount: 0 };
    }

    let subtotal = 0;
    let itemCount = 0;
    let itemsHtml = "";

    intentData.steps.forEach((step, stepIdx) => {
        const selected = session.selectedItems[stepIdx];
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
                    <p class="text-sm font-medium text-slate-800 leading-tight truncate">${selected.product.name}</p>
                    <p class="text-xs text-slate-400 font-normal mt-0.5">\uC218\uB7C9 1\uAC1C</p>
                </div>
                <p class="text-sm font-bold text-slate-800 flex-shrink-0">${selected.product.price}\uC6D0</p>
            </div>
        `;
    });

    return { itemsHtml, subtotal, itemCount };
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

const DELIVERY_STAGES = [
    {
        label: "\uACB0\uC81C\uC644\uB8CC",
        description: "\uC8FC\uBB38\uACFC \uACB0\uC81C\uAC00 \uC815\uC0C1\uC801\uC73C\uB85C \uC811\uC218\uB418\uC5C8\uC5B4\uC694."
    },
    {
        label: "\uC0C1\uD488\uC900\uBE44\uC911",
        description: "\uD310\uB9E4\uC790\uAC00 \uC7AC\uACE0\uB97C \uD655\uC778\uD558\uACE0 \uC548\uC804\uD558\uAC8C \uD3EC\uC7A5\uD558\uACE0 \uC788\uC5B4\uC694."
    },
    {
        label: "\uCD9C\uACE0\uC900\uBE44\uC911",
        description: "\uD0DD\uBC30\uC0AC \uC778\uACC4\uB97C \uC704\uD574 \uC1A1\uC7A5 \uB4F1\uB85D\uACFC \uC9D1\uD654 \uC900\uBE44\uB97C \uC9C4\uD589\uD558\uACE0 \uC788\uC5B4\uC694."
    },
    {
        label: "\uBC30\uC1A1\uC644\uB8CC",
        description: "\uBC30\uC1A1\uC774 \uC644\uB8CC\uB418\uBA74 \uC218\uB839 \uC548\uB0B4\uC640 \uD568\uAED8 \uC0C1\uD0DC\uAC00 \uC5C5\uB370\uC774\uD2B8\uB3FC\uC694."
    }
];

function formatDeliveryDate(dateLike) {
    try {
        return new Intl.DateTimeFormat("ko-KR", {
            month: "long",
            day: "numeric",
            weekday: "short"
        }).format(new Date(dateLike));
    } catch (error) {
        return "";
    }
}

function getDeliveryStatusMeta(statusIndex) {
    const safeIndex = Math.max(0, Math.min(statusIndex, DELIVERY_STAGES.length - 1));
    const stage = DELIVERY_STAGES[safeIndex];
    const progressMap = [18, 42, 68, 100];
    const badgeClassMap = [
        "bg-slate-100 text-slate-600",
        "bg-amber-50 text-amber-600",
        "bg-blue-50 text-blue-600",
        "bg-emerald-50 text-emerald-600"
    ];

    return {
        ...stage,
        progress: progressMap[safeIndex],
        badgeClass: badgeClassMap[safeIndex]
    };
}

function buildLatestOrderData(sessionId, orderNumber) {
    const session = getCartSession(sessionId);
    const intentData = solutionData[session?.intentKey];
    if (!session || !intentData) return null;

    const now = new Date();
    const selectedEntries = Object.entries(session.selectedItems || {})
        .sort((a, b) => Number(a[0]) - Number(b[0]));

    const items = selectedEntries.map(([stepIdx, selected], index) => {
        const step = intentData.steps[stepIdx];
        const expectedDate = new Date(now.getTime() + (index % 2 === 0 ? 2 : 3) * 24 * 60 * 60 * 1000);
        return {
            stepName: step?.name || `Step ${Number(stepIdx) + 1}`,
            product: selected.product,
            expectedDate: expectedDate.toISOString(),
            courier: "\uC2A4\uB9C8\uC77C\uBC30\uC1A1",
            trackingNumber: `${orderNumber}-${String(index + 1).padStart(2, "0")}`,
            statusIndex: index === 0 ? 2 : 1
        };
    });

    return {
        sessionId,
        intentKey: session.intentKey,
        orderNumber,
        createdAt: now.toISOString(),
        recipient: {
            name: document.getElementById("order-name")?.value || "",
            phone: document.getElementById("order-phone")?.value || "",
            address: `${document.getElementById("order-address")?.value || ""} ${document.getElementById("order-address-detail")?.value || ""}`.trim()
        },
        items,
        totalPrice: calculateSessionTotals(session).price
    };
}

function hydrateSessionContext(sessionId) {
    const session = getCartSession(sessionId);
    if (!session) return;

    state.currentSessionId = sessionId;
    state.currentIntent = session.intentKey;
    state.currentScenarioId = session.scenarioId || session.intentKey;
    state.rawQuery = session.rawQuery || "";
    state.choices = { ...getEmptyChoices(), ...(session.choices || {}) };
    state.surveyStepIndex = 0;

    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.value = state.rawQuery;
        updateSearchUI(state.rawQuery);
        autoResizeTextarea(searchInput);
    }
}

function getCurrentVisibleThreadView() {
    if (getSessionEffectiveThreadView(getCartSession(state.currentSessionId)) === "claim") return "claim";
    if (!document.getElementById("order-claim-view")?.classList.contains("hidden")) return "claim";
    if (!document.getElementById("order-complete-view")?.classList.contains("hidden")) {
        return getCartSession(state.currentSessionId)?.orderMeta?.purchaseConfirmed ? "confirmed" : "complete";
    }
    if (!document.getElementById("order-view")?.classList.contains("hidden")) return "order";
    if (!document.getElementById("solution-view")?.classList.contains("hidden")) return "solution";
    return "info";
}

function getRequiredSurveyCategories(intent = state.currentIntent) {
    const cfg = infoViewConfig[intent];
    return cfg ? Object.keys(cfg).filter(k => k.startsWith("q")).map(k => cfg[k].category) : ["size", "wall", "goal"];
}

function isSurveyComplete(intent = state.currentIntent) {
    if (!intent) return false;
    if (isSurveySkipped(intent)) return true;
    return getSurveyQuestions(intent).every((question) => isQuestionAnswered(question));
}

function getCleanThreadPhase() {
    if (document.body.classList.contains("clean-solution-active")) return "solution";
    if (document.body.classList.contains("clean-survey-active")) return "survey";
    return "home";
}

function updateThreadStepper() {
    const stepper = document.getElementById("thread-stepper");
    if (!stepper) return;

    const phase = getCleanThreadPhase();
    const shouldShow = document.body.classList.contains("clean-home-page")
        && phase !== "home"
        && Boolean(state.currentIntent || state.rawQuery || state.currentSessionId);
    stepper.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) return;

    const canSurvey = Boolean(state.currentIntent && infoViewConfig[state.currentIntent] && !isSurveySkipped(state.currentIntent));
    const canSolution = Boolean(state.currentIntent) && (isSurveySkipped(state.currentIntent) || isSurveyComplete(state.currentIntent));

    stepper.querySelectorAll("[data-thread-step]").forEach((button) => {
        const target = button.dataset.threadStep;
        const disabled = (target === "survey" && !canSurvey) || (target === "solution" && !canSolution);
        button.disabled = disabled;
        button.classList.toggle("is-active", target === phase);
        if (target === phase) {
            button.setAttribute("aria-current", "step");
        } else {
            button.removeAttribute("aria-current");
        }
    });
}

function hideThreadViews() {
    const infoView = document.getElementById("info-view");
    const solutionView = document.getElementById("solution-view");
    const orderView = document.getElementById("order-view");
    const completeView = document.getElementById("order-complete-view");
    const claimView = document.getElementById("order-claim-view");

    infoView?.classList.add("hidden");
    infoView?.classList.remove("flex");
    solutionView?.classList.add("hidden");
    orderView?.classList.add("hidden");
    orderView?.classList.remove("flex", "flex-col");
    completeView?.classList.add("hidden");
    completeView?.classList.remove("flex", "flex-col");
    claimView?.classList.add("hidden");
    claimView?.classList.remove("flex", "flex-col");
    closeDeliveryPanel();
    closeClaimStatusPanel();
}

function goThreadPhase(phase) {
    const homeView = document.getElementById("home-view");
    const infoView = document.getElementById("info-view");
    const solutionView = document.getElementById("solution-view");

    if (phase === "home") {
        hideThreadViews();
        document.body.classList.remove("clean-survey-active", "clean-solution-active");
        state.isSurveyReviewMode = false;
        updateThreadStepper();
        requestAnimationFrame(() => scrollToSection(homeView));
        return;
    }

    if (phase === "survey") {
        if (!state.currentIntent || !infoViewConfig[state.currentIntent] || isSurveySkipped(state.currentIntent)) return;
        const session = getCartSession(state.currentSessionId);
        const effectiveView = getSessionEffectiveThreadView(session);
        state.isSurveyReviewMode = Boolean(session && effectiveView !== "info");
        hideThreadViews();
        renderInfoView(state.currentIntent);
        infoView?.classList.remove("hidden");
        infoView?.classList.add("flex");
        if (document.body.classList.contains("clean-home-page")) {
            document.body.classList.add("clean-survey-active");
            document.body.classList.remove("clean-solution-active");
        }
        updateThreadStepper();
        requestAnimationFrame(() => scrollToSection(infoView));
        return;
    }

    if (phase === "solution") {
        if (!state.currentIntent || (!isSurveySkipped(state.currentIntent) && !isSurveyComplete(state.currentIntent))) return;
        state.isSurveyReviewMode = false;
        ensureSurveyResultSession();
        hideThreadViews();
        renderInfoView(state.currentIntent);
        renderSolution(state.currentIntent, state.rawQuery || state.currentIntent);
        updateProductCardCartState(state.currentIntent);
        updateBottomCheckoutBar();
        solutionView?.classList.remove("hidden");
        if (document.body.classList.contains("clean-home-page")) {
            document.body.classList.remove("clean-survey-active");
            document.body.classList.add("clean-solution-active");
        }
        setSessionThreadView(state.currentSessionId, "solution");
        persistCart();
        renderCart();
        syncTransactionLocks(state.currentSessionId);
        updateThreadStepper();
        requestAnimationFrame(() => scrollToSection(solutionView));
    }
}

window.goThreadPhase = goThreadPhase;
globalThis.goThreadPhase = goThreadPhase;

function showSolutionThread(session) {
    const solutionView = document.getElementById("solution-view");
    if (!session || !solutionView) return;

    hideThreadViews();
    closePDP();
    closeDeliveryPanel();

    setSessionThreadView(state.currentSessionId, "solution");
    persistCart();
    renderCart();

    renderInfoView(session.intentKey);
    renderSolution(session.intentKey, session.rawQuery || session.intentLabel || session.intentKey);
    updateProductCardCartState(session.intentKey);
    updateBottomCheckoutBar();
    syncTransactionLocks(state.currentSessionId);

    solutionView.classList.remove("hidden");
    if (document.body.classList.contains("clean-home-page")) {
        document.body.classList.remove("clean-survey-active");
        document.body.classList.add("clean-solution-active");
    }
    updateThreadStepper();

    requestAnimationFrame(() => {
        scrollToSection(solutionView);
    });
}

window.showSolutionThread = showSolutionThread;

function renderThreadBase(session, options = {}) {
    const { scrollIntoView = false, persistView = false } = options;
    const solutionView = document.getElementById("solution-view");
    if (!session || !solutionView) return false;

    hideThreadViews();
    closePDP();
    closeDeliveryPanel();

    renderInfoView(session.intentKey);
    renderSolution(session.intentKey, session.rawQuery || session.intentLabel || session.intentKey);
    updateProductCardCartState(session.intentKey);
    updateBottomCheckoutBar();
    syncTransactionLocks(state.currentSessionId);

    solutionView.classList.remove("hidden");
    if (document.body.classList.contains("clean-home-page")) {
        document.body.classList.remove("clean-survey-active");
        document.body.classList.add("clean-solution-active");
    }
    updateThreadStepper();

    if (persistView) {
        setSessionThreadView(state.currentSessionId, "solution");
        persistCart();
        renderCart();
    }

    if (scrollIntoView) {
        requestAnimationFrame(() => {
            scrollToSection(solutionView);
        });
    }

    return true;
}

window.renderThreadBase = renderThreadBase;

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
                                <span class="history-item-time text-[11px] text-slate-400 font-normal">${formatHistoryTimestamp(item.createdAt)}</span>
                            </div>
                            <p class="history-item-query text-[15px] text-slate-800 font-semibold leading-snug break-words">${item.query}</p>
                            <p class="history-item-summary text-xs text-slate-500 mt-2 font-normal leading-relaxed">${item.summary}</p>
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
    return Object.entries(state.choices)
        .filter(([key, value]) => Boolean(value) && key !== "photo" && key !== "photoName")
        .map(([, value]) => value)
        .join(" / ");
}

function buildCartGroupSummary(cartGroup, intentData) {
    if (cartGroup?.selectionSummary) return cartGroup.selectionSummary;
    if (cartGroup?.rawQuery) return `"${cartGroup.rawQuery}" 기준 추천`;
    return intentData?.intentReason || "";
}

function getClaimTypeLabel(type) {
    const labelMap = {
        cancel: "\uCDE8\uC18C",
        return: "\uBC18\uD488",
        exchange: "\uAD50\uD658"
    };
    return labelMap[type] || "\uC2E0\uCCAD";
}

function getClaimPhaseLabel(claimMeta) {
    if (!claimMeta?.status) return "\uCDE8\uC18C/\uBC18\uD488/\uAD50\uD658 \uC2E0\uCCAD";
    return `${getClaimTypeLabel(claimMeta.type)} \uC9C4\uD589\uC911`;
}

function getSessionEffectiveThreadView(session) {
    if (!session) return "solution";
    if (session.orderMeta?.claimMeta?.status) return "claim";
    if (session.orderMeta?.purchaseConfirmed) return "confirmed";
    return session.threadView || "solution";
}

function getThreadPhaseRank(threadView) {
    const rankMap = {
        info: 0,
        solution: 0,
        order: 1,
        complete: 2,
        claim: 3,
        confirmed: 4
    };
    return rankMap[threadView] ?? 0;
}

function syncTransactionLocks(sessionId = state.currentSessionId) {
    const session = getCartSession(sessionId);
    const effectiveThreadView = getSessionEffectiveThreadView(session);
    const phaseRank = getThreadPhaseRank(effectiveThreadView);
    const toggleDisabled = (selector, disabled) => {
        document.querySelectorAll(selector).forEach((element) => {
            element.disabled = disabled;
            element.classList.toggle("opacity-50", disabled);
            element.classList.toggle("cursor-not-allowed", disabled);
        });
    };

    toggleDisabled("#info-view button", phaseRank >= 1);
    toggleDisabled("[data-cart-btn], #pdp-cart-btn", phaseRank >= 1);
    toggleDisabled("#order-view input, #order-view select, #order-view textarea, #order-view button", phaseRank >= 2);
    toggleDisabled("#complete-delivery-btn, #complete-claim-btn, #complete-confirm-btn", phaseRank >= 3);

    syncCompleteActionButtons(session?.orderMeta || null);
    syncClaimFormState(session?.orderMeta?.claimMeta || {});

    if (phaseRank >= 3) {
        toggleDisabled("#complete-delivery-btn, #complete-claim-btn, #complete-confirm-btn", true);
    }
}

function saveSearchHistory() {
    const query = state.rawQuery?.trim();
    if (!query || !state.currentIntent) return;
    const historyChoices = { ...state.choices };
    if (historyChoices.photo) historyChoices.photo = "";

    const nextEntry = {
        query,
        intent: state.currentIntent,
        summary: buildHistorySummary(),
        choices: historyChoices,
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
        autoResizeTextarea(searchInput);
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

    sidebar.classList.remove("-translate-x-full");
    sidebar.classList.add("history-sidebar-open");
    sidebar.style.setProperty("transform", "translateX(0)", "important");
    backdrop.classList.remove("hidden");
    document.body.classList.add("history-sidebar-active");
    syncHistorySidebarToggleState(true);
}

function closeHistorySidebar() {
    const sidebar = document.getElementById("history-panel");
    const backdrop = document.getElementById("history-sidebar-backdrop");
    if (!sidebar || !backdrop) return;

    sidebar.classList.remove("history-sidebar-open");
    sidebar.classList.add("-translate-x-full");
    sidebar.style.setProperty("transform", "translateX(-100%)", "important");
    backdrop.classList.add("hidden");
    document.body.classList.remove("history-sidebar-active");
    syncHistorySidebarToggleState(false);
}

function toggleHistorySidebar() {
    const sidebar = document.getElementById("history-panel");
    if (!sidebar) return;

    if (sidebar.classList.contains("history-sidebar-open")) {
        closeHistorySidebar();
    } else {
        openHistorySidebar();
    }
}

function syncHistorySidebarToggleState(isOpen) {
    const toggleBtn = document.getElementById("historySidebarToggle");
    if (!toggleBtn) return;

    toggleBtn.setAttribute("aria-expanded", String(isOpen));
    toggleBtn.setAttribute("aria-label", isOpen ? "쇼핑 쓰레드 닫기" : "쇼핑 쓰레드 열기");
    toggleBtn.classList.toggle("history-sidebar-toggle-active", isOpen);
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
    const threadStepper = document.getElementById("thread-stepper");

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
        if (state.cartAccordionSessionId === sessionId) {
            state.cartAccordionSessionId = "";
        }
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
    if (state.cartAccordionSessionId === sessionId) {
        state.cartAccordionSessionId = "";
    }
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

window.toggleCartAccordion = function toggleCartAccordion(sessionId) {
    state.cartAccordionSessionId = state.cartAccordionSessionId === sessionId ? "" : sessionId;
    renderCart();
};

function renderCart() {
    const cartContent = document.getElementById("cart-content");
    const cartEmpty = document.getElementById("cart-empty");

    if (!cartContent || !cartEmpty) return;

    const cartKeys = Object.keys(state.purposeCart).sort((a, b) => {
        const aTime = new Date(state.purposeCart[a]?.createdAt || 0).getTime();
        const bTime = new Date(state.purposeCart[b]?.createdAt || 0).getTime();
        return bTime - aTime;
    });

    if (!cartKeys.length) {
        state.cartAccordionSessionId = "";
        cartContent.classList.add("hidden");
        cartEmpty.classList.remove("hidden");
        return;
    }

    if (state.cartAccordionSessionId && !cartKeys.includes(state.cartAccordionSessionId)) {
        state.cartAccordionSessionId = "";
    }

    cartEmpty.classList.add("hidden");
    cartContent.classList.remove("hidden");

    cartContent.innerHTML = cartKeys.map(sessionId => {
        const cartGroup = state.purposeCart[sessionId];
        const intentData = solutionData[cartGroup.intentKey];
        if (!intentData) return "";
        const groupSummary = buildCartGroupSummary(cartGroup, intentData);
        const { count: selectedCount, price: subtotal } = calculateSessionTotals(cartGroup);
        const effectiveThreadView = getSessionEffectiveThreadView(cartGroup);
        const phaseLabelMap = {
            info: "\uC124\uBB38 \uC218\uC815 \uC911",
            solution: "\uC0C1\uD488 \uBE44\uAD50 \uC911",
            order: "\uC8FC\uBB38\uC11C \uC791\uC131 \uC911",
            complete: "\uC8FC\uBB38 \uC644\uB8CC",
            claim: "\uCDE8\uC18C/\uBC18\uD488/\uAD50\uD658 \uC2E0\uCCAD",
            confirmed: "\uAD6C\uB9E4\uD655\uC815"
        };
        const phaseLabel = effectiveThreadView === "claim"
            ? getClaimPhaseLabel(cartGroup.orderMeta?.claimMeta)
            : (phaseLabelMap[effectiveThreadView] || "\uC0C1\uD488 \uBE44\uAD50 \uC911");
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
            <div class="purpose-cart-group border ${groupBorder}" data-session-id="${sessionId}">
                <div class="purpose-cart-header px-4 pt-4 pb-3 border-b border-slate-100/80">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold text-gmarket-blue uppercase tracking-[0.16em]">${cartGroup.intentLabel || cartGroup.intentKey}</span>
                        <div class="flex items-center gap-2">
                            <span class="purpose-cart-count text-[10px] text-slate-400 font-bold">${selectedCount}/${totalSteps} 선택</span>
                            <button type="button" data-cart-clear="true" onclick="clearCartIntent('${sessionId}')" class="text-[10px] text-slate-300 hover:text-red-400 transition-colors font-bold">전체삭제</button>
                        </div>
                    </div>
                    ${groupSummary ? `<p class="purpose-cart-summary-preview text-[11px] text-slate-500 font-normal mt-2 leading-relaxed">${groupSummary}</p>` : ""}
                    <p class="text-[10px] text-slate-400 font-normal mt-2">\uB9C8\uC9C0\uB9C9 \uD398\uC774\uC988: <span class="text-slate-700">${phaseLabel}</span></p>
                    ${hasEssentialMissing ? `<p class="text-[10px] text-amber-500 font-medium mt-1.5 flex items-center gap-1"><span>⚠</span> 미선택 필수 상품이 있어요</p>` : ""}
                </div>
                <div class="purpose-cart-items px-4 py-3 space-y-2">
                    ${stepsHtml}
                </div>
                <div class="purpose-cart-footer px-4 pb-4 pt-2 border-t border-slate-100">
                    <div class="flex justify-between items-center mb-3">
                        <span class="text-xs text-slate-400 font-bold">\uD569\uACC4</span>
                        <span class="text-sm font-bold text-slate-800">${subtotal.toLocaleString()}\uC6D0</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <button onclick="moveToCartThread('${sessionId}')" class="w-full py-2.5 bg-slate-100 text-slate-700 text-sm rounded-xl font-bold transition-all hover:bg-slate-200 active:scale-95">\uC4F0\uB808\uB4DC \uC774\uB3D9</button>
                        <button onclick="checkoutCart('${sessionId}')" class="w-full py-2.5 bg-gmarket-blue text-white text-sm rounded-xl font-bold transition-all hover:bg-blue-600 active:scale-95">\uC8FC\uBB38\uD558\uAE30</button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    cartContent.querySelectorAll(".purpose-cart-group").forEach(groupEl => {
        const sessionId = groupEl.dataset.sessionId;
        const headerEl = groupEl.querySelector(".purpose-cart-header");
        const metaEl = headerEl?.querySelector(".flex.items-center.gap-2");
        const itemsEl = groupEl.querySelector(".purpose-cart-items");
        const footerEl = groupEl.querySelector(".purpose-cart-footer");
        if (!sessionId || !headerEl || !itemsEl || !footerEl) return;

        const isExpanded = state.cartAccordionSessionId === sessionId;
        groupEl.classList.toggle("purpose-cart-group-expanded", isExpanded);
        groupEl.classList.toggle("purpose-cart-group-collapsed", !isExpanded);

        headerEl.classList.add("purpose-cart-accordion-header");
        headerEl.setAttribute("role", "button");
        headerEl.setAttribute("tabindex", "0");
        headerEl.setAttribute("aria-expanded", isExpanded ? "true" : "false");

        itemsEl.classList.toggle("hidden", !isExpanded);
        footerEl.classList.toggle("hidden", !isExpanded);

        let chevronEl = headerEl.querySelector(".purpose-cart-chevron");
        if (!chevronEl) {
            chevronEl = document.createElement("span");
            chevronEl.className = "purpose-cart-chevron";
            chevronEl.setAttribute("aria-hidden", "true");
            chevronEl.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M6 9l6 6 6-6"></path>
                </svg>
            `;
            (metaEl || headerEl).appendChild(chevronEl);
        }
        chevronEl.classList.toggle("is-expanded", isExpanded);

        const toggleAccordion = (event) => {
            if (event.target.closest("[data-cart-clear='true']")) return;
            window.toggleCartAccordion(sessionId);
        };

        headerEl.onclick = toggleAccordion;
        headerEl.onkeydown = (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleAccordion(event);
            }
        };
    });

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
    closeDeliveryPanel();

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
                    <p class="text-sm font-medium text-slate-800 leading-tight truncate">${selected.product.name}</p>
                    <p class="text-xs text-slate-400 font-normal mt-0.5">수량 1개</p>
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
    showPageLoading("주문서를 준비하는 중...", "write");
    setTimeout(() => {
        const orderView = document.getElementById("order-view");
        if (orderView) {
            orderView.classList.remove("hidden");
            orderView.classList.add("flex", "flex-col");
            scrollToSection(orderView);
        }
        hidePageLoading();
    }, 2000);

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
    scrollToSection(solutionView);
    updateBottomCheckoutBar();
};

window.goBackToSolution = function goBackToSolution() {
    const completeView = document.getElementById("order-complete-view");
    const claimView = document.getElementById("order-claim-view");
    if (completeView) {
        completeView.classList.add("hidden");
        completeView.classList.remove("flex", "flex-col");
    }
    if (claimView) {
        claimView.classList.add("hidden");
        claimView.classList.remove("flex", "flex-col");
    }
    const orderView = document.getElementById("order-view");
    if (orderView) {
        orderView.classList.add("hidden");
        orderView.classList.remove("flex", "flex-col");
    }
    closeDeliveryPanel();
    closeClaimStatusPanel();
    const solutionView = document.getElementById("solution-view");
    scrollToSection(solutionView);
};

function syncCompleteActionButtons(orderMeta = null) {
    const confirmBtn = document.getElementById("complete-confirm-btn");
    const claimBtn = document.getElementById("complete-claim-btn");
    if (!confirmBtn) return;

    const isConfirmed = Boolean(orderMeta?.purchaseConfirmed);
    confirmBtn.disabled = isConfirmed;
    confirmBtn.textContent = isConfirmed ? "\uAD6C\uB9E4\uD655\uC815 \uC644\uB8CC" : "\uAD6C\uB9E4\uD655\uC815";
    confirmBtn.classList.toggle("bg-gmarket-blue", !isConfirmed);
    confirmBtn.classList.toggle("hover:bg-blue-600", !isConfirmed);
    confirmBtn.classList.toggle("shadow-xl", !isConfirmed);
    confirmBtn.classList.toggle("shadow-blue-100", !isConfirmed);
    confirmBtn.classList.toggle("bg-emerald-500", isConfirmed);
    confirmBtn.classList.toggle("hover:bg-emerald-500", isConfirmed);
    confirmBtn.classList.toggle("shadow-none", isConfirmed);
    confirmBtn.classList.toggle("cursor-not-allowed", isConfirmed);
    confirmBtn.classList.toggle("opacity-70", isConfirmed);

    if (!claimBtn) return;
    claimBtn.disabled = isConfirmed;
    claimBtn.classList.toggle("cursor-not-allowed", isConfirmed);
    claimBtn.classList.toggle("opacity-50", isConfirmed);
    claimBtn.classList.toggle("hover:bg-slate-200", !isConfirmed);
    claimBtn.classList.toggle("hover:bg-slate-100", isConfirmed);
}

function syncClaimTypeButtons(type) {
    document.querySelectorAll(".claim-type-btn").forEach((button) => {
        const isActive = button.dataset.claimType === type;
        button.classList.toggle("bg-white", isActive);
        button.classList.toggle("border", isActive);
        button.classList.toggle("border-gmarket-blue", isActive);
        button.classList.toggle("bg-gmarket-blue/5", isActive);
        button.classList.toggle("shadow-sm", isActive);
        button.classList.toggle("text-slate-400", !isActive);
    });

    document.querySelectorAll(".claim-panel").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.claimPanel !== type);
    });

    const claimSubmitBtn = document.getElementById("claim-submit-btn");
    const labelMap = {
        cancel: "\uCDE8\uC18C \uC2E0\uCCAD\uD558\uAE30",
        return: "\uBC18\uD488 \uC2E0\uCCAD\uD558\uAE30",
        exchange: "\uAD50\uD658 \uC2E0\uCCAD\uD558\uAE30"
    };
    if (claimSubmitBtn && !claimSubmitBtn.disabled) {
        claimSubmitBtn.textContent = labelMap[type] || "\uC2E0\uCCAD\uD558\uAE30";
    }
}

function syncClaimFormState(claimMeta = {}) {
    const isSubmitted = claimMeta.status === "submitted";
    const claimView = document.getElementById("order-claim-view");
    const submitBtn = document.getElementById("claim-submit-btn");
    const statusBtn = document.getElementById("claim-status-btn");

    if (claimView) {
        claimView.dataset.claimLocked = isSubmitted ? "true" : "false";
    }

    document.querySelectorAll("#order-claim-view input, #order-claim-view select, #order-claim-view textarea").forEach((field) => {
        field.disabled = isSubmitted;
    });

    document.querySelectorAll(".claim-type-btn").forEach((button) => {
        button.disabled = isSubmitted;
        button.classList.toggle("opacity-60", isSubmitted);
        button.classList.toggle("cursor-not-allowed", isSubmitted);
    });

    if (submitBtn) {
        submitBtn.classList.toggle("hidden", isSubmitted);
    }

    if (statusBtn) {
        statusBtn.classList.toggle("hidden", !isSubmitted);
        statusBtn.textContent = isSubmitted
            ? `${getClaimTypeLabel(claimMeta.type)} \uC9C4\uD589 \uC0C1\uD0DC`
            : "\uC9C4\uD589 \uC0C1\uD0DC";
    }
}

function getClaimStatusConfig(claimMeta = {}) {
    const type = claimMeta.type || "cancel";
    const baseMap = {
        cancel: {
            title: "\uCDE8\uC18C \uC9C4\uD589 \uC0C1\uD0DC",
            headline: "\uCDE8\uC18C \uC694\uCCAD\uC774 \uC811\uC218\uB418\uC5B4 \uCC98\uB9AC \uC911\uC774\uC5D0\uC694",
            message: "\uACB0\uC81C \uCDE8\uC18C \uC5EC\uBD80\uB97C \uD655\uC778\uD558\uACE0 \uD658\uBD88 \uC808\uCC28\uB97C \uC9C4\uD589\uD558\uACE0 \uC788\uC5B4\uC694.",
            badgeClass: "bg-amber-50 text-amber-600",
            stages: [
                { label: "\uCDE8\uC18C \uC811\uC218", description: "\uCDE8\uC18C \uC694\uCCAD\uC774 \uC815\uC0C1 \uC811\uC218\uB410\uC5B4\uC694." },
                { label: "\uC8FC\uBB38 \uD655\uC778 \uC911", description: "\uBC30\uC1A1/\uACB0\uC81C \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uACE0 \uC788\uC5B4\uC694." },
                { label: "\uD658\uBD88 \uCC98\uB9AC \uC911", description: "\uC120\uD0DD\uD55C \uD658\uBD88 \uC218\uB2E8\uC73C\uB85C \uCC98\uB9AC \uC911\uC774\uC5D0\uC694." },
                { label: "\uCDE8\uC18C \uC644\uB8CC", description: "\uCDE8\uC18C \uBC0F \uD658\uBD88\uC774 \uB9C8\uBB34\uB9AC\uB429\uB2C8\uB2E4." }
            ]
        },
        return: {
            title: "\uBC18\uD488 \uC9C4\uD589 \uC0C1\uD0DC",
            headline: "\uBC18\uD488 \uC694\uCCAD\uC774 \uC811\uC218\uB418\uC5B4 \uD68C\uC218\uB97C \uC900\uBE44 \uC911\uC774\uC5D0\uC694",
            message: "\uD68C\uC218 \uC77C\uC815\uC744 \uD655\uC778\uD55C \uB4A4 \uAC80\uC218\uC640 \uD658\uBD88\uC744 \uC9C4\uD589\uD574\uC694.",
            badgeClass: "bg-blue-50 text-blue-600",
            stages: [
                { label: "\uBC18\uD488 \uC811\uC218", description: "\uBC18\uD488 \uC694\uCCAD\uC774 \uC815\uC0C1 \uC811\uC218\uB410\uC5B4\uC694." },
                { label: "\uD68C\uC218 \uC77C\uC815 \uD655\uC778", description: "\uD68C\uC218 \uD76C\uB9DD\uC77C \uAE30\uC900\uC73C\uB85C \uC77C\uC815\uC744 \uC870\uC728 \uC911\uC774\uC5D0\uC694." },
                { label: "\uC0C1\uD488 \uAC80\uC218 \uC911", description: "\uD68C\uC218 \uD6C4 \uC0C1\uD488 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uACE0 \uC788\uC5B4\uC694." },
                { label: "\uBC18\uD488 \uC644\uB8CC", description: "\uBC18\uD488 \uBC0F \uD658\uBD88\uC774 \uC644\uB8CC\uB429\uB2C8\uB2E4." }
            ]
        },
        exchange: {
            title: "\uAD50\uD658 \uC9C4\uD589 \uC0C1\uD0DC",
            headline: "\uAD50\uD658 \uC694\uCCAD\uC774 \uC811\uC218\uB418\uC5B4 \uC0C8 \uC0C1\uD488\uC744 \uC900\uBE44 \uC911\uC774\uC5D0\uC694",
            message: "\uD68C\uC218\uC640 \uAD50\uD658 \uC635\uC158 \uD655\uC778\uC744 \uAC70\uCCD0 \uC0C8 \uC0C1\uD488 \uCD9C\uACE0\uB97C \uC900\uBE44\uD574\uC694.",
            badgeClass: "bg-violet-50 text-violet-600",
            stages: [
                { label: "\uAD50\uD658 \uC811\uC218", description: "\uAD50\uD658 \uC694\uCCAD\uC774 \uC815\uC0C1 \uC811\uC218\uB410\uC5B4\uC694." },
                { label: "\uD68C\uC218 \uBC0F \uC635\uC158 \uD655\uC778", description: "\uAE30\uC874 \uC0C1\uD488 \uD68C\uC218\uC640 \uD76C\uB9DD \uC635\uC158\uC744 \uD655\uC778 \uC911\uC774\uC5D0\uC694." },
                { label: "\uAD50\uD658 \uC0C1\uD488 \uC900\uBE44", description: "\uC0C8 \uC0C1\uD488 \uCD9C\uACE0\uB97C \uC900\uBE44 \uC911\uC774\uC5D0\uC694." },
                { label: "\uAD50\uD658 \uC644\uB8CC", description: "\uAD50\uD658 \uCC98\uB9AC\uAC00 \uC644\uB8CC\uB429\uB2C8\uB2E4." }
            ]
        }
    };

    return baseMap[type] || baseMap.cancel;
}

function formatClaimSubmittedAt(isoString) {
    if (!isoString) return "-";
    try {
        return new Intl.DateTimeFormat("ko-KR", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        }).format(new Date(isoString));
    } catch (error) {
        return isoString;
    }
}

function renderClaimStatusPanel(sessionId = state.currentSessionId) {
    const session = getCartSession(sessionId);
    const claimMeta = session?.orderMeta?.claimMeta;
    if (!session || !claimMeta?.status) return false;

    const config = getClaimStatusConfig(claimMeta);
    const currentIndex = 1;
    const progress = 55;
    const detailsMap = {
        cancel: [
            ["\uCDE8\uC18C \uC0AC\uC720", claimMeta.fields?.cancelReason || claimMeta.reason || "-"],
            ["\uD658\uBD88 \uBC29\uC2DD", claimMeta.fields?.cancelRefund || "-"],
            ["\uBA54\uBAA8", claimMeta.fields?.cancelMessage || "-"]
        ],
        return: [
            ["\uBC18\uD488 \uC0AC\uC720", claimMeta.fields?.returnReason || claimMeta.reason || "-"],
            ["\uD3EC\uC7A5 \uC0C1\uD0DC", claimMeta.fields?.returnCondition || "-"],
            ["\uD68C\uC218 \uD76C\uB9DD\uC77C", claimMeta.fields?.returnPickup || "-"],
            ["\uC0C1\uC138", claimMeta.fields?.returnMessage || "-"]
        ],
        exchange: [
            ["\uAD50\uD658 \uC0AC\uC720", claimMeta.fields?.exchangeReason || claimMeta.reason || "-"],
            ["\uD76C\uB9DD \uC635\uC158", claimMeta.fields?.exchangeOption || "-"],
            ["\uD68C\uC218 \uD76C\uB9DD\uC77C", claimMeta.fields?.exchangePickup || "-"],
            ["\uC0C1\uC138", claimMeta.fields?.exchangeMessage || "-"]
        ]
    };
    const details = detailsMap[claimMeta.type] || [];

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText("claim-status-title", config.title);
    setText("claim-status-order-number", session.orderMeta?.orderNumber || "");
    setText("claim-status-step", config.stages[currentIndex]?.label || "");
    setText("claim-status-headline", config.headline);
    setText("claim-status-message", config.message);
    setText("claim-status-progress-label", `${progress}%`);
    setText("claim-status-reason", claimMeta.reason || "-");
    setText("claim-status-submitted-at", formatClaimSubmittedAt(claimMeta.submittedAt));

    const badgeEl = document.getElementById("claim-status-badge");
    if (badgeEl) {
        badgeEl.className = `inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${config.badgeClass}`;
        badgeEl.textContent = getClaimPhaseLabel(claimMeta);
    }

    const progressBarEl = document.getElementById("claim-status-progress-bar");
    if (progressBarEl) progressBarEl.style.width = `${progress}%`;

    const detailsEl = document.getElementById("claim-status-details");
    if (detailsEl) {
        detailsEl.innerHTML = details.map(([label, value]) => `
            <div class="rounded-[22px] border border-slate-100 bg-slate-50 px-4 py-3">
                <p class="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">${label}</p>
                <p class="mt-1 text-sm font-medium text-slate-800 leading-relaxed break-words">${value || "-"}</p>
            </div>
        `).join("");
    }

    const timelineEl = document.getElementById("claim-status-timeline");
    if (timelineEl) {
        timelineEl.innerHTML = config.stages.map((stage, index) => {
            const isDone = index < currentIndex;
            const isCurrent = index === currentIndex;
            const dotClass = isDone
                ? "bg-gmarket-blue border-gmarket-blue"
                : (isCurrent ? "bg-white border-gmarket-blue" : "bg-white border-slate-200");
            const titleClass = isCurrent ? "text-slate-900" : (isDone ? "text-slate-700" : "text-slate-400");
            const textClass = isCurrent ? "text-slate-600" : "text-slate-400";
            const badge = isCurrent ? "\uC9C4\uD589\uC911" : (isDone ? "\uC644\uB8CC" : "\uB300\uAE30");
            const badgeClass = isCurrent
                ? "bg-gmarket-blue/10 text-gmarket-blue"
                : (isDone ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-400");

            return `
                <div class="flex gap-4">
                    <div class="flex flex-col items-center">
                        <div class="w-4 h-4 rounded-full border-2 ${dotClass}"></div>
                        ${index < config.stages.length - 1 ? '<div class="mt-2 h-full min-h-[44px] w-px bg-slate-200"></div>' : ""}
                    </div>
                    <div class="flex-1 pb-3">
                        <div class="flex items-center gap-2">
                            <p class="text-sm font-semibold ${titleClass}">${stage.label}</p>
                            <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${badgeClass}">${badge}</span>
                        </div>
                        <p class="mt-1 text-sm leading-relaxed ${textClass}">${stage.description}</p>
                    </div>
                </div>
            `;
        }).join("");
    }

    return true;
}

window.openClaimStatusPanel = function openClaimStatusPanel() {
    if (!renderClaimStatusPanel()) return;
    closePDP();
    closeDeliveryPanel();
    const scrollArea = document.querySelector("#claim-status-floating-card .overflow-y-auto");
    if (scrollArea) scrollArea.scrollTop = 0;
    document.body.classList.add("claim-status-active");
};

window.closeClaimStatusPanel = function closeClaimStatusPanel() {
    document.body.classList.remove("claim-status-active");
};

function fillClaimFields(claimMeta = {}) {
    const fields = claimMeta.fields || {};
    const setValue = (id, value = "") => {
        const element = document.getElementById(id);
        if (element) element.value = value;
    };

    setValue("claim-cancel-reason", fields.cancelReason || "\uB2E8\uC21C \uBCC0\uC2EC");
    setValue("claim-cancel-refund", fields.cancelRefund || "\uC6D0 \uACB0\uC81C\uC218\uB2E8 \uD658\uBD88");
    setValue("claim-cancel-message", fields.cancelMessage || "");

    setValue("claim-return-reason", fields.returnReason || "\uC0C1\uD488 \uBD88\uB7C9");
    setValue("claim-return-condition", fields.returnCondition || "\uBBF8\uAC1C\uBD09");
    setValue("claim-return-pickup", fields.returnPickup || "");
    setValue("claim-return-message", fields.returnMessage || "");

    setValue("claim-exchange-reason", fields.exchangeReason || "\uC635\uC158 \uBCC0\uACBD");
    setValue("claim-exchange-option", fields.exchangeOption || "");
    setValue("claim-exchange-pickup", fields.exchangePickup || "");
    setValue("claim-exchange-message", fields.exchangeMessage || "");
}

function collectClaimFields(type) {
    if (type === "cancel") {
        return {
            cancelReason: document.getElementById("claim-cancel-reason")?.value || "\uB2E8\uC21C \uBCC0\uC2EC",
            cancelRefund: document.getElementById("claim-cancel-refund")?.value || "\uC6D0 \uACB0\uC81C\uC218\uB2E8 \uD658\uBD88",
            cancelMessage: document.getElementById("claim-cancel-message")?.value || ""
        };
    }

    if (type === "return") {
        return {
            returnReason: document.getElementById("claim-return-reason")?.value || "\uC0C1\uD488 \uBD88\uB7C9",
            returnCondition: document.getElementById("claim-return-condition")?.value || "\uBBF8\uAC1C\uBD09",
            returnPickup: document.getElementById("claim-return-pickup")?.value || "",
            returnMessage: document.getElementById("claim-return-message")?.value || ""
        };
    }

    return {
        exchangeReason: document.getElementById("claim-exchange-reason")?.value || "\uC635\uC158 \uBCC0\uACBD",
        exchangeOption: document.getElementById("claim-exchange-option")?.value || "",
        exchangePickup: document.getElementById("claim-exchange-pickup")?.value || "",
        exchangeMessage: document.getElementById("claim-exchange-message")?.value || ""
    };
}

function renderClaimView(sessionId, options = {}) {
    const { scrollIntoView = true } = options;
    const session = getCartSession(sessionId);
    const orderMeta = session?.orderMeta;
    const claimView = document.getElementById("order-claim-view");
    const claimNumber = document.getElementById("claim-order-number");
    const claimItems = document.getElementById("claim-items-list");
    const claimSubmitBtn = document.getElementById("claim-submit-btn");
    if (!session || !orderMeta || !claimView) return false;

    const claimMeta = orderMeta.claimMeta || {};
    const claimType = claimMeta.type || "cancel";
    const claimStatus = claimMeta.status || "";
    const { itemsHtml } = buildSessionOrderItems(sessionId);

    closeDeliveryPanel();
    closeClaimStatusPanel();
    claimView.classList.remove("hidden");
    claimView.classList.add("flex", "flex-col");

    if (claimNumber) claimNumber.textContent = orderMeta.orderNumber || "";
    if (claimItems) claimItems.innerHTML = itemsHtml;
    fillClaimFields(claimMeta);

    claimView.dataset.claimType = claimType;
    syncClaimTypeButtons(claimType);
    syncClaimFormState(claimMeta);

    if (claimSubmitBtn) {
        const isSubmitted = claimStatus === "submitted";
        const submitLabelMap = {
            cancel: "\uCDE8\uC18C \uC2E0\uCCAD\uD558\uAE30",
            return: "\uBC18\uD488 \uC2E0\uCCAD\uD558\uAE30",
            exchange: "\uAD50\uD658 \uC2E0\uCCAD\uD558\uAE30"
        };
        claimSubmitBtn.disabled = isSubmitted;
        claimSubmitBtn.textContent = isSubmitted ? "\uC2E0\uCCAD \uC644\uB8CC" : (submitLabelMap[claimType] || "\uC2E0\uCCAD\uD558\uAE30");
        claimSubmitBtn.classList.toggle("opacity-70", isSubmitted);
        claimSubmitBtn.classList.toggle("cursor-not-allowed", isSubmitted);
    }

    setSessionThreadView(sessionId, "claim");
    persistCart();
    renderCart();
    syncTransactionLocks(sessionId);

    if (scrollIntoView) {
        requestAnimationFrame(() => {
            scrollToSection(claimView);
        });
    }

    return true;
}

window.selectClaimType = function selectClaimType(type) {
    const claimView = document.getElementById("order-claim-view");
    if (!claimView) return;
    if (claimView.dataset.claimLocked === "true") return;
    claimView.dataset.claimType = type;
    syncClaimTypeButtons(type);
};

window.goBackToCompleteFromClaim = function goBackToCompleteFromClaim() {
    const session = getCartSession(state.currentSessionId);
    if (!session) return;
    restoreCompleteThread(state.currentSessionId);
};

window.openOrderClaimFlow = function openOrderClaimFlow() {
    if (getCartSession(state.currentSessionId)?.orderMeta?.purchaseConfirmed) {
        showMiniToast("\uAD6C\uB9E4\uD655\uC815 \uD6C4\uC5D0\uB294 \uCDE8\uC18C/\uBC18\uD488/\uAD50\uD658\uC774 \uBD88\uAC00\uB2A5\uD574\uC694");
        return;
    }

    if (!state.latestOrder?.items?.length) {
        showMiniToast("\uC8FC\uBB38 \uC815\uBCF4\uB97C \uBA3C\uC800 \uBD88\uB7EC\uC640 \uC8FC\uC138\uC694");
        return;
    }

    renderClaimView(state.currentSessionId);
};

window.submitOrderClaim = function submitOrderClaim() {
    const sessionId = state.currentSessionId;
    const session = getCartSession(sessionId);
    const claimView = document.getElementById("order-claim-view");
    if (!session || !claimView) return;

    const claimType = claimView.dataset.claimType || "cancel";
    const claimTypeLabelMap = {
        cancel: "\uCDE8\uC18C",
        return: "\uBC18\uD488",
        exchange: "\uAD50\uD658"
    };
    const fields = collectClaimFields(claimType);

    if (claimType === "return" && !fields.returnPickup) {
        showMiniToast("\uBC18\uD488 \uD68C\uC218 \uD76C\uB9DD\uC77C\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694");
        return;
    }

    if (claimType === "exchange" && (!fields.exchangeOption || !fields.exchangePickup)) {
        showMiniToast("\uAD50\uD658 \uD76C\uB9DD \uC635\uC158\uACFC \uD68C\uC218 \uD76C\uB9DD\uC77C\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694");
        return;
    }

    session.orderMeta = {
        ...(session.orderMeta || {}),
        claimMeta: {
            type: claimType,
            reason: fields.cancelReason || fields.returnReason || fields.exchangeReason || "\uB2E8\uC21C \uBCC0\uC2EC",
            note: fields.cancelMessage || fields.returnMessage || fields.exchangeMessage || "",
            fields,
            status: "submitted",
            submittedAt: new Date().toISOString()
        }
    };

    setSessionThreadView(sessionId, "claim");
    persistCart();
    renderCart();
    renderClaimView(sessionId, { scrollIntoView: false });
    showMiniToast(`${claimTypeLabelMap[claimType]} \uC2E0\uCCAD\uC774 \uC811\uC218\uB410\uC5B4\uC694`, "success");
};

window.confirmPurchase = function confirmPurchase() {
    const sessionId = state.currentSessionId;
    const session = getCartSession(sessionId);
    if (!session) return;

    const confirmedAt = new Date().toISOString();
    session.orderMeta = {
        ...(session.orderMeta || {}),
        purchaseConfirmed: true,
        purchaseConfirmedAt: confirmedAt
    };

    if (state.latestOrder?.sessionId === sessionId) {
        state.latestOrder = {
            ...state.latestOrder,
            purchaseConfirmed: true,
            purchaseConfirmedAt: confirmedAt
        };
    }

    setSessionThreadView(sessionId, "confirmed");
    persistCart();
    renderCart();
    syncCompleteActionButtons(session.orderMeta);
    syncTransactionLocks(sessionId);
    showMiniToast("\uAD6C\uB9E4\uD655\uC815\uC774 \uC644\uB8CC\uB410\uC5B4\uC694", "success");
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
    state.latestOrder = buildLatestOrderData(state.currentSessionId, orderNum);
    state.activeDeliveryItemIndex = 0;
    syncCompleteActionButtons({ purchaseConfirmed: false });

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
    showPageLoading("결제를 처리하는 중...", "pay");
    setTimeout(() => {
        const completeView = document.getElementById("order-complete-view");
        if (completeView) {
            completeView.classList.remove("hidden");
            completeView.classList.add("flex", "flex-col");
            scrollToSection(completeView);
        }
        hidePageLoading();
    }, 2000);
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
                <p class="text-sm font-semibold text-slate-900 mb-1">${intentKey === "캠핑" ? "이거 챙기지 않으면 캠핑 현장에서 곤란해요! ⛺" : intentKey === "데스크탑" ? "이 부품 빠지면 조립 전에 바로 막혀요! 🖥️" : intentKey === "이사" ? "이거 없으면 첫 출근 전날 곤란해요! 📦" : "이거 빠트리고 커튼 설치 할 뻔 했어요! 😅"}</p>
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

function scrollToSection(el) {
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    const singleLineHeight = parseInt(getComputedStyle(el).lineHeight) + parseInt(getComputedStyle(el).paddingTop) + parseInt(getComputedStyle(el).paddingBottom);
    el.style.height = el.scrollHeight + "px";

    const submitBtn = document.getElementById("submitBtn");
    if (submitBtn) {
        const isMultiLine = el.scrollHeight > singleLineHeight + 4;
        submitBtn.classList.toggle("top-1/2", !isMultiLine);
        submitBtn.classList.toggle("-translate-y-1/2", !isMultiLine);
        submitBtn.classList.toggle("bottom-2", isMultiLine);
        submitBtn.classList.toggle("sm:bottom-3", isMultiLine);
    }
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

function executeSearch(query, options = {}) {
    const infoView = document.getElementById("info-view");
    const solutionView = document.getElementById("solution-view");
    if (!query) return;
    const { resetChoices = true } = options;

    state.currentSessionId = "";
    if (resetChoices) {
        state.choices = getEmptyChoices();
    }
    state.surveyStepIndex = 0;
    state.isSurveyReviewMode = false;

    const goToSolutionView = (intent, scenario) => {
        state.currentIntent = intent;
        state.currentScenarioId = scenario?.id || intent;
        state.rawQuery = query;
        state.choices = {
            ...getEmptyChoices(),
            ...(scenario?.defaultChoices || {})
        };
        withLoading("설문 없이 바로 뷰티 계획을 구성하는 중...", 2200, () => {
            state.isSurveyReviewMode = false;
            ensureSurveyResultSession();
            saveSearchHistory();
            hideThreadViews();
            renderSolution(intent, query);
            updateProductCardCartState(intent);
            updateBottomCheckoutBar();
            solutionView?.classList.remove("hidden");
            if (document.body.classList.contains("clean-home-page")) {
                document.body.classList.remove("clean-survey-active");
                document.body.classList.add("clean-solution-active");
            }
            updateThreadStepper();
            scrollToSection(solutionView);
        }, "book");
    };

    const goToInfoView = (intent) => {
        state.currentIntent = intent;
        state.currentScenarioId = intent;
        state.rawQuery = query;
        withLoading("맞춤 조건을 불러오는 중...", 2500, () => {
            renderInfoView(intent);
            infoView?.classList.remove("hidden");
            infoView?.classList.add("flex");
            if (document.body.classList.contains("clean-home-page")) {
                document.body.classList.add("clean-survey-active");
                document.body.classList.remove("clean-solution-active");
            }
            updateThreadStepper();
            scrollToSection(infoView);
            const scrollToInfoStart = () => {
                if (!infoView) return;
                const top = infoView.getBoundingClientRect().top + window.scrollY - 80;
                const targetTop = Math.max(0, top);
                document.documentElement.scrollTop = targetTop;
                document.body.scrollTop = targetTop;
                window.scrollTo({ top: targetTop, behavior: "auto" });
            };
            [120, 420, 900].forEach((delay) => {
                setTimeout(scrollToInfoStart, delay);
            });
        });
    };

    const beautyScenario = getBeautyScenario(query);
    if (beautyScenario || query.includes("메이크업") || query.includes("뷰티") || query.toLowerCase().includes("makeup")) {
        const scenario = beautyScenario || BEAUTY_SCENARIOS["출근 10분룩"];
        if (scenario.skipSurvey) {
            goToSolutionView(scenario.id, scenario);
        } else {
            goToInfoView(scenario.id);
        }
    } else if (query.includes("커튼") || query.includes("커텐") || query.includes("而ㅽ듉") || query.includes("而ㅽ뀗")) {
        goToInfoView("커튼");
    } else if (query.includes("데스크탑") || query.includes("조립") || query.includes("pc") || query.includes("컴퓨터")) {
        goToInfoView("데스크탑");
    } else if (query.includes("캠핑") || query.includes("텐트") || query.includes("캠프") || query.includes("camping")) {
        goToInfoView("캠핑");
    } else if (query.includes("이사") || query.includes("원룸") || query.includes("자취") || query.includes("입사") || query.includes("신입")) {
        goToInfoView("이사");
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
    },
    "이사": {
        q1: {
            label: "1. 원룸 크기가 어느 정도인가요?",
            layout: "grid grid-cols-3 gap-3",
            options: [
                { main: "5평 이하", sub: "소형 원룸", icon: true },
                { main: "6~8평", sub: "일반 원룸", icon: true },
                { main: "9평+", sub: "넓은 원룸", icon: true }
            ],
            category: "size"
        },
        q2: {
            label: "2. 방 옵션 상태는 어떤가요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "옵션 없음", sub: "가구·가전 없음", row: true },
                { main: "풀옵션", sub: "기본 가전 포함", row: true }
            ],
            category: "wall"
        },
        q3: {
            label: "3. 자취 경험이 있으신가요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "처음", sub: "첫 자취", row: true },
                { main: "경험 있음", sub: "재이사", row: true }
            ],
            category: "experience"
        },
        q4: {
            label: "4. 예산은 어느 정도 생각하고 계신가요?",
            layout: "grid grid-cols-3 gap-3",
            options: [
                { main: "50만원 이하", sub: "최소 구성", icon: true },
                { main: "50~100만원", sub: "기본 구성", icon: true },
                { main: "100만원+", sub: "넉넉하게", icon: true }
            ],
            category: "budget"
        },
        q5: {
            label: "5. 이사 준비에서 가장 중요한 것은?",
            layout: "flex gap-3",
            options: [
                { main: "가성비" },
                { main: "깔끔한 인테리어" },
                { main: "빠른 정착" }
            ],
            category: "goal"
        }
    },
    "메이크업": {
        q1: {
            label: "1. 피부타입은 어떤 편인가요?",
            layout: "grid grid-cols-2 gap-3",
            options: [
                { main: "건성", sub: "촉촉한 베이스 우선", row: true },
                { main: "지성/복합성", sub: "지속력과 유분 조절", row: true },
                { main: "민감성", sub: "저자극 성분 중심", row: true },
                { main: "잘 모르겠어요", sub: "무난한 기본 조합", row: true }
            ],
            category: "skin"
        },
        q2: {
            label: "2. 원하는 기본 메이크업 무드는요?",
            layout: "grid grid-cols-3 gap-3",
            options: [
                { main: "내추럴", sub: "가볍고 자연스럽게", icon: true },
                { main: "화사한 톤업", sub: "맑고 생기 있게", icon: true },
                { main: "차분한 데일리", sub: "은은하고 단정하게", icon: true }
            ],
            category: "mood"
        },
        q3: {
            label: "3. 첫 장바구니 예산은 어느 정도인가요?",
            layout: "grid grid-cols-3 gap-3",
            options: [
                { main: "5만원 안쪽", sub: "최소 필수템", icon: true },
                { main: "10만원 안쪽", sub: "균형 구성", icon: true },
                { main: "15만원 이상도 가능", sub: "도구까지 넉넉히", icon: true }
            ],
            category: "budget"
        },
        q4: {
            label: "4. 주로 언제 쓸 기본템인가요?",
            layout: "grid grid-cols-3 gap-3",
            options: [
                { main: "출근/등교", sub: "지속력 중심", icon: true },
                { main: "데일리 외출", sub: "간편한 루틴", icon: true },
                { main: "약속/데이트", sub: "생기와 분위기", icon: true }
            ],
            category: "occasion"
        }
    }
};

infoViewConfig["출근 10분룩"] = {
    q1: {
        label: "1. 아침 메이크업에 쓸 수 있는 시간은요?",
        layout: "grid grid-cols-3 gap-3",
        options: [
            { main: "5분", sub: "최소 루틴", icon: true },
            { main: "10분", sub: "균형 루틴", icon: true },
            { main: "15분", sub: "조금 더 정교하게", icon: true }
        ],
        category: "occasion"
    },
    q2: {
        label: "2. 가장 잘 무너지는 부위는 어디인가요?",
        layout: "grid grid-cols-3 gap-3",
        options: [
            { main: "코/나비존", sub: "유분과 모공", icon: true },
            { main: "볼/턱", sub: "건조와 들뜸", icon: true },
            { main: "눈가", sub: "번짐과 주름", icon: true }
        ],
        category: "skin"
    },
    q3: {
        label: "3. 출근룩의 원하는 인상은요?",
        layout: "grid grid-cols-3 gap-3",
        options: [
            { main: "단정함", sub: "회의/오피스", icon: true },
            { main: "화사함", sub: "생기 중심", icon: true },
            { main: "차분함", sub: "톤다운 데일리", icon: true }
        ],
        category: "mood"
    }
};

infoViewConfig["AI 페이스 메이크오버"] = {
    q1: {
        label: "1. 얼굴 사진을 올려주세요",
        type: "photo",
        category: "photo"
    },
    q2: {
        label: "2. 입혀보고 싶은 메이크업 무드는요?",
        layout: "grid grid-cols-3 gap-3",
        options: [
            { main: "코랄 생기", sub: "따뜻하고 맑게", icon: true },
            { main: "뮤트 로즈", sub: "차분하고 우아하게", icon: true },
            { main: "글로우 누드", sub: "피부결 중심", icon: true }
        ],
        category: "mood"
    },
    q3: {
        label: "3. 어느 정도 진하게 표현할까요?",
        layout: "grid grid-cols-3 gap-3",
        options: [
            { main: "아주 자연스럽게", sub: "거의 티 안 나게", icon: true },
            { main: "데일리 정도", sub: "은은한 완성감", icon: true },
            { main: "확실한 변화", sub: "전후 차이 있게", icon: true }
        ],
        category: "intensity"
    },
    q4: {
        label: "4. 피부 표현은 어떤 쪽이 좋아요?",
        layout: "grid grid-cols-3 gap-3",
        options: [
            { main: "촉촉한 광", sub: "결광 베이스", icon: true },
            { main: "보송한 세미매트", sub: "지속력 중심", icon: true },
            { main: "내 피부처럼", sub: "얇은 커버", icon: true }
        ],
        category: "finish"
    }
};

function getSurveyQuestions(intent) {
    const cfg = infoViewConfig[intent];
    if (!cfg) return [];
    return Object.keys(cfg)
        .filter((key) => key.startsWith("q"))
        .sort()
        .map((key) => ({ key, ...cfg[key] }));
}

function isQuestionAnswered(question) {
    if (!question) return false;
    if (question.type === "photo") {
        return Boolean(state.choices[question.category] && state.choices.photoName);
    }
    return Boolean(state.choices[question.category]);
}

function getFirstMissingSurveyQuestion(intent = state.currentIntent) {
    return getSurveyQuestions(intent).find((question) => !isQuestionAnswered(question)) || null;
}

function clampSurveyStepIndex(questions) {
    const maxIndex = Math.max(questions.length - 1, 0);
    state.surveyStepIndex = Math.max(0, Math.min(state.surveyStepIndex || 0, maxIndex));
}

function getQuestionLabelText(label) {
    return String(label || "").replace(/^\s*\d+\.\s*/, "").trim();
}

function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function updateSurveyProgress(questions = getSurveyQuestions(state.currentIntent)) {
    const total = questions.length || 1;
    clampSurveyStepIndex(questions);

    const current = Math.min(state.surveyStepIndex + 1, total);
    const currentQuestion = questions[state.surveyStepIndex];
    const isLast = current >= total;
    const isCurrentAnswered = isQuestionAnswered(currentQuestion);

    const label = document.getElementById("survey-progress-label");
    const fill = document.getElementById("survey-progress-fill");
    const prevBtn = document.getElementById("survey-prev-btn");
    const nextBtn = document.getElementById("survey-next-btn");
    const submitBtn = document.getElementById("survey-submit-btn");
    const editBtn = document.getElementById("survey-edit-btn");

    if (label) label.textContent = `${current} / ${total}`;
    if (fill) fill.style.width = `${(current / total) * 100}%`;

    if (prevBtn) {
        prevBtn.disabled = state.surveyStepIndex === 0;
        prevBtn.classList.toggle("hidden", total <= 1);
    }
    if (nextBtn) {
        nextBtn.disabled = !isCurrentAnswered;
        nextBtn.classList.toggle("hidden", isLast);
    }
    if (submitBtn) {
        submitBtn.disabled = !isCurrentAnswered;
        submitBtn.classList.toggle("hidden", !isLast);
        if (state.isSurveyReviewMode) {
            submitBtn.disabled = true;
            submitBtn.classList.add("hidden");
        }
    }
    if (editBtn) {
        editBtn.classList.toggle("hidden", !state.isSurveyReviewMode);
    }
}

function applySurveyReviewMode() {
    const container = document.getElementById("questions-container");
    if (!container) return;

    container.querySelectorAll(".info-card").forEach((button) => {
        button.disabled = state.isSurveyReviewMode;
        button.classList.toggle("clean-review-locked", state.isSurveyReviewMode);
    });
}

function ensureSurveyResultSession() {
    if (!state.currentIntent) return null;

    let sessionId = state.currentSessionId;
    let session = getCartSession(sessionId);

    if (!session || session.intentKey !== state.currentIntent) {
        const nextSession = createCartSession(state.currentIntent);
        sessionId = nextSession.id;
        session = nextSession.data;
        state.currentSessionId = sessionId;
        state.purposeCart[sessionId] = session;
    }

    session.rawQuery = state.rawQuery;
    session.selectionSummary = buildHistorySummary();
    session.recommendationSummary = solutionData[state.currentIntent]?.intentReason || "";
    session.choices = { ...state.choices };
    session.threadView = "solution";
    session.updatedAt = new Date().toISOString();
    persistCart();
    renderCart();

    return session;
}

function renderSurveyLockSummary() {
    const container = document.getElementById("survey-lock-summary");
    if (!container) return;

    const questions = getSurveyQuestions(state.currentIntent);
    if (!questions.length) {
        container.classList.add("hidden");
        container.innerHTML = "";
        return;
    }

    const items = questions
        .map((question) => {
            const value = state.choices[question.category];
            if (!value) return "";
            const displayValue = question.type === "photo" ? (state.choices.photoName || "사진 업로드됨") : value;
            return `
                <div class="clean-survey-lock__item" aria-readonly="true">
                    <span class="clean-survey-lock__label">${escapeHtml(getQuestionLabelText(question.label))}</span>
                    <span class="clean-survey-lock__value">${escapeHtml(displayValue)}</span>
                </div>
            `;
        })
        .filter(Boolean)
        .join("");

    if (!items) {
        container.classList.add("hidden");
        container.innerHTML = "";
        return;
    }

    container.innerHTML = `
        <div class="clean-survey-lock__head">
            <p class="clean-survey-lock__title">설문 요약</p>
        </div>
        <div class="clean-survey-lock__items">${items}</div>
    `;
    container.classList.remove("hidden");
}

function renderInfoView(intent) {
    const container = document.getElementById("questions-container");
    const infoTitle = document.getElementById("info-title");
    if (!container) return;
    const cfg = infoViewConfig[intent];
    if (!cfg) return;
    const surveyQuestions = getSurveyQuestions(intent);
    clampSurveyStepIndex(surveyQuestions);

    const trimmedQuery = state.rawQuery?.trim() || "";
    if (infoTitle) {
        infoTitle.innerHTML = trimmedQuery
            ? `
                <span class="block">
                    "<span class="inline-block max-w-[min(100%,16rem)] align-bottom truncate font-semibold text-slate-900 sm:max-w-[20rem] md:max-w-[24rem]">${trimmedQuery}</span>"에 딱 맞는 조건을 찾기 위해 몇 가지만 알려주세요
                </span>
            `
            : '환경에 딱 맞는 계획을 위해<br>몇 가지만 알려주세요';
    }

    const buildQ = (q) => {
        if (q.type === "photo") {
            const hasPhoto = Boolean(state.choices[q.category]);
            return `<div class="clean-photo-question">
                <label class="text-sm font-medium text-slate-400 mb-3 block">${q.label}</label>
                <div class="clean-photo-upload ${hasPhoto ? "has-photo" : ""}">
                    <input id="beauty-photo-input" type="file" accept="image/*" class="clean-photo-upload__input" onchange="handleBeautyPhotoUpload(this, '${q.category}')">
                    <label for="beauty-photo-input" class="clean-photo-upload__drop">
                        <span class="clean-photo-upload__preview">
                            ${hasPhoto
                                ? `<img src="${escapeHtml(state.choices[q.category])}" alt="업로드한 얼굴 사진">`
                                : `<span>얼굴 사진 업로드</span>`
                            }
                        </span>
                        <span class="clean-photo-upload__body">
                            <strong>${hasPhoto ? "사진이 준비됐어요" : "정면 얼굴 사진을 선택해주세요"}</strong>
                            <small>${hasPhoto ? escapeHtml(state.choices.photoName || "업로드한 사진") : "AI 메이크업 결과 미리보기와 구현 플랜에 사용됩니다."}</small>
                        </span>
                    </label>
                    <button type="button" class="clean-photo-upload__sample" onclick="useSampleBeautyPhoto('${q.category}')">
                        샘플 얼굴로 진행하기
                    </button>
                </div>
            </div>`;
        }

        const btnClass = "flex-shrink-0 info-card border-2 border-slate-100 rounded-2xl transition-all bg-slate-50 hover:border-gmarket-blue p-3 text-center flex flex-col items-center justify-center gap-1 min-w-[5rem]";
        const buttons = q.options.map(opt => {
            const buttonAttrs = `data-choice-category="${q.category}" data-choice-value="${opt.main}"`;
            const sub = opt.sub ? `<span class="text-[11px] font-normal text-slate-400 whitespace-nowrap">${opt.sub}</span>` : "";
            return `<button ${buttonAttrs} onclick="selectChoice(this, '${q.category}')" class="${btnClass}">
                <span class="text-sm font-semibold text-slate-800 whitespace-nowrap">${opt.main}</span>
                ${sub}
            </button>`;
        }).join("");
        return `<div>
            <label class="text-sm font-medium text-slate-400 mb-3 block">${q.label}</label>
            <div class="flex gap-2 overflow-x-auto scrollbar-hide pb-1 pt-2 -mt-2">${buttons}</div>
        </div>`;
    };

    const activeQuestion = surveyQuestions[state.surveyStepIndex];
    container.innerHTML = activeQuestion ? buildQ(activeQuestion) : "";

    container.querySelectorAll(".info-card").forEach(btn => {
        btn.addEventListener("pointerdown", () => {
            btn.classList.remove("card-pop");
            void btn.offsetWidth;
            btn.classList.add("card-pop");
        });
    });

    Object.entries(state.choices).forEach(([category, value]) => {
        if (!value) return;
        const selectedButton = Array.from(container.querySelectorAll("button")).find((button) => {
            if (button.dataset.choiceCategory !== category) return false;
            return button.dataset.choiceValue === value || button.innerText.trim() === value;
        });
        selectedButton?.classList.add("active-card", "ring-4", "ring-blue-100");
    });

    updateSurveyProgress(surveyQuestions);
    applySurveyReviewMode();
    updateThreadStepper();
}

window.selectChoice = function selectChoice(btn, category) {
    if (state.isSurveyReviewMode) return;
    const buttons = btn.parentElement.querySelectorAll("button");
    buttons.forEach((button) => button.classList.remove("active-card", "ring-4", "ring-blue-100"));
    btn.classList.add("active-card", "ring-4", "ring-blue-100");
    state.choices[category] = btn.dataset.choiceValue || btn.innerText.trim();
    updateSurveyProgress();
    updateThreadStepper();
};

window.handleBeautyPhotoUpload = function handleBeautyPhotoUpload(input, category) {
    if (state.isSurveyReviewMode) return;
    const file = input?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        state.choices[category] = String(reader.result || "");
        state.choices.photoName = file.name || "업로드한 사진";
        renderInfoView(state.currentIntent);
        updateSurveyProgress();
        updateThreadStepper();
    };
    reader.readAsDataURL(file);
};

window.useSampleBeautyPhoto = function useSampleBeautyPhoto(category = "photo") {
    if (state.isSurveyReviewMode) return;
    state.choices[category] = SAMPLE_FACE_PHOTO;
    state.choices.photoName = "샘플 얼굴";
    const questions = getSurveyQuestions(state.currentIntent);
    const currentQuestion = questions[state.surveyStepIndex];
    const isCurrentPhotoQuestion = currentQuestion?.type === "photo" && currentQuestion.category === category;
    if (isCurrentPhotoQuestion && state.surveyStepIndex < questions.length - 1) {
        state.surveyStepIndex += 1;
    }
    renderInfoView(state.currentIntent);
    updateSurveyProgress();
    updateThreadStepper();
};

window.moveSurveyStep = function moveSurveyStep(delta) {
    const questions = getSurveyQuestions(state.currentIntent);
    if (!questions.length) return;

    const currentQuestion = questions[state.surveyStepIndex];
    if (delta > 0 && currentQuestion && !isQuestionAnswered(currentQuestion)) {
        updateSurveyProgress(questions);
        return;
    }

    state.surveyStepIndex += delta;
    clampSurveyStepIndex(questions);
    renderInfoView(state.currentIntent);
};

function applySurveyEditConfirm() {
    const previousChoices = { ...state.choices };
    const nextSession = createCartSession(state.currentIntent);
    nextSession.data.choices = { ...previousChoices };
    nextSession.data.selectionSummary = buildHistorySummary();
    nextSession.data.threadView = "info";
    nextSession.data.selectedItems = {};

    state.currentSessionId = nextSession.id;
    state.purposeCart[nextSession.id] = nextSession.data;
    state.choices = { ...getEmptyChoices(), ...previousChoices };
    state.surveyStepIndex = 0;
    state.isSurveyReviewMode = false;
    persistCart();
    renderCart();

    const infoView = document.getElementById("info-view");
    const solutionView = document.getElementById("solution-view");
    solutionView?.classList.add("hidden");
    infoView?.classList.remove("hidden");
    infoView?.classList.add("flex");
    if (document.body.classList.contains("clean-home-page")) {
        document.body.classList.add("clean-survey-active");
        document.body.classList.remove("clean-solution-active");
    }
    renderInfoView(state.currentIntent);
    updateThreadStepper();
    scrollToSection(infoView);
}

function closeSurveyEditConfirmModal() {
    const modal = document.getElementById("survey-edit-confirm-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    document.body.classList.remove("survey-confirm-active");
}

window.confirmSurveyEdit = function confirmSurveyEdit() {
    const modal = document.getElementById("survey-edit-confirm-modal");
    if (!modal) {
        applySurveyEditConfirm();
        return;
    }

    modal.classList.remove("hidden");
    document.body.classList.add("survey-confirm-active");
    requestAnimationFrame(() => {
        document.getElementById("survey-edit-confirm-btn")?.focus();
    });
};

window.generatePlan = function generatePlan() {
    const solutionView = document.getElementById("solution-view");
    ensureBeautyScenarioSolutionData();
    if (!state.currentIntent) state.currentIntent = "메이크업";
    if (!state.rawQuery) state.rawQuery = state.currentIntent;

    const missingQuestion = getFirstMissingSurveyQuestion(state.currentIntent);
    if (missingQuestion) {
        const missingIndex = getSurveyQuestions(state.currentIntent).findIndex((question) => question.key === missingQuestion.key);
        if (missingIndex >= 0) {
            state.surveyStepIndex = missingIndex;
            renderInfoView(state.currentIntent);
        }
        updateSurveyProgress();
        return;
    }

    state.isSurveyReviewMode = false;
    ensureSurveyResultSession();

    saveSearchHistory();
    const showGeneratedPlan = () => {
        try {
            renderSolution(state.currentIntent, state.rawQuery);
            solutionView?.classList.remove("hidden");
            if (document.body.classList.contains("clean-home-page")) {
                document.body.classList.remove("clean-survey-active");
                document.body.classList.add("clean-solution-active");
            }
            updateThreadStepper();
            scrollToSection(solutionView);
            updateBottomCheckoutBar();
        } catch (error) {
            console.error("Failed to render generated plan", error);
            showToast("브리프를 여는 중 문제가 생겼어요. 다시 시도해주세요.");
        }
    };

    withLoading("\"딱\" 맞는 최적의 상품을 분석 중...", 900, () => {
        showGeneratedPlan();
    }, "book");
};

window.openPDP = function openPDP(stepIdx, prodIdx) {
    const intentData = solutionData[state.currentIntent];
    if (!intentData) return;

    const product = intentData.steps[stepIdx]?.products[prodIdx];
    if (!product) return;

    closeDeliveryPanel();

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
            item.className = "flex gap-3 items-start transition-all hover:translate-x-1 duration-300 text-left font-normal";
            item.innerHTML = `
                <div class="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">${index + 1}</div>
                <p class="text-sm sm:text-[16px] text-slate-600 leading-relaxed font-medium text-left" style="word-break:keep-all">${text}</p>
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

function renderDeliveryPanel() {
    const latestOrder = state.latestOrder;
    if (!latestOrder?.items?.length) return;

    const itemIndex = Math.max(0, Math.min(state.activeDeliveryItemIndex, latestOrder.items.length - 1));
    state.activeDeliveryItemIndex = itemIndex;

    const currentItem = latestOrder.items[itemIndex];
    const statusMeta = getDeliveryStatusMeta(currentItem.statusIndex);

    const orderNumberEl = document.getElementById("delivery-order-number");
    const currentImageEl = document.getElementById("delivery-current-item-image");
    const currentStatusBadgeEl = document.getElementById("delivery-current-status-badge");
    const currentStepEl = document.getElementById("delivery-current-step");
    const currentTitleEl = document.getElementById("delivery-current-item-title");
    const currentPriceEl = document.getElementById("delivery-current-item-price");
    const currentMessageEl = document.getElementById("delivery-current-message");
    const progressLabelEl = document.getElementById("delivery-current-progress-label");
    const progressBarEl = document.getElementById("delivery-current-progress-bar");
    const expectedDateEl = document.getElementById("delivery-expected-date");
    const trackingNumberEl = document.getElementById("delivery-tracking-number");
    const courierEl = document.getElementById("delivery-courier");
    const itemCountEl = document.getElementById("delivery-item-count");
    const itemSelectorListEl = document.getElementById("delivery-item-selector-list");
    const timelineEl = document.getElementById("delivery-timeline");

    if (orderNumberEl) orderNumberEl.textContent = latestOrder.orderNumber;
    if (currentImageEl) {
        currentImageEl.src = currentItem.product.img;
        currentImageEl.alt = currentItem.product.name;
    }
    if (currentStatusBadgeEl) {
        currentStatusBadgeEl.className = `inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold ${statusMeta.badgeClass}`;
        currentStatusBadgeEl.textContent = statusMeta.label;
    }
    if (currentStepEl) currentStepEl.textContent = currentItem.stepName;
    if (currentTitleEl) currentTitleEl.textContent = currentItem.product.name;
    if (currentPriceEl) currentPriceEl.textContent = `${currentItem.product.price}\uC6D0`;
    if (currentMessageEl) currentMessageEl.textContent = statusMeta.description;
    if (progressLabelEl) progressLabelEl.textContent = `${statusMeta.progress}%`;
    if (progressBarEl) progressBarEl.style.width = `${statusMeta.progress}%`;
    if (expectedDateEl) expectedDateEl.textContent = formatDeliveryDate(currentItem.expectedDate);
    if (trackingNumberEl) trackingNumberEl.textContent = currentItem.trackingNumber;
    if (courierEl) courierEl.textContent = `${currentItem.courier} | \uC2E4\uC2DC\uAC04 \uBC30\uC1A1 \uC900\uBE44\uC911`;
    if (itemCountEl) itemCountEl.textContent = `${latestOrder.items.length}\uAC1C \uC0C1\uD488`;

    if (itemSelectorListEl) {
        itemSelectorListEl.innerHTML = latestOrder.items.map((item, index) => {
            const itemStatus = getDeliveryStatusMeta(item.statusIndex);
            const isActive = index === itemIndex;
            return `
                <button
                    type="button"
                    onclick="openDeliveryPanel(${index})"
                    class="w-full rounded-[22px] border px-4 py-4 text-left transition-all ${isActive ? "border-gmarket-blue bg-gmarket-blue/5 shadow-sm" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"}">
                    <div class="flex items-center gap-3">
                        <img src="${item.product.img}" alt="${item.product.name}" class="w-14 h-14 rounded-2xl object-cover border border-slate-100 bg-white flex-shrink-0">
                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-2 mb-1.5">
                                <span class="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">${item.stepName}</span>
                                <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${itemStatus.badgeClass}">${itemStatus.label}</span>
                            </div>
                            <p class="text-sm font-medium text-slate-800 truncate">${item.product.name}</p>
                            <p class="mt-1 text-xs font-normal text-slate-400">\uB3C4\uCC29 \uC608\uC815 ${formatDeliveryDate(item.expectedDate)}</p>
                        </div>
                        <svg class="w-5 h-5 flex-shrink-0 ${isActive ? "text-gmarket-blue" : "text-slate-300"}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                    </div>
                </button>
            `;
        }).join("");
    }

    if (timelineEl) {
        timelineEl.innerHTML = DELIVERY_STAGES.map((stage, index) => {
            const isDone = index < currentItem.statusIndex;
            const isCurrent = index === currentItem.statusIndex;
            const dotClass = isDone
                ? "bg-gmarket-blue border-gmarket-blue"
                : (isCurrent ? "bg-white border-gmarket-blue" : "bg-white border-slate-200");
            const titleClass = isCurrent ? "text-slate-900" : (isDone ? "text-slate-700" : "text-slate-400");
            const textClass = isCurrent ? "text-slate-600" : "text-slate-400";
            const badge = isCurrent ? "\uD604\uC7AC" : (isDone ? "\uC644\uB8CC" : "\uB300\uAE30");
            const badgeClass = isCurrent
                ? "bg-gmarket-blue/10 text-gmarket-blue"
                : (isDone ? "bg-slate-100 text-slate-600" : "bg-slate-100 text-slate-400");

            return `
                <div class="flex gap-4">
                    <div class="flex flex-col items-center">
                        <div class="w-4 h-4 rounded-full border-2 ${dotClass}"></div>
                        ${index < DELIVERY_STAGES.length - 1 ? '<div class="mt-2 h-full min-h-[44px] w-px bg-slate-200"></div>' : ""}
                    </div>
                    <div class="flex-1 pb-3">
                        <div class="flex items-center gap-2">
                            <p class="text-sm font-semibold ${titleClass}">${stage.label}</p>
                            <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${badgeClass}">${badge}</span>
                        </div>
                        <p class="mt-1 text-sm leading-relaxed ${textClass}">${stage.description}</p>
                    </div>
                </div>
            `;
        }).join("");
    }
}

window.openDeliveryPanel = function openDeliveryPanel(itemIndex = state.activeDeliveryItemIndex || 0) {
    if (!state.latestOrder?.items?.length) return;

    state.activeDeliveryItemIndex = Number.isFinite(Number(itemIndex)) ? Number(itemIndex) : 0;
    closePDP();
    closeClaimStatusPanel();
    renderDeliveryPanel();

    const scrollArea = document.querySelector("#delivery-floating-card .overflow-y-auto");
    if (scrollArea) scrollArea.scrollTop = 0;
    document.body.classList.add("delivery-panel-active");
};

window.closeDeliveryPanel = function closeDeliveryPanel() {
    document.body.classList.remove("delivery-panel-active");
};

function restoreOrderThread(sessionId, options = {}) {
    const { scrollIntoView = false } = options;
    const session = getCartSession(sessionId);
    if (!session) return false;

    const itemsList = document.getElementById("order-items-list");
    const priceBreakdown = document.getElementById("order-price-breakdown");
    const totalPriceEl = document.getElementById("order-total-price");
    const orderView = document.getElementById("order-view");
    const completeView = document.getElementById("order-complete-view");
    const claimView = document.getElementById("order-claim-view");
    const submitBtn = document.getElementById("order-submit-btn");
    const { itemsHtml, subtotal, itemCount } = buildSessionOrderItems(sessionId);

    const breakdownHtml = `
        <div class="flex justify-between text-slate-500">
            <span>\uC0C1\uD488 \uAE08\uC561${itemCount ? ` (${itemCount}\uAC1C)` : ""}</span>
            <span>${subtotal.toLocaleString()}\uC6D0</span>
        </div>
        <div class="flex justify-between text-slate-500">
            <span>\uBC30\uC1A1\uBE44</span>
            <span class="text-green-500 font-bold">\uBB34\uB8CC</span>
        </div>
    `;

    if (itemsList) itemsList.innerHTML = itemsHtml;
    if (priceBreakdown) priceBreakdown.innerHTML = breakdownHtml;
    if (totalPriceEl) totalPriceEl.textContent = `${subtotal.toLocaleString()}\uC6D0`;

    if (completeView) {
        completeView.classList.add("hidden");
        completeView.classList.remove("flex", "flex-col");
    }
    if (claimView) {
        claimView.classList.add("hidden");
        claimView.classList.remove("flex", "flex-col");
    }
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "\uACB0\uC81C\uD558\uAE30";
    }
    if (orderView) {
        orderView.classList.remove("hidden");
        orderView.classList.add("flex", "flex-col");
        if (scrollIntoView) {
            scrollToSection(orderView);
        }
    }

    syncTransactionLocks(sessionId);

    return true;
}

function restoreCompleteThread(sessionId) {
    const session = getCartSession(sessionId);
    const orderMeta = session?.orderMeta;
    if (!session || !orderMeta) return false;

    const completeName = document.getElementById("complete-name");
    const completePhone = document.getElementById("complete-phone");
    const completeAddress = document.getElementById("complete-address");
    const completeNumber = document.getElementById("order-complete-number");
    const completeItems = document.getElementById("complete-items-list");
    const completeTotal = document.getElementById("complete-total-price");
    const completeView = document.getElementById("order-complete-view");
    const claimView = document.getElementById("order-claim-view");
    const { itemsHtml, subtotal } = buildSessionOrderItems(sessionId);

    if (completeName) completeName.textContent = orderMeta.recipient?.name || "";
    if (completePhone) completePhone.textContent = orderMeta.recipient?.phone || "";
    if (completeAddress) completeAddress.textContent = orderMeta.recipient?.address || "";
    if (completeNumber) completeNumber.textContent = orderMeta.orderNumber || "";
    if (completeItems) completeItems.innerHTML = itemsHtml;
    if (completeTotal) completeTotal.textContent = orderMeta.totalPrice || `${subtotal.toLocaleString()}\uC6D0`;

    state.latestOrder = orderMeta.latestOrder || null;
    state.activeDeliveryItemIndex = 0;
    syncCompleteActionButtons(orderMeta);

    if (completeView) {
        completeView.classList.remove("hidden");
        completeView.classList.add("flex", "flex-col");
        scrollToSection(completeView);
    }
    if (claimView) {
        claimView.classList.add("hidden");
        claimView.classList.remove("flex", "flex-col");
    }

    setSessionThreadView(
        sessionId,
        orderMeta.claimMeta?.status ? "claim" : (orderMeta.purchaseConfirmed ? "confirmed" : "complete")
    );
    persistCart();
    renderCart();
    syncTransactionLocks(sessionId);

    return true;
}

function restoreClaimThread(sessionId) {
    const session = getCartSession(sessionId);
    if (!session || !session.orderMeta) return false;

    return renderClaimView(sessionId);
}

window.moveToCartThread = function moveToCartThread(sessionId) {
    const session = getCartSession(sessionId);
    if (!session) return;
    const effectiveThreadView = getSessionEffectiveThreadView(session);

    hydrateSessionContext(sessionId);
    closeHistorySidebar();

    renderThreadBase(session, { persistView: false });

    if (effectiveThreadView === "complete" || effectiveThreadView === "confirmed" || effectiveThreadView === "claim") {
        restoreOrderThread(sessionId);
        if ((effectiveThreadView === "complete" || effectiveThreadView === "confirmed" || effectiveThreadView === "claim") && restoreCompleteThread(sessionId) && effectiveThreadView !== "claim") {
            return;
        }
    }

    if (effectiveThreadView === "claim") {
        if (restoreClaimThread(sessionId)) {
            return;
        }
    }

    if (effectiveThreadView === "order") {
        restoreOrderThread(sessionId, { scrollIntoView: true });
        setSessionThreadView(sessionId, "order");
        persistCart();
        renderCart();
        return;
    }

    setSessionThreadView(sessionId, "solution");
    persistCart();
    renderCart();
    syncTransactionLocks(sessionId);
    const solutionView = document.getElementById("solution-view");
    scrollToSection(solutionView);
};

const originalOpenOrderView = window.openOrderView;
window.openOrderView = function wrappedOpenOrderView(sessionId) {
    setSessionThreadView(sessionId, "order");
    persistCart();
    renderCart();
    syncTransactionLocks(sessionId);
    return originalOpenOrderView(sessionId);
};

const originalCloseOrderView = window.closeOrderView;
window.closeOrderView = function wrappedCloseOrderView() {
    const result = originalCloseOrderView();
    setSessionThreadView(state.currentSessionId, "solution");
    persistCart();
    renderCart();
    syncTransactionLocks(state.currentSessionId);
    return result;
};

const originalGoBackToSolution = window.goBackToSolution;
window.goBackToSolution = function wrappedGoBackToSolution() {
    const result = originalGoBackToSolution();
    setSessionThreadView(state.currentSessionId, "solution");
    persistCart();
    renderCart();
    syncTransactionLocks(state.currentSessionId);
    return result;
};

const originalSubmitOrder = window.submitOrder;
window.submitOrder = function wrappedSubmitOrder() {
    const sessionId = state.currentSessionId;
    const result = originalSubmitOrder();
    const session = getCartSession(sessionId);

    if (session) {
        session.orderMeta = {
            orderNumber: document.getElementById("order-complete-number")?.textContent || "",
            recipient: {
                name: document.getElementById("complete-name")?.textContent || "",
                phone: document.getElementById("complete-phone")?.textContent || "",
                address: document.getElementById("complete-address")?.textContent || ""
            },
            totalPrice: document.getElementById("complete-total-price")?.textContent || document.getElementById("order-total-price")?.textContent || "",
            latestOrder: state.latestOrder,
            purchaseConfirmed: false,
            purchaseConfirmedAt: null
        };
        setSessionThreadView(sessionId, "complete");
        persistCart();
        renderCart();
        syncTransactionLocks(sessionId);
    }

    return result;
};

window.continueCartSession = function continueCartSession(sessionId) {
    window.moveToCartThread(sessionId);
};

const planIntegratedContent = {
    "메이크업": [
        {
            layout: "media-left",
            label: "베이스가 들뜨지 않도록",
            headline: "얇게 쌓는 순서를 먼저 잡고, 상품은 그 순서를 받쳐주는 쪽으로 골랐어요.",
            description: "건조함이 있는 피부는 커버력을 한 번에 올리기보다 흡수 시간과 밀착감을 확보하는 편이 결과가 안정적이에요.",
            points: [
                "스킨케어가 충분히 흡수된 뒤 얇은 베이스를 겹치는 방향으로 잡았어요.",
                "건성이라면 매트 고정력보다 수분감과 밀착을 먼저 보는 편이 좋아요."
            ],
            media: {
                type: "YouTube",
                title: "건성 베이스 메이크업 튜토리얼",
                summary: "선크림, 프라이머, 쿠션을 얇게 쌓는 순서를 영상으로 확인",
                thumbnail: "./makeup-clone-assets/d9b261330f3ffccf.avif",
                url: buildYoutubeSearchHref("건성 베이스 메이크업 튜토리얼")
            },
            mediaItems: [
                {
                    type: "YouTube",
                    title: "건성 베이스 메이크업 튜토리얼",
                    summary: "선크림, 프라이머, 쿠션을 얇게 쌓는 순서",
                    thumbnail: "./makeup-clone-assets/d9b261330f3ffccf.avif",
                    url: buildYoutubeSearchHref("건성 베이스 메이크업 튜토리얼")
                },
                {
                    type: "YouTube",
                    title: "쿠션이 뜨지 않는 밀착 베이스",
                    summary: "수분 베이스와 퍼프 터치 강도를 확인",
                    thumbnail: "./makeup-clone-assets/1cebcb36604d1166.avif",
                    url: buildYoutubeSearchHref("쿠션 뜨지 않는 베이스 메이크업")
                }
            ],
            citations: [
                { label: "YouTube", title: "건성 베이스 메이크업 튜토리얼 검색", url: buildYoutubeSearchHref("건성 베이스 메이크업 튜토리얼") },
                { label: "Byrdie", title: "건성 피부 메이크업 적용 팁", url: "https://www.byrdie.com/how-to-apply-makeup-to-dry-skin-8730959" }
            ]
        },
        {
            layout: "media-right",
            label: "색조는 빠르게 정돈되도록",
            headline: "색을 많이 쓰기보다 눈썹, 치크, 립의 톤을 맞춰 빠르게 완성되는 루틴으로 정리했어요.",
            description: "출근 전처럼 시간이 짧은 상황에서는 제품 수보다 순서가 중요해서, 손이 많이 가는 단계는 덜어내고 인상 정돈에 필요한 항목만 남겼어요.",
            points: [
                "눈썹, 치크, 립을 같은 채도 안에서 맞춰 짧은 시간에도 완성도가 나도록 구성했어요.",
                "출근 전 루틴이라면 색 수를 줄이고 지속력 있는 립 제품을 마지막에 두는 흐름이 편해요."
            ],
            media: {
                type: "YouTube",
                title: "10분 데일리 메이크업 루틴",
                summary: "베이스 이후 눈썹과 립을 빠르게 연결하는 루틴 참고",
                thumbnail: "./makeup-clone-assets/917e7113fa1d687a.avif",
                url: buildYoutubeSearchHref("10분 데일리 메이크업 루틴")
            },
            mediaItems: [
                {
                    type: "YouTube",
                    title: "10분 데일리 메이크업 루틴",
                    summary: "눈썹, 치크, 립을 빠르게 연결하는 흐름",
                    thumbnail: "./makeup-clone-assets/917e7113fa1d687a.avif",
                    url: buildYoutubeSearchHref("10분 데일리 메이크업 루틴")
                },
                {
                    type: "YouTube",
                    title: "출근 전 내추럴 색조 루틴",
                    summary: "색 수를 줄이고 인상을 정돈하는 루틴",
                    thumbnail: "./makeup-clone-assets/8e01e19fb7cf7c96.avif",
                    url: buildYoutubeSearchHref("출근 전 내추럴 메이크업 루틴")
                },
                {
                    type: "YouTube",
                    title: "립과 치크 톤 맞추기",
                    summary: "채도와 온도를 맞춰 실패를 줄이는 방법",
                    thumbnail: "./makeup-clone-assets/f8759723f25da79a.avif",
                    url: buildYoutubeSearchHref("립 치크 톤 맞추는 메이크업")
                }
            ],
            citations: [
                { label: "YouTube", title: "10분 데일리 메이크업 루틴 검색", url: buildYoutubeSearchHref("10분 데일리 메이크업 루틴") },
                { label: "Allure", title: "메이크업 적용 팁 모음", url: "https://www.allure.com/story/best-makeup-tips" }
            ]
        },
        {
            layout: "media-top",
            label: "예산은 겹치는 기능을 줄이도록",
            headline: "처음 사는 기본템은 '매일 쓰는가'를 기준으로 압축했어요.",
            description: "비슷한 역할의 제품이 겹치면 장바구니 금액은 빠르게 커지지만 실제 사용 빈도는 낮아져요. 그래서 베이스와 립처럼 반복 사용되는 축을 먼저 잡았습니다.",
            points: [
                "첫 장바구니는 베이스와 립처럼 매일 쓰는 품목에 비중을 두고, 포인트 제품은 하나만 남겼어요.",
                "후기에서는 들뜸, 지속력, 색상 재현처럼 실패 비용을 줄이는 단어를 먼저 보도록 했어요."
            ],
            media: {
                type: "이미지",
                title: "기본템 장바구니 구성",
                summary: "쿠션, 프라이머, 립처럼 사용 빈도가 높은 품목부터 압축",
                thumbnail: "./makeup-clone-assets/8fc2c65adff714e4.avif",
                url: buildSearchHref("메이크업 기본템 장바구니 구성")
            },
            mediaItems: [
                {
                    type: "이미지",
                    title: "기본템 장바구니 구성",
                    summary: "쿠션, 프라이머, 립처럼 사용 빈도가 높은 품목부터 압축",
                    thumbnail: "./makeup-clone-assets/8fc2c65adff714e4.avif",
                    url: buildSearchHref("메이크업 기본템 장바구니 구성")
                }
            ],
            citations: [
                { label: "Naver", title: "메이크업 기본템 구성 검색", url: buildSearchHref("메이크업 기본템 장바구니 구성") },
                { label: "Allure", title: "파운데이션 타입별 적용법", url: "https://www.allure.com/story/how-to-apply-every-kind-of-foundation" }
            ]
        },
        {
            layout: "media-wide",
            label: "마무리는 오래 버티도록",
            headline: "지속력은 제품을 더하는 것보다 무너지는 위치를 관리하는 쪽으로 설계했어요.",
            description: "픽서나 파우더를 무조건 많이 쓰기보다 코 옆, 턱, 마스크가 닿는 부위처럼 실제로 지워지는 지점을 좁혀 관리하는 흐름입니다.",
            points: [
                "수정 화장을 줄이기 위해 파우더를 얼굴 전체가 아니라 무너지는 부위 위주로 배치했어요.",
                "휴대 파우치에는 파우더, 립, 미스트처럼 바로 복구되는 제품만 남기는 쪽으로 정리했어요."
            ],
            media: {
                type: "YouTube",
                title: "지속력 높은 출근 메이크업",
                summary: "파우더 위치와 픽싱 단계로 무너짐을 줄이는 영상 참고",
                thumbnail: "./makeup-clone-assets/42072b0ad4be9333.avif",
                url: buildYoutubeSearchHref("지속력 높은 출근 메이크업")
            },
            mediaItems: [
                {
                    type: "YouTube",
                    title: "지속력 높은 출근 메이크업",
                    summary: "파우더 위치와 픽싱 단계로 무너짐 줄이기",
                    thumbnail: "./makeup-clone-assets/42072b0ad4be9333.avif",
                    url: buildYoutubeSearchHref("지속력 높은 출근 메이크업")
                },
                {
                    type: "YouTube",
                    title: "수정 화장 파우치 정리",
                    summary: "파우더, 립, 미스트만 남기는 휴대 루틴",
                    thumbnail: "./makeup-clone-assets/59fb086cee4f8a82.avif",
                    url: buildYoutubeSearchHref("수정 화장 파우치 필수템")
                }
            ],
            citations: [
                { label: "YouTube", title: "지속력 높은 출근 메이크업 검색", url: buildYoutubeSearchHref("지속력 높은 출근 메이크업") },
                { label: "Byrdie", title: "파운데이션 들뜸과 뭉침 방지 팁", url: "https://www.byrdie.com/why-does-my-foundation-look-patchy-and-dry-5216658" }
            ]
        }
    ]
};

planIntegratedContent["립스틱 전색발색"] = [
    {
        layout: "media-left",
        label: "팔목 발색 기준 컬러",
        headline: "이미지 속 쉘누드, 김여주집합, 소프트브릭을 기준 컬러로 먼저 잡았어요.",
        description: "전색발색은 예쁜 컬러를 많이 보는 단계가 아니라, 비슷해 보이는 색을 피부 위에서 구분하는 단계예요. 누드, 핑크 레드, 브릭을 먼저 잡으면 나머지 컬러 판단이 쉬워집니다.",
        points: [
            "쉘누드는 베이스 립, 김여주집합은 핑크 레드, 소프트브릭은 브릭 레드 기준으로 봐요.",
            "팔목에서 탁해 보이는 색은 입술 위에서도 칙칙해질 가능성이 높아 우선순위를 낮췄어요."
        ],
        media: {
            type: "이미지",
            title: "국내 립 팔목 발색 비교",
            summary: "한국어 라벨이 있는 웜톤 립 발색 예시",
            thumbnail: "./makeup-clone-assets/8e01e19fb7cf7c96.avif",
            url: LIPSTICK_SWATCH_EXAMPLE_URL
        },
        mediaItems: [
            {
                type: "이미지",
                title: "국내 립 팔목 발색 비교",
                summary: "한국어 라벨이 있는 웜톤 립 발색 예시",
                thumbnail: "./makeup-clone-assets/8e01e19fb7cf7c96.avif",
                url: LIPSTICK_SWATCH_EXAMPLE_URL
            },
            {
                type: "YouTube",
                title: "웜톤 립 발색 비교 리뷰",
                summary: "누드, 코랄, 브릭 컬러를 비교하는 영상",
                thumbnail: "./makeup-clone-assets/f8759723f25da79a.avif",
                url: buildYoutubeSearchHref("웜톤 립 발색 비교 리뷰")
            }
        ],
        citations: [
            { label: "언니의파우치", title: "웜톤 추천 립 팔목 발색", url: LIPSTICK_SWATCH_EXAMPLE_URL },
            { label: "YouTube", title: "웜톤 립 발색 비교 리뷰 검색", url: buildYoutubeSearchHref("웜톤 립 발색 비교 리뷰") }
        ]
    },
    {
        layout: "media-right",
        label: "코랄과 피치 후보",
        headline: "월간코랄과 퍼지코랄처럼 화사한 후보는 밝기와 형광기를 따로 봤어요.",
        description: "웜톤 코랄은 예뻐 보여도 피부 위에서 형광으로 튀거나 오렌지기가 과해질 수 있어요. 팔목 발색에서는 채도가 얼굴을 밝히는지, 색만 동동 뜨는지를 먼저 확인합니다.",
        points: [
            "월간코랄은 핑크 코랄, 퍼지코랄은 피치 코랄 기준으로 비교해요.",
            "데일리용은 채도가 낮은 쪽, 포인트용은 생기가 강한 쪽으로 나누면 선택이 쉬워요."
        ],
        media: {
            type: "YouTube",
            title: "봄웜 코랄 립 비교",
            summary: "피치, 핑크 코랄 계열을 비교하는 영상",
            thumbnail: "./makeup-clone-assets/1cebcb36604d1166.avif",
            url: buildYoutubeSearchHref("봄웜 코랄 립 비교")
        },
        mediaItems: [
            {
                type: "YouTube",
                title: "봄웜 코랄 립 비교",
                summary: "피치와 핑크 코랄의 차이",
                thumbnail: "./makeup-clone-assets/d9b261330f3ffccf.avif",
                url: buildYoutubeSearchHref("봄웜 코랄 립 비교")
            },
            {
                type: "YouTube",
                title: "웜톤 브릭 코랄 립 추천",
                summary: "브릭과 코랄 사이 채도 고르기",
                thumbnail: "./makeup-clone-assets/8e01e19fb7cf7c96.avif",
                url: buildYoutubeSearchHref("웜톤 브릭 코랄 립 추천")
            }
        ],
        citations: [
            { label: "YouTube", title: "봄웜 코랄 립 비교 검색", url: buildYoutubeSearchHref("봄웜 코랄 립 비교") },
            { label: "Naver", title: "웜톤 코랄 립 발색 비교 검색", url: buildSearchHref("웜톤 코랄 립 발색 비교") }
        ]
    },
    {
        layout: "media-top",
        label: "글로스와 레이어링",
        headline: "나이트마린처럼 투명한 글로스는 색상보다 얹었을 때의 광택 변화를 봐야 해요.",
        description: "전색발색 이미지에서 글로스 계열은 색이 거의 없거나 아주 옅게 보입니다. 이런 제품은 단독 발색보다 매트 립 위에 얹었을 때 색을 얼마나 부드럽게 바꾸는지가 중요합니다.",
        points: [
            "매트 립 위에 얹을 글로스는 펄감과 끈적임을 같이 봐요.",
            "립 베이스와 프라이머는 전색발색의 색 차이를 더 고르게 보여주는 보조템입니다."
        ],
        media: {
            type: "이미지",
            title: "립 글로스 레이어링",
            summary: "매트 립 위 광택과 펄감 변화 확인",
            thumbnail: "./makeup-clone-assets/917e7113fa1d687a.avif",
            url: buildSearchHref("립 글로스 레이어링 발색")
        },
        mediaItems: [
            {
                type: "이미지",
                title: "립 글로스 레이어링",
                summary: "매트 립 위 광택과 펄감 변화 확인",
                thumbnail: "./makeup-clone-assets/917e7113fa1d687a.avif",
                url: buildSearchHref("립 글로스 레이어링 발색")
            }
        ],
        citations: [
            { label: "Naver", title: "립 글로스 레이어링 발색 검색", url: buildSearchHref("립 글로스 레이어링 발색") }
        ]
    },
    {
        layout: "media-wide",
        label: "발색 확인 도구",
        headline: "전색발색은 제품만큼 같은 조명과 같은 양을 맞추는 도구가 중요해요.",
        description: "팔목 발색 비교는 작은 차이를 보는 작업이라 조명, 브러시, 지우는 방식이 달라지면 색 판단이 흔들립니다. 그래서 구매 후보와 함께 비교 도구를 추천했어요.",
        points: [
            "립 브러시는 발색 면적과 두께를 일정하게 맞추는 데 도움이 됩니다.",
            "리무버 패드와 자연광 미러는 착색과 조명 차이를 확인하는 데 필요합니다."
        ],
        media: {
            type: "YouTube",
            title: "립 발색 리뷰 촬영과 비교법",
            summary: "같은 조명과 같은 양으로 컬러 비교하기",
            thumbnail: "./makeup-clone-assets/42072b0ad4be9333.avif",
            url: buildYoutubeSearchHref("립 발색 리뷰 촬영 비교법")
        },
        mediaItems: [
            {
                type: "YouTube",
                title: "립 발색 리뷰 촬영과 비교법",
                summary: "같은 조명과 같은 양으로 컬러 비교하기",
                thumbnail: "./makeup-clone-assets/42072b0ad4be9333.avif",
                url: buildYoutubeSearchHref("립 발색 리뷰 촬영 비교법")
            },
            {
                type: "YouTube",
                title: "립 착색 지우는 법",
                summary: "전색발색 후 착색과 클렌징 확인",
                thumbnail: "./makeup-clone-assets/59fb086cee4f8a82.avif",
                url: buildYoutubeSearchHref("립 틴트 착색 지우는 법")
            }
        ],
        citations: [
            { label: "YouTube", title: "립 발색 리뷰 촬영 비교법 검색", url: buildYoutubeSearchHref("립 발색 리뷰 촬영 비교법") },
            { label: "Naver", title: "립 틴트 착색 지우는 법 검색", url: buildSearchHref("립 틴트 착색 지우는 법") }
        ]
    }
];

Object.keys(BEAUTY_SCENARIOS).forEach((scenarioId) => {
    if (!planIntegratedContent[scenarioId] && planIntegratedContent["메이크업"]) {
        planIntegratedContent[scenarioId] = planIntegratedContent["메이크업"];
    }
});

function buildSearchHref(query) {
    return `https://search.naver.com/search.naver?query=${encodeURIComponent(query || "")}`;
}

function buildYoutubeSearchHref(query) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query || "")}`;
}

function getPlanIntegratedContent(key, stepIndex, step) {
    const byIntent = planIntegratedContent[key]?.[stepIndex];
    if (byIntent) return byIntent;

    return {
        layout: "media-left",
        label: `${step.name} 선택 기준`,
        headline: `${step.name} 단계는 사용 환경에 맞는 기준을 먼저 정했어요.`,
        description: "추천 상품을 보기 전에 어떤 상황에서 쓰는지, 유지 비용이 얼마나 드는지, 후기가 어느 지점에서 갈리는지를 함께 반영했어요.",
        points: [
            "추천 상품을 고르기 전에 사용 환경과 유지 비용을 먼저 맞춰봤어요.",
            "후기에서 반복되는 장점과 불편 포인트를 함께 비교하면 실패 가능성이 줄어요."
        ],
        media: {
            type: "이미지",
            title: `${step.name} 구매 가이드`,
            summary: "구매 전 확인할 조건을 한 번 더 점검",
            thumbnail: "./makeup-clone-assets/ae9ddc7a5906fcf9.avif",
            url: buildSearchHref(`${step.name} 구매 가이드`)
        },
        mediaItems: [
            {
                type: "이미지",
                title: `${step.name} 구매 가이드`,
                summary: "구매 전 확인할 조건을 한 번 더 점검",
                thumbnail: "./makeup-clone-assets/ae9ddc7a5906fcf9.avif",
                url: buildSearchHref(`${step.name} 구매 가이드`)
            }
        ],
        citations: [
            { label: "Naver", title: `${step.name} 구매 가이드 검색`, url: buildSearchHref(`${step.name} 구매 가이드`) }
        ]
    };
}

function renderPlanIntegratedContent(key, stepIndex, step) {
    const content = getPlanIntegratedContent(key, stepIndex, step);
    const layoutClass = `plan-step-insight--${content.layout || "media-left"}`;
    const mediaItems = Array.isArray(content.mediaItems) && content.mediaItems.length
        ? content.mediaItems
        : (content.media ? [content.media] : []);
    const youtubeItems = mediaItems.filter((media) => media.type === "YouTube");
    const imageItems = mediaItems.filter((media) => media.type !== "YouTube");

    const imageFeatureHtml = imageItems.length ? `
        <a class="plan-step-feature-media" href="${escapeHtml(imageItems[0].url)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeHtml(imageItems[0].thumbnail)}" alt="${escapeHtml(imageItems[0].title)}">
            <span class="plan-step-feature-media__caption">
                <span>${escapeHtml(imageItems[0].type)}</span>
                <strong>${escapeHtml(imageItems[0].title)}</strong>
                <small>${escapeHtml(imageItems[0].summary)}</small>
            </span>
        </a>
    ` : "";

    const videoCardsHtml = youtubeItems.length ? `
        <div class="plan-video-card-grid" aria-label="추천 영상">
            ${youtubeItems.map((media) => `
                <a class="plan-video-card" href="${escapeHtml(media.url)}" target="_blank" rel="noopener noreferrer">
                    <span class="plan-video-card__thumb">
                        <img src="${escapeHtml(media.thumbnail)}" alt="${escapeHtml(media.title)}">
                        <span class="plan-step-media__play" aria-hidden="true"></span>
                    </span>
                    <span class="plan-video-card__body">
                        <span>YouTube</span>
                        <strong>${escapeHtml(media.title)}</strong>
                        <small>${escapeHtml(media.summary)}</small>
                    </span>
                </a>
            `).join("")}
        </div>
    ` : "";

    const mediaHtml = mediaItems.length ? `
        <div class="plan-step-media-stage">
            ${imageFeatureHtml}
            ${videoCardsHtml}
        </div>
    ` : "";

    return `
        <div class="plan-step-insight ${layoutClass}">
            <div class="plan-step-insight__copy">
                <span class="plan-step-insight__label">${escapeHtml(content.label)}</span>
                <p class="plan-step-insight__headline">${escapeHtml(content.headline || content.label)}</p>
                <p class="plan-step-insight__description">${escapeHtml(content.description || "")}</p>
                <ul class="plan-step-insight__points">
                    ${content.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
                </ul>
            </div>
            ${mediaHtml}
        </div>
        <div class="plan-citations" aria-label="참고 출처">
            <span>출처</span>
            ${content.citations.map((source, index) => `
                <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
                    [${index + 1}] ${escapeHtml(source.label)} · ${escapeHtml(source.title)}
                </a>
            `).join("")}
        </div>
    `;
}

function renderLipstickSwatchOutcome() {
    const shades = [
        { name: "김여주집합", tone: "핑크 레드", color: "#a84d4d" },
        { name: "쉘누드", tone: "누드 코랄", color: "#ca755d" },
        { name: "나이트마린", tone: "클리어 글로스", color: "#e6d5c3" },
        { name: "소프트브릭", tone: "브릭 레드", color: "#b75a45" },
        { name: "월간코랄", tone: "핑크 코랄", color: "#d06c61" },
        { name: "퍼지코랄", tone: "피치 코랄", color: "#df7d5f" }
    ];

    return `
        <section class="beauty-lipstick-outcome" aria-label="립스틱 전색 팔목 발색 결과">
            <div class="beauty-lipstick-outcome__copy">
                <span>Arm Swatch Review</span>
                <h3>한 립스틱의 전 색상을 팔목 위에서 비교했어요</h3>
                <p>같은 조명과 같은 피부톤 위에 모든 색상을 나란히 올려 명도, 채도, 흰기, 브라운기 차이가 바로 보이도록 정리했어요. 아래 계획은 피부톤별로 어떤 색을 먼저 볼지와 실제 구매 전 체크 순서를 함께 안내합니다.</p>
            </div>
            <div class="beauty-lipstick-swatch" aria-label="팔목 발색 비교표">
                <a class="beauty-lipstick-swatch__example" href="${escapeHtml(LIPSTICK_SWATCH_EXAMPLE_URL)}" target="_blank" rel="noopener noreferrer">
                    <img src="${escapeHtml(LIPSTICK_SWATCH_EXAMPLE_IMAGE)}" alt="립스틱 팔목 발색 예시 이미지" loading="eager" decoding="async" fetchpriority="high">
                    <span>웹 예시 이미지 · 언니의파우치</span>
                </a>
                <div class="beauty-lipstick-swatch__legend" aria-label="색상 요약">
                    ${shades.map((shade) => `
                        <span class="beauty-lipstick-swatch__chip">
                            <i style="background:${escapeHtml(shade.color)}"></i>
                            <strong>${escapeHtml(shade.name)}</strong>
                            <small>${escapeHtml(shade.tone)}</small>
                        </span>
                    `).join("")}
                </div>
            </div>
        </section>
    `;
}

function renderBeautyScenarioOutcome(key) {
    const scenario = getBeautyScenario(key);
    if (!scenario) return "";

    if (scenario.id === "립스틱 전색발색") {
        return renderLipstickSwatchOutcome();
    }

    if (scenario.hasPhotoUpload && state.choices.photo) {
        const mood = state.choices.mood || "원하는 무드";
        const intensity = state.choices.intensity || "데일리 정도";
        const finish = state.choices.finish || "내 피부처럼";
        return `
            <section class="beauty-ai-outcome" aria-label="AI 메이크업 이미지 결과">
                <div class="beauty-ai-outcome__copy">
                    <span>AI Image Result</span>
                    <h3>${escapeHtml(mood)} 메이크업을 입힌 결과</h3>
                    <p>${escapeHtml(intensity)}의 표현 강도와 ${escapeHtml(finish)} 피부 표현을 기준으로, 업로드한 얼굴 사진 위에 적용될 메이크업 방향을 시각화했어요. 아래 플랜은 이 결과에 가까워지기 위한 단계별 제품과 방법입니다.</p>
                </div>
                <div class="beauty-before-after" style="--split: 52%" data-before-after>
                    <div class="beauty-before-after__stage">
                        <img class="beauty-before-after__image beauty-before-after__image--before" src="${escapeHtml(state.choices.photo)}" alt="업로드한 얼굴 사진" loading="eager" decoding="async" fetchpriority="high">
                        <div class="beauty-before-after__after" aria-hidden="true">
                            <img class="beauty-before-after__image" src="${escapeHtml(state.choices.photo)}" alt="" loading="eager" decoding="async" fetchpriority="high">
                            <span class="beauty-before-after__makeup-glow"></span>
                        </div>
                        <span class="beauty-before-after__label beauty-before-after__label--before">Before</span>
                        <span class="beauty-before-after__label beauty-before-after__label--after">AI ${escapeHtml(mood)}</span>
                        <span class="beauty-before-after__handle" aria-hidden="true"></span>
                    </div>
                    <input class="beauty-before-after__range" type="range" min="0" max="100" value="52" aria-label="비포 애프터 비교 슬라이더" oninput="updateBeforeAfterSlider(this)">
                </div>
            </section>
        `;
    }

    if (scenario.skipSurvey) {
        return `
            <section class="beauty-scenario-note" aria-label="설문 스킵 시나리오">
                <span>Quick Scenario</span>
                <strong>${escapeHtml(scenario.title)}</strong>
                <p>이 키워드는 추가 설문 없이도 의도가 명확해서 바로 계획을 구성했어요. 필요한 기본 조건은 자동으로 적용했고, 아래에서 상품과 실행 순서를 바로 확인할 수 있습니다.</p>
            </section>
        `;
    }

    return "";
}

window.updateBeforeAfterSlider = function updateBeforeAfterSlider(input) {
    const root = input?.closest("[data-before-after]");
    if (!root) return;
    const value = Math.max(0, Math.min(Number(input.value) || 0, 100));
    root.style.setProperty("--split", `${value}%`);
};

/* ─── Solution rendering ────────────────────────────────────── */

function renderSolution(key, rawQuery) {
    ensureBeautyScenarioSolutionData();
    const scenario = getBeautyScenario(key);
    const data = solutionData[key] || solutionData[scenario?.baseIntent];
    const planContainer = document.getElementById("plan-container");
    const intentTitle = document.getElementById("intent-title");

    if (!data || !planContainer || !intentTitle) return;

    const trimmedQuery = rawQuery?.trim() || "";
    intentTitle.innerHTML = trimmedQuery
        ? `
            <span class="block">
                "<span class="inline-block max-w-[min(100%,16rem)] align-bottom truncate font-bold text-slate-900 sm:max-w-[20rem] md:max-w-[24rem]">${trimmedQuery}</span>"에 대한
            </span>
            <span class="inline-block font-bold text-gmarket-blue underline decoration-gmarket-yellow decoration-4 underline-offset-8">
                지마켓 맞춤 계획
            </span>
            <span class="inline-block">입니다</span>
        `
        : `
            <span class="block">지마켓 맞춤 계획</span>
            <span class="block text-gmarket-blue underline decoration-gmarket-yellow decoration-4 underline-offset-8">상품 결과</span>
        `;

    const stepCountLabel = document.getElementById("step-count-label");
    if (stepCountLabel) stepCountLabel.textContent = data.steps.length;

    renderSurveyLockSummary();

    planContainer.innerHTML = "";
    const scenarioOutcomeHtml = renderBeautyScenarioOutcome(key);
    if (scenarioOutcomeHtml) {
        planContainer.insertAdjacentHTML("beforeend", scenarioOutcomeHtml);
    }

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

        const comparisonTableHtml = key === "데스크탑" ? `
            <div class="mt-6 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                <div class="px-5 py-4 border-b border-slate-100 bg-white flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h4 class="text-sm font-bold text-slate-800 flex items-center gap-2">
                            <span class="inline-flex items-center justify-center w-6 h-6 rounded-md bg-gmarket-blue/10 text-gmarket-blue text-xs">📊</span>
                            스펙 비교 & 추천 이유
                        </h4>
                        <p class="text-[11px] text-slate-400 mt-1 font-medium">이번 단계 추천 상품을 한눈에 비교해 보세요</p>
                    </div>
                    <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-1 rounded-md">AI 분석</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs text-left border-collapse">
                        <thead class="bg-white border-b border-slate-100">
                            <tr>
                                <th class="px-4 py-3 font-bold text-slate-500 whitespace-nowrap">상품</th>
                                <th class="px-4 py-3 font-bold text-slate-500 whitespace-nowrap">매칭률</th>
                                <th class="px-4 py-3 font-bold text-slate-500 whitespace-nowrap">가격</th>
                                <th class="px-4 py-3 font-bold text-slate-500 whitespace-nowrap">주요 스펙</th>
                                <th class="px-4 py-3 font-bold text-slate-500 whitespace-nowrap">특징</th>
                                <th class="px-4 py-3 font-bold text-slate-500 min-w-[280px]">AI 추천 이유</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${visibleProducts.map(({ product, originalIndex }) => {
                                const isInCart = selectedState?.productIdx === originalIndex;
                                return `
                                <tr class="border-b border-slate-100 last:border-b-0 hover:bg-white transition-colors ${isInCart ? "bg-gmarket-blue/5" : ""}">
                                    <td class="px-4 py-3 align-top">
                                        <div class="font-bold text-slate-800 leading-snug">${product.name}</div>
                                        ${isInCart ? `<span class="inline-flex items-center mt-1.5 px-2 py-0.5 rounded-md bg-gmarket-blue/10 text-gmarket-blue text-[10px] font-bold">✓ 담음</span>` : ""}
                                    </td>
                                    <td class="px-4 py-3 align-top whitespace-nowrap">
                                        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-gmarket-blue/10 text-gmarket-blue text-[11px] font-bold">${product.score}%</span>
                                    </td>
                                    <td class="px-4 py-3 align-top whitespace-nowrap">
                                        <div class="text-gmarket-blue font-bold text-sm">${product.price}<span class="text-slate-400 text-[10px] font-medium ml-0.5">원</span></div>
                                        <div class="text-slate-300 text-[10px] line-through font-medium mt-0.5">${product.originalPrice}원</div>
                                    </td>
                                    <td class="px-4 py-3 text-slate-700 align-top whitespace-nowrap font-bold">${product.spec.size}</td>
                                    <td class="px-4 py-3 text-slate-600 align-top font-medium">${product.spec.feature}</td>
                                    <td class="px-4 py-3 align-top">
                                        <ul class="space-y-1.5 text-slate-600 font-medium">
                                            ${product.aiSummary.map((reason) => `
                                                <li class="flex items-start gap-1.5 leading-relaxed">
                                                    <span class="text-gmarket-blue mt-0.5 flex-shrink-0">·</span>
                                                    <span>${reason}</span>
                                                </li>
                                            `).join("")}
                                        </ul>
                                    </td>
                                </tr>
                            `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : "";

        const integratedContentHtml = renderPlanIntegratedContent(key, stepIndex, step);

        stepEl.innerHTML = `
            <div class="absolute -left-[20px] top-0 w-10 h-10 rounded-full bg-slate-900 shadow-xl flex items-center justify-center font-bold text-white z-20 border-4 border-slate-50">
                ${stepIndex + 1}
            </div>
            <div class="mb-8 text-left">
                <h3 class="text-2xl font-bold text-slate-800 mb-3 flex items-center flex-wrap gap-1">${step.name}${essentialBadge}</h3>
                <p class="text-slate-500 text-sm leading-relaxed">${step.description || "지마켓 AI가 제안하는 단계별 상품입니다."}</p>
            </div>
            ${integratedContentHtml}
            <div class="flex items-center justify-between gap-3 mb-4">
                <p class="text-xs font-bold text-slate-400">좌우로 넘겨 더 많은 상품을 볼 수 있어요</p>
            </div>
            <div class="flex gap-5 overflow-x-auto pb-8 -mx-2 px-2 scrollbar-hide text-left snap-x snap-mandatory">
                ${productHtml}
            </div>
            ${comparisonTableHtml}
        `;

        planContainer.appendChild(stepEl);
    });
}

function startDdakCompletedPlan(urlParams, searchInput) {
    const rawQuery = urlParams.get("q") || "나에게 맞는 메이크업 기본템 추천해줘";
    state.currentIntent = "메이크업";
    state.currentSessionId = "";
    state.rawQuery = rawQuery;
    state.choices = {
        ...getEmptyChoices(),
        skin: urlParams.get("skin") || "",
        mood: urlParams.get("mood") || "",
        budget: urlParams.get("budget") || "",
        occasion: urlParams.get("occasion") || "",
    };

    if (searchInput) {
        searchInput.value = rawQuery;
        autoResizeTextarea(searchInput);
        updateSearchUI(rawQuery);
    }

    const infoView = document.getElementById("info-view");
    const solutionView = document.getElementById("solution-view");
    renderInfoView("메이크업");
    const infoTitle = document.getElementById("info-title");
    if (infoTitle) {
        infoTitle.innerHTML = `
            <span class="block">DDAK에서 선택한 설문 답변을 반영했어요</span>
            <span class="block mt-2 text-base md:text-lg text-slate-500 font-medium">답변을 확인하고 아래 맞춤 계획을 이어서 볼 수 있어요.</span>
        `;
    }
    infoView?.classList.remove("hidden");
    infoView?.classList.add("flex");
    solutionView?.classList.remove("hidden");
    if (document.body.classList.contains("clean-home-page")) {
        document.body.classList.remove("clean-survey-active");
        document.body.classList.add("clean-solution-active");
    }
    state.isSurveyReviewMode = false;
    ensureSurveyResultSession();
    renderSolution("메이크업", rawQuery);
    saveSearchHistory();
    updateBottomCheckoutBar();
    updateThreadStepper();
    const scrollToPlanStart = () => {
        const top = solutionView ? solutionView.getBoundingClientRect().top + window.scrollY - 80 : 0;
        const targetTop = Math.max(0, top);
        document.documentElement.scrollTop = targetTop;
        document.body.scrollTop = targetTop;
        window.scrollTo({ top: targetTop, behavior: "auto" });
    };

    [120, 500, 1000].forEach((delay) => {
        setTimeout(scrollToPlanStart, delay);
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
    const threadStepper = document.getElementById("thread-stepper");
    const surveyEditConfirmModal = document.getElementById("survey-edit-confirm-modal");
    const surveyEditConfirmBtn = document.getElementById("survey-edit-confirm-btn");
    const surveyEditCancelBtn = document.getElementById("survey-edit-cancel-btn");

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
    updateThreadStepper();

    // Initialise tab (cart is default)
    switchTab("cart");

    threadStepper?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-thread-step]");
        if (!button || button.disabled) return;
        goThreadPhase(button.dataset.threadStep);
    });

    surveyEditConfirmBtn?.addEventListener("click", () => {
        closeSurveyEditConfirmModal();
        applySurveyEditConfirm();
    });

    surveyEditCancelBtn?.addEventListener("click", closeSurveyEditConfirmModal);
    surveyEditConfirmModal?.addEventListener("click", (event) => {
        if (event.target.closest("[data-survey-confirm-cancel='true']")) {
            closeSurveyEditConfirmModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !surveyEditConfirmModal?.classList.contains("hidden")) {
            closeSurveyEditConfirmModal();
        }
    });

    // URL 파라미터로 전달된 검색어 자동 실행 (목업 홈 쓰레드 모드 진입)
    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get("q");
    if (urlQuery) {
        if (urlParams.get("ddak") === "makeup-basics" && urlParams.get("autoplan") === "1") {
            startDdakCompletedPlan(urlParams, searchInput);
        } else if (searchInput) {
            searchInput.value = urlQuery;
            autoResizeTextarea(searchInput);
            updateSearchUI(urlQuery);
            executeSearch(urlQuery);
        } else {
            executeSearch(urlQuery);
        }
        window.history.replaceState({}, "", window.location.pathname);
    }

    searchInput?.addEventListener("input", (event) => {
        updateSearchUI(event.target.value);
        autoResizeTextarea(searchInput);
    });

    searchInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            searchForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
    });

    searchForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        executeSearch(searchInput?.value.trim() || "");
    });

    document.querySelectorAll(".suggestion-tag").forEach((tagButton) => {
        tagButton.addEventListener("click", () => {
            const value = tagButton.dataset.query || tagButton.textContent.trim();
            if (searchInput) { searchInput.value = value; autoResizeTextarea(searchInput); }
            updateSearchUI(value);
            executeSearch(value);
        });
    });

    curtainTag?.addEventListener("click", () => {
        const value = curtainTag.dataset.query || "커튼 달기";
        if (searchInput) { searchInput.value = value; autoResizeTextarea(searchInput); }
        updateSearchUI(value);
        executeSearch(value);
    });

    const campingTag = document.getElementById("campingTag");
    campingTag?.addEventListener("click", () => {
        const value = campingTag.dataset.query || "캠핑 입문 준비";
        if (searchInput) { searchInput.value = value; autoResizeTextarea(searchInput); }
        updateSearchUI(value);
        executeSearch(value);
    });

    const desktopTag = document.getElementById("desktopTag");
    desktopTag?.addEventListener("click", () => {
        const value = desktopTag.dataset.query || "데스크탑 조립 세팅";
        if (searchInput) { searchInput.value = value; autoResizeTextarea(searchInput); }
        updateSearchUI(value);
        executeSearch(value);
    });

    const movingTag = document.getElementById("movingTag");
    movingTag?.addEventListener("click", () => {
        const value = movingTag.dataset.query || "원룸 이사 준비";
        if (searchInput) { searchInput.value = value; autoResizeTextarea(searchInput); }
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

    historySidebarToggle?.addEventListener("click", toggleHistorySidebar);
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
