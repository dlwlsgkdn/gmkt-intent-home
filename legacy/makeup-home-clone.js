const asset = (name) => `./makeup-clone-assets/${name}`;

const avatars = [
  asset("dee0d69ed19c10b5.png"),
  asset("58646c54cf4d3101.png"),
  asset("ce0f3b34aa83e7c6.png"),
];

const getDdakThreadUrl = (query) => {
  const searchParams = new URLSearchParams({
    q: query.trim() || "나에게 맞는 메이크업 기본템 추천해줘",
    ddak: "makeup-basics",
    autoplan: "1",
  });

  return `./gmarket-advanced.html?${searchParams.toString()}`;
};

const cards = [
  {
    type: "text",
    titleLabel: "🏆 인기글",
    heading: "내돈내산 장원영 Pick 틴트 정보 공유",
    body: "제가 가본 곳중에 제일 괜찮은 곳을 뽑아보았는데요. 맛피자의 가장 맛있는데, 위치는 용산 쪽이라 접근성도 좋았어요...",
    metric: "24,910명이 봄",
    more: "인기글",
  },
  {
    type: "product",
    badge: asset("51b1e16c95d722fd.png"),
    image: asset("2e8654f04b83fd37.avif"),
    heading: "구달 청귤비타C잡티케어...",
    discount: "72%",
    price: "36,200원",
    metric: "331명이 구매",
    more: "슈퍼딜",
    ddakQuery: "구달 청귤비타C 잡티케어 제품이 내 피부 고민에 맞는지 비교해줘",
  },
  {
    type: "product",
    badge: asset("bb09cb31b3e3f3c8.png"),
    image: asset("f8759723f25da79a.avif"),
    heading: "미니 실리콘 립 브러쉬 컨...",
    discount: "32%",
    price: "1,565원",
    metric: "331명이 구매",
    more: "셀렉티",
    ddakQuery: "초보자가 쓰기 좋은 미니 실리콘 립 브러쉬와 대체 상품 추천해줘",
  },
  {
    type: "video",
    titleLabel: "Shorts",
    titleClass: "shorts-title",
    image: asset("e3f5c06f3cee3afa.gif"),
    time: "00:28",
    caption: "유리숍 공동개발! 바닐라코 틴트 라이브🔥",
    metric: "3,981명이 봄",
    more: "숏츠",
  },
  {
    type: "live",
    image: asset("d9b261330f3ffccf.avif"),
    heading: "뷰티차트×에스티 로더 2...",
    discount: "34%",
    price: "243,100원",
    metric: "391개 구매",
    more: "라이브",
    ddakQuery: "에스티 로더 메이크업 공동구매 상품이 가격 대비 괜찮은지 분석해줘",
  },
  {
    type: "ambassador",
    titleLabel: "🏆 AMBASSADOR",
    image: asset("2bbd0a09ad438a4b.gif"),
    time: "00:45",
    caption: "메이크업 앰버서더가 알려주는 꿀팁 릴스",
    metric: "12,045명이 봄",
    more: "앰버서더 콘텐츠 더보기",
  },
  {
    type: "influencers",
    titleLabel: "💘 TOP 인플루언서",
    people: [
      { name: "덕키비키", count: "49,241명", image: asset("dee0d69ed19c10b5.png") },
      { name: "썸머", count: "12,913명", image: asset("58646c54cf4d3101.png") },
      { name: "뚜비", count: "89,483명", image: asset("ce0f3b34aa83e7c6.png") },
      { name: "나주배", count: "1,512명", image: asset("66113c37add32c9f.png") },
    ],
    more: "인플루언서",
  },
  {
    type: "keywords",
    titleLabel: "🔥 Hot 키워드",
    keywords: [
      { rank: "1", text: "장원영", views: "2.9K 조회", image: asset("8fc2c65adff714e4.avif") },
      { rank: "2", text: "물광 쿠션", views: "1.1K 조회", image: asset("ae9ddc7a5906fcf9.avif") },
      { rank: "3", text: "립 브러쉬", views: "0.6K 조회", image: asset("917e7113fa1d687a.avif") },
    ],
    more: "키워드",
    ddakQuery: "장원영 메이크업과 물광 쿠션, 립 브러쉬 쇼핑 리스트 추천해줘",
  },
];

const masonry = document.querySelector("#masonry");
const columns = [document.createElement("div"), document.createElement("div")];
columns.forEach((column) => {
  column.className = "column";
  masonry.appendChild(column);
});

const makeAvatars = () => `
  <span class="avatars">
    ${avatars.map((src) => `<img src="${src}" alt="">`).join("")}
  </span>
`;

const moreButton = (label) => {
  if (label.includes("더보기")) {
    return `<button class="more-button" type="button">${label}<strong></strong></button>`;
  }
  return `<button class="more-button" type="button"><span>더 많은</span><strong>${label}</strong><span>보기</span></button>`;
};

const ddakButton = (query) => {
  if (!query) {
    return "";
  }
  return `<a class="ddak-button ddak-link" href="${getDdakThreadUrl(query)}" data-ddak-query="${query}">ddak</a>`;
};

const cardActions = (card) => {
  if (!card.ddakQuery) {
    return moreButton(card.more);
  }

  return `
    <div class="card-actions">
      ${moreButton(card.more)}
      ${ddakButton(card.ddakQuery)}
    </div>
  `;
};

const renderCard = (card) => {
  if (card.type === "text") {
    return `
      <article class="content-card">
        <div class="card-title-row"><span class="section-title">${card.titleLabel}</span></div>
        <h3>${card.heading}</h3>
        <p>${card.body}</p>
        <div class="social-row">${makeAvatars()}<span class="metric">${card.metric}</span></div>
        ${cardActions(card)}
      </article>
    `;
  }

  if (card.type === "product") {
    return `
      <article class="content-card">
        <div class="card-title-row"><img class="badge-img" src="${card.badge}" alt=""></div>
        <img class="product-image" src="${card.image}" alt="">
        <h3>${card.heading}</h3>
        <div class="price"><span class="discount">${card.discount}</span><strong>${card.price}</strong></div>
        <div class="social-row">${makeAvatars()}<span class="metric">${card.metric}</span></div>
        ${cardActions(card)}
      </article>
    `;
  }

  if (card.type === "live") {
    return `
      <article class="content-card">
        <div class="card-title-row"><span class="title-live"><span class="mini-live">LIVE</span> 공구 · 경매</span></div>
        <div class="media-wrap">
          <img class="product-image" src="${card.image}" alt="">
          <span class="play-button" aria-hidden="true">▶</span>
          <span class="limited-copy">500개 한정<br>공동구매</span>
        </div>
        <h3>${card.heading}</h3>
        <div class="price"><span class="discount">${card.discount}</span><strong>${card.price}</strong></div>
        <div class="social-row">${makeAvatars()}<span class="metric">${card.metric}</span></div>
        ${cardActions(card)}
      </article>
    `;
  }

  if (card.type === "video" || card.type === "ambassador") {
    return `
      <article class="content-card">
        <div class="card-title-row"><span class="section-title ${card.titleClass || ""}">${card.titleLabel}</span></div>
        <div class="media-wrap">
          <img class="product-image" src="${card.image}" alt="">
          <span class="video-time">▶ ${card.time}</span>
          <span class="media-caption">${card.caption}</span>
        </div>
        <div class="social-row">${makeAvatars()}<span class="metric">${card.metric}</span></div>
        ${cardActions(card)}
      </article>
    `;
  }

  if (card.type === "influencers") {
    return `
      <article class="content-card">
        <div class="card-title-row"><span class="section-title">${card.titleLabel}</span></div>
        <div class="influencer-grid">
          ${card.people
            .map(
              (person) => `
              <div class="influencer">
                <img src="${person.image}" alt="">
                <span class="plus">+</span>
                <strong>${person.name}</strong>
                <span>♙ ${person.count}</span>
              </div>
            `,
            )
            .join("")}
        </div>
        ${cardActions(card)}
      </article>
    `;
  }

  return `
    <article class="content-card">
      <div class="card-title-row"><span class="section-title">${card.titleLabel}</span></div>
      <div class="keyword-list">
        ${card.keywords
          .map(
            (keyword) => `
            <div class="keyword">
              <strong class="keyword-rank">${keyword.rank}</strong>
              <div>
                <h4>${keyword.text}</h4>
                <p>${keyword.views}</p>
              </div>
              <img src="${keyword.image}" alt="">
            </div>
          `,
          )
          .join("")}
      </div>
      ${cardActions(card)}
    </article>
  `;
};

cards.forEach((card, index) => {
  columns[index % 2].insertAdjacentHTML("beforeend", renderCard(card));
});

document.querySelector(".request-form").addEventListener("submit", (event) => {
  event.preventDefault();
  window.location.href = "./ai-pick-clone.html";
});

document.querySelectorAll(".ddak-link[data-ddak-query]").forEach((link) => {
  link.href = getDdakThreadUrl(link.dataset.ddakQuery || "");
});
