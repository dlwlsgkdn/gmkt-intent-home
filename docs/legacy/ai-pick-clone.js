const cards = [
  {
    title: "보송하게 스며드는 톤업을 위해",
    description: "번들거림은 잡고 피부 톤은 자연스럽게 정리해 주는 데일리 베이스예요.",
    reason: "수부지 베이스 반응을 보고 골랐어요.",
    imageUrl: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1000&q=85",
    product: {
      brand: "홀리카홀리카",
      name: "메이크업 선크림 SPF50+ PA+++",
      price: "15,000원~",
      imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80",
    },
  },
  {
    title: "코랄 무드로 실패 없는 데일리 메이크업",
    description: "과한 글리터보다 맑은 음영을 먼저 쌓으면 출근 메이크업에도 부담이 적어요.",
    reason: "퍼스널 컬러 후기와 장바구니 저장 글의 공통 키워드를 반영했어요.",
    imageUrl: "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1000&q=85",
    product: {
      brand: "무드팔레트",
      name: "봄 웜톤 필수 에디션 섀도우 팔레트",
      price: "29,000원~",
      imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=300&q=80",
    },
  },
  {
    title: "오늘 분위기는 결 좋은 광채로",
    description: "피부 표현은 가볍게, 포인트 컬러는 하나만 남기면 데일리 메이크업이 쉬워져요.",
    reason: "메이크업 인기글의 질문, 저장, 구매 반응을 함께 보고 골랐어요.",
    imageUrl: "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=900&q=80",
    product: {
      brand: "봄",
      name: "봄 웜톤 필수 에디션 섀도우 팔레트",
      price: "29,000원~",
      imageUrl: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=300&q=80",
    },
  },
  {
    title: "작은 파우치에 담는 실패 없는 조합",
    description: "선크림, 립, 미니 팔레트처럼 자주 쓰는 제품만 남기면 휴대성이 좋아요.",
    reason: "메이크업 인기글의 질문, 저장, 구매 반응을 함께 보고 골랐어요.",
    imageUrl: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80",
    product: {
      brand: "병풀추출물",
      name: "병풀추출물 수분 진정 앰플 대용량 세트",
      price: "15,200원~",
      imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80",
    },
  },
];

const shorts = [
  {
    id: "v10",
    title: "유리숍 공동개발!\n바닐라코 틴트 라이브🔥",
    views: "50K",
    duration: "00:18",
    creator: "@dailybeauty",
    liked: false,
    thumbnail: "https://hailmary-six.vercel.app/images/shorts/makeup1.gif",
  },
  {
    id: "v11",
    title: "팔레트 하나로 완성하는 봄 메이크업🌸",
    views: "21K",
    duration: "00:29",
    creator: "@linerzip",
    liked: false,
    thumbnail: "https://hailmary-six.vercel.app/images/shorts/makeup2.gif",
  },
  {
    id: "v12",
    title: "다이소 꿀템으로 완성하는\n하이라이터",
    views: "180K",
    duration: "00:22",
    creator: "@shiningyou",
    liked: true,
    thumbnail: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=700&q=80",
  },
  {
    id: "v13",
    title: "환절기 스킨케어 루틴\n대공개",
    views: "33K",
    duration: "00:31",
    creator: "@glowmoments",
    liked: false,
    thumbnail: "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=700&q=80",
  },
  {
    id: "v14",
    title: "속눈썹 펌 집에서\n갓성비로 혼자하기",
    views: "88K",
    duration: "00:27",
    creator: "@lashhome",
    liked: false,
    thumbnail: "https://images.unsplash.com/photo-1589710751893-f9a6770ad71b?w=700&q=80",
  },
  {
    id: "v15",
    title: "곰손도 가능한 컨실러\n완벽 커버법",
    views: "32K",
    duration: "00:19",
    creator: "@covernote",
    liked: false,
    thumbnail: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=700&q=80",
  },
  {
    id: "v16",
    title: "여쿨라 찰떡 블러셔\nTOP3",
    views: "29K",
    duration: "00:16",
    creator: "@moodbeauty",
    liked: false,
    thumbnail: "https://images.unsplash.com/photo-1612817288484-6f916006741a?w=700&q=80",
  },
];

const communityItems = [
  {
    id: "mp1",
    author: "코덕일기",
    title: "이번 뷰티 특가 때 꼭 담아야 할 리스트",
    views: "8.4K",
    comments: 120,
  },
  {
    id: "mp2",
    author: "틴트장인",
    title: "퍼스널 컬러 진단 받았는데 충격...",
    views: "3.1K",
    comments: 45,
  },
  {
    id: "mp3",
    author: "수부지탈출",
    title: "수부지에 맞는 파운데이션 정착템 찾았습니다",
    views: "12K",
    comments: 88,
  },
  {
    id: "mp4",
    author: "뷰티찐팬",
    title: "단종돼서 오열한 레전드 아이템들 ㅠㅠ 돌아와",
    views: "2.2K",
    comments: 34,
  },
  {
    id: "mp5",
    author: "글리터덕",
    title: "까마귀들 모여라 영롱 보스 글리터 모음.zip",
    views: "5.5K",
    comments: 92,
  },
];

const aiGuide = {
  title: "보송하게 스며드는 톤업을 위해",
  description: "번들거림은 잡고 피부 톤은 자연스럽게 정리해 주는 데일리 베이스예요.",
  product: {
    brand: "홀리카홀리카",
    name: "메이크업 선크림 SPF50+ PA+++",
    imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80",
  },
};

const commerceItems = [
  {
    id: "m_c1",
    title: "봄 웜톤 필수 에디션 섀도우 팔레트",
    originalPrice: 45000,
    price: 29000,
    discountRate: 35,
    currentParticipants: 140,
    targetParticipants: 200,
    imageUrl: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: "m_c2",
    title: "병풀추출물 수분 진정 앰플 대용량 세트",
    originalPrice: 38000,
    price: 15200,
    discountRate: 60,
    currentParticipants: 840,
    targetParticipants: 1000,
    imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: "m_c3",
    title: "초보자 필수 미니 메이크업 브러쉬 5종 세트",
    originalPrice: 24000,
    price: 11900,
    discountRate: 50,
    currentParticipants: 120,
    targetParticipants: 300,
    imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&q=80",
  },
  {
    id: "m_c4",
    title: "지속력 갑! 픽실 벨벳 틴트 1+1 (색상교차가능)",
    originalPrice: 28000,
    price: 14000,
    discountRate: 50,
    currentParticipants: 500,
    targetParticipants: 500,
    imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=400&q=80",
  },
];

const ddakThreads = [
  {
    label: "기본템 세트",
    title: "베이스·아이·립·도구를 한 번에 구성",
    description: "검색 의도에 맞춰 처음 사도 실패 적은 기본 조합부터 잡아요.",
    query: "나에게 맞는 메이크업 기본템 베이스 아이 립 도구 추천",
    imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80",
  },
  {
    label: "내 조건 반영",
    title: "피부타입과 톤에 맞춰 후보 좁히기",
    description: "건성·지성·민감피부, 웜톤·쿨톤 기준으로 제품군을 다시 정리해요.",
    query: "피부타입 피부톤에 맞는 메이크업 기본템 추천",
    imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=400&q=80",
  },
  {
    label: "구매 계획",
    title: "예산 안에서 우선순위 장바구니 만들기",
    description: "먼저 살 것과 나중에 사도 되는 것을 나눠 과소비 없이 담아요.",
    query: "10만원 안에서 메이크업 기본템 구매 우선순위 장바구니",
    imageUrl: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=400&q=80",
  },
];

const feed = document.querySelector("#ai-pick-feed");
const ddakSearch = document.querySelector("#ddak-search");
const ddakQuery = document.querySelector("#ddak-query");
const ddakThreadList = document.querySelector("#ddak-thread-list");
const ddakChips = document.querySelectorAll("[data-ddak-query]");
const ddakSurveyAnswers = document.querySelectorAll("[data-survey-question]");
const ddakSurveyQuestions = document.querySelectorAll(".ddak-survey-question");
const ddakSurveyQuestionsTrack = document.querySelector("#ddak-survey-questions");
const ddakSurveyProgress = document.querySelector("#ddak-survey-progress");
const ddakSurveyStatus = document.querySelector("#ddak-survey-status");
const ddakSurveyThread = document.querySelector("#ddak-survey-thread");
const ddakPhotoInput = document.querySelector("#ddak-photo-input");
const ddakPhotoUpload = document.querySelector("#ddak-photo-upload");
const ddakPhotoCard = document.querySelector("#ddak-photo-card");
const ddakPhotoImage = document.querySelector("#ddak-photo-image");
const ddakPhotoThread = document.querySelector("#ddak-photo-thread");
const shortsGrid = document.querySelector("#shorts-grid");
const postList = document.querySelector("#post-list");
const commerceList = document.querySelector("#commerce-list");
const titleButton = document.querySelector(".interest-title");
const menu = document.querySelector("#interest-menu");
const backdrop = document.querySelector(".interest-menu__backdrop");
const tabs = document.querySelectorAll(".contents-tab");
const panels = document.querySelectorAll(".content-panel");
const bottomItems = document.querySelectorAll(".bottom-nav__item");

function createCard(card) {
  const article = document.createElement("article");
  article.className = "pick-card";
  article.innerHTML = `
    <img class="pick-card__background" src="${card.imageUrl}" alt="" loading="lazy">
    <div class="pick-card__shade"></div>
    <div class="pick-card__reason">
      <span>AI PICK</span>
      <p>${card.reason}</p>
    </div>
    <div class="pick-card__copy">
      <h2>${card.title}</h2>
      <p>${card.description}</p>
    </div>
    <a class="pick-product" href="#product" aria-label="${card.product.name} 상품 보기">
      <div class="pick-product__handle"></div>
      <img src="${card.product.imageUrl}" alt="" loading="lazy">
      <div class="pick-product__copy">
        <strong>${card.product.brand}</strong>
        <span>${card.product.name}</span>
        <b>${card.product.price}</b>
      </div>
    </a>
  `;
  return article;
}

function renderCards() {
  const repeatedCards = [...cards, ...cards];
  feed.replaceChildren(...repeatedCards.map(createCard));
}

function getDdakUrl(query) {
  const cleanQuery = query.trim() || "나에게 맞는 메이크업 기본템 추천해줘";
  return `gmarket-advanced.html?q=${encodeURIComponent(cleanQuery)}`;
}

function getDdakPlanUrl(query, params = {}) {
  const searchParams = new URLSearchParams({
    q: query.trim() || "나에게 맞는 메이크업 기본템 추천해줘",
    ddak: "makeup-basics",
    autoplan: "1",
  });

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });

  return `gmarket-advanced.html?${searchParams.toString()}`;
}

function getPhotoThreadQuery(fileName = "") {
  const source = fileName ? `${fileName} 사진` : "업로드한 얼굴 사진";
  return `${source} 기준으로 나에게 맞는 메이크업 기본템과 도구, 구매 계획 세워줘`;
}

function getSurveyThreadQuery() {
  const answers = [...ddakSurveyAnswers]
    .filter((answer) => answer.getAttribute("aria-pressed") === "true")
    .map((answer) => `${answer.dataset.surveyQuestion}: ${answer.dataset.surveyAnswer}`);
  const context = answers.length
    ? `사전 설문 답변(${answers.join(", ")})을 반영해서`
    : "피부타입, 원하는 분위기, 예산, 사용 상황을 먼저 질문하고";

  return `나에게 맞는 메이크업 기본템 추천해줘 ${context} 베이스, 아이, 립, 도구 구매 계획 세워줘`;
}

function updateSurveyThreadLink() {
  const answers = [...ddakSurveyAnswers]
    .filter((answer) => answer.getAttribute("aria-pressed") === "true")
    .reduce((result, answer) => {
      const keyMap = {
        "피부타입": "skin",
        "무드": "mood",
        "예산": "budget",
        "사용 상황": "occasion",
      };
      const key = keyMap[answer.dataset.surveyQuestion];
      if (key) {
        result[key] = answer.dataset.surveyAnswer || "";
      }
      return result;
    }, {});

  ddakSurveyThread.href = getDdakPlanUrl(getSurveyThreadQuery(), answers);
}

function updateSurveyProgress(activeIndex = 0) {
  const total = ddakSurveyQuestions.length || 1;
  const safeIndex = Math.max(0, Math.min(activeIndex, total - 1));
  const currentQuestion = ddakSurveyQuestions[safeIndex];
  const legend = currentQuestion?.querySelector("legend")?.textContent?.trim() || "답변을 선택해 주세요";

  if (ddakSurveyProgress) {
    ddakSurveyProgress.textContent = `${safeIndex + 1}/${total}`;
  }

  if (ddakSurveyStatus) {
    ddakSurveyStatus.textContent = legend;
  }
}

function focusSurveyQuestion(index) {
  const question = ddakSurveyQuestions[index];
  if (!question) {
    updateSurveyProgress(ddakSurveyQuestions.length - 1);
    return;
  }

  if (ddakSurveyQuestionsTrack) {
    ddakSurveyQuestionsTrack.scrollTo({
      left: question.offsetLeft - ddakSurveyQuestionsTrack.offsetLeft,
      behavior: "smooth",
    });
  }
  updateSurveyProgress(index);
}

function createDdakThread(item) {
  const link = document.createElement("a");
  link.href = getDdakUrl(item.query);
  link.className = "ddak-thread-card";
  link.setAttribute("aria-label", `${item.title} 쇼핑쓰레드 시작`);
  link.innerHTML = `
    <div class="ddak-thread-card__media">
      <img src="${item.imageUrl}" alt="" loading="lazy">
    </div>
    <div class="ddak-thread-card__body">
      <span class="ddak-thread-card__label">${item.label}</span>
      <h3>${item.title}</h3>
      <p>${item.description}</p>
      <span class="ddak-thread-card__cta">
        쓰레드 이동
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 12h14"></path>
          <path d="m13 6 6 6-6 6"></path>
        </svg>
      </span>
    </div>
  `;
  return link;
}

function renderDdakThreads() {
  ddakThreadList.replaceChildren(...ddakThreads.map(createDdakThread));
}

function createShort(short) {
  const link = document.createElement("a");
  link.href = `#shorts-${short.id}`;
  link.className = "shorts-card";
  link.setAttribute("aria-label", short.title.replace(/\n/g, " "));
  link.innerHTML = `
    <img class="shorts-card__image" src="${short.thumbnail}" alt="${short.title}" loading="lazy">
    <div class="shorts-card__top-fade"></div>
    <div class="shorts-card__bottom-fade"></div>
    <div class="shorts-card__meta-top">
      <div class="shorts-card__icon-copy">
        <svg width="11" height="11" aria-hidden="true" viewBox="0 0 24 24">
          <polygon points="6 3 20 12 6 21 6 3"></polygon>
        </svg>
        <span>${short.duration}</span>
      </div>
      <div class="shorts-card__icon-copy">
        <svg width="14" height="14" aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
        <span>${short.views}</span>
      </div>
    </div>
    <div class="shorts-card__footer">
      <span>${short.creator}</span>
      <button type="button" class="shorts-card__heart${short.liked ? " shorts-card__heart--liked" : ""}" aria-label="좋아요">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
        </svg>
      </button>
    </div>
  `;
  return link;
}

function renderShorts() {
  shortsGrid.replaceChildren(...shorts.map(createShort));
}

function createPost(item, index) {
  const link = document.createElement("a");
  link.href = `#community-${item.id}`;
  link.className = "post-card";
  link.innerHTML = `
    <div class="post-card__number">${String(index + 1).padStart(2, "0")}</div>
    <div class="post-card__body">
      <h3>${item.title}</h3>
      <div class="post-card__meta">
        <span>${item.author}</span>
        <div class="post-card__stats">
          <span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            ${item.views}
          </span>
          <span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>
            </svg>
            ${item.comments}
          </span>
        </div>
      </div>
    </div>
  `;
  return link;
}

function createAiGuide() {
  const link = document.createElement("a");
  link.href = "#community-ai-guide";
  link.className = "ai-guide-card";
  link.innerHTML = `
    <div class="ai-guide-card__head">
      <span>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path>
          <path d="M20 3v4"></path>
          <path d="M22 5h-4"></path>
          <path d="M4 17v2"></path>
          <path d="M5 18H3"></path>
        </svg>
        AI 쇼핑 가이드
      </span>
    </div>
    <h3>${aiGuide.title}</h3>
    <p>${aiGuide.description}</p>
    <div class="ai-guide-product">
      <img src="${aiGuide.product.imageUrl}" alt="" loading="lazy">
      <div>
        <strong>${aiGuide.product.brand}</strong>
        <span>${aiGuide.product.name}</span>
      </div>
    </div>
  `;
  return link;
}

function renderCommunity() {
  const nodes = communityItems.flatMap((item, index) => {
    const post = createPost(item, index);
    return index === 1 ? [post, createAiGuide()] : [post];
  });
  postList.replaceChildren(...nodes);
}

function formatWon(value) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function createCommerceItem(item) {
  const progress = Math.min(100, Math.round((item.currentParticipants / item.targetParticipants) * 100));
  const link = document.createElement("a");
  link.href = `#commerce-${item.id}`;
  link.className = "commerce-card";
  link.innerHTML = `
    <div class="commerce-card__media">
      <img src="${item.imageUrl}" alt="${item.title}" loading="lazy">
      <div class="commerce-card__badge">핫딜</div>
    </div>
    <div class="commerce-card__body">
      <h3>${item.title}</h3>
      <div class="commerce-price">
        <div class="commerce-price__row">
          <span class="commerce-price__original">${formatWon(item.originalPrice)}</span>
          <strong class="commerce-price__current">${formatWon(item.price)}</strong>
        </div>
        <div class="commerce-price__discount">${item.discountRate}% 할인</div>
      </div>
      <div class="commerce-progress" aria-label="공동구매 달성률 ${progress}%">
        <div class="commerce-progress__bar" style="width: ${progress}%"></div>
      </div>
      <p class="commerce-card__participants">달성 기준 ${item.currentParticipants}/${item.targetParticipants}명 참석</p>
    </div>
  `;
  return link;
}

function renderCommerce() {
  commerceList.replaceChildren(...commerceItems.map(createCommerceItem));
}

function showPanel(panelName) {
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panelName !== panelName;
  });
}

function setMenuOpen(isOpen) {
  titleButton.setAttribute("aria-expanded", String(isOpen));
  menu.hidden = !isOpen;
}

titleButton.addEventListener("click", () => {
  setMenuOpen(titleButton.getAttribute("aria-expanded") !== "true");
});

backdrop.addEventListener("click", () => {
  setMenuOpen(false);
});

ddakSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  window.location.href = getDdakUrl(ddakQuery.value);
});

ddakChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    ddakQuery.value = chip.dataset.ddakQuery || "";
    ddakQuery.focus();
  });
});

ddakSurveyAnswers.forEach((answer) => {
  answer.addEventListener("click", () => {
    const group = answer.dataset.surveyQuestion;
    const isPressed = answer.getAttribute("aria-pressed") === "true";
    const currentQuestion = answer.closest(".ddak-survey-question");
    const currentIndex = [...ddakSurveyQuestions].indexOf(currentQuestion);

    ddakSurveyAnswers.forEach((item) => {
      if (item.dataset.surveyQuestion === group) {
        item.setAttribute("aria-pressed", "false");
      }
    });

    answer.setAttribute("aria-pressed", String(!isPressed));
    updateSurveyThreadLink();

    if (!isPressed) {
      const nextIndex = Math.min(currentIndex + 1, ddakSurveyQuestions.length - 1);
      setTimeout(() => focusSurveyQuestion(nextIndex), 120);
    } else {
      updateSurveyProgress(currentIndex);
    }
  });
});

ddakPhotoUpload.addEventListener("click", () => {
  ddakPhotoInput.click();
});

ddakPhotoInput.addEventListener("change", () => {
  const file = ddakPhotoInput.files?.[0];

  if (!file) {
    return;
  }

  ddakPhotoImage.src = URL.createObjectURL(file);
  ddakPhotoImage.hidden = false;
  ddakPhotoCard.classList.add("ddak-photo-card--filled");
  ddakPhotoThread.href = getDdakUrl(getPhotoThreadQuery(file.name));
});

tabs.forEach((tab) => {
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    tabs.forEach((item) => item.classList.remove("contents-tab--active"));
    tab.classList.add("contents-tab--active");
    showPanel(tab.dataset.panel || "ai-pick");
  });
});

shortsGrid.addEventListener("click", (event) => {
  const heart = event.target.closest(".shorts-card__heart");

  if (!heart) {
    return;
  }

  event.preventDefault();
  heart.classList.toggle("shorts-card__heart--liked");
});

bottomItems.forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    bottomItems.forEach((navItem) => navItem.classList.remove("bottom-nav__item--active"));
    item.classList.add("bottom-nav__item--active");
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMenuOpen(false);
  }
});

renderCards();
updateSurveyThreadLink();
updateSurveyProgress(0);
renderDdakThreads();
renderShorts();
renderCommunity();
renderCommerce();
