window.solutionData = {
    "커튼": {
        title: "커튼 설치 맞춤 제안",
        intentReason: "거실 창문에 맞는 커튼 설치 목적",
        steps: [
            {
                step: 1,
                name: "공간 실측 준비",
                essential: false,
                description: "창문 폭과 설치 높이를 먼저 정확히 잡아야 이후 부자재와 커튼 길이 선택이 흔들리지 않습니다.",
                products: [
                    {
                        id: 101,
                        name: "고정밀 스틸 줄자 5m",
                        price: "9,800",
                        originalPrice: "13,000",
                        score: 98,
                        img: "https://images.unsplash.com/photo-1581147036324-c17da42e26c2?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "창문 폭과 높이를 안정적으로 잴 수 있는 기본 측정 도구입니다.",
                            "실측 오차를 줄이기 쉬워 커튼 주문 전 준비 단계에 잘 맞습니다.",
                            "처음 설치하는 경우에도 부담 없이 쓰기 좋은 구성입니다."
                        ],
                        spec: { size: "5m x 19mm", feature: "자동 고정 스틸 줄자" }
                    },
                    {
                        id: 102,
                        name: "레이저 거리 측정기",
                        price: "32,900",
                        originalPrice: "45,000",
                        score: 92,
                        img: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "천장부터 바닥까지 긴 구간을 빠르게 측정할 수 있습니다.",
                            "커튼 설치 높이와 폭을 반복 확인할 때 편리합니다.",
                            "여러 창을 한 번에 준비할 때 시간을 줄여줍니다."
                        ],
                        spec: { size: "최대 40m", feature: "레이저 실측" }
                    }
                ]
            },
            {
                step: 2,
                name: "설치 부자재 선택",
                essential: true,
                description: "설치 방식과 벽면 조건에 맞는 부자재를 정하면 시공 난이도와 완성도 차이가 크게 줄어듭니다.",
                products: [
                    {
                        id: 201,
                        name: "커튼 브라켓 세트",
                        price: "13,500",
                        originalPrice: "18,000",
                        score: 99,
                        img: "https://images.unsplash.com/photo-1622396481328-9b1b78cdd9fd?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "벽면 고정용 기본 부자재로 안정적인 설치를 돕습니다.",
                            "무게가 있는 암막 커튼에도 잘 어울리는 구성입니다.",
                            "표준 규격이라 대부분의 봉과 함께 쓰기 쉽습니다."
                        ],
                        spec: { size: "기본 규격", feature: "브라켓 2개 세트" }
                    },
                    {
                        id: 202,
                        name: "압축 커튼봉 확장형",
                        price: "18,900",
                        originalPrice: "25,000",
                        score: 88,
                        img: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "타공이 부담스러운 공간에 간편하게 적용할 수 있습니다.",
                            "길이 조절이 가능해 다양한 창 폭에 대응합니다.",
                            "가벼운 커튼이나 속커튼 구성에 특히 잘 맞습니다."
                        ],
                        spec: { size: "180~360cm", feature: "무타공 확장형" }
                    }
                ]
            },
            {
                step: 3,
                name: "목적별 커튼 추천",
                essential: true,
                description: "채광, 분위기, 프라이버시처럼 사용 목적에 맞는 원단을 골라야 실제 만족도가 높습니다.",
                products: [
                    {
                        id: 301,
                        name: "3중직 암막 커튼",
                        price: "48,900",
                        originalPrice: "65,000",
                        score: 100,
                        img: "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&q=80&w=1000",
                        aiSummary: [
                            "빛 차단과 프라이버시 확보가 중요한 공간에 적합합니다.",
                            "두께감이 있어 거실이나 침실 분위기를 안정적으로 잡아줍니다.",
                            "냉난방 효율을 보완하는 데에도 도움이 됩니다."
                        ],
                        spec: { size: "140 x 235cm", feature: "3중직 암막 원단" }
                    },
                    {
                        id: 302,
                        name: "쉬폰 린넨 커튼",
                        price: "29,500",
                        originalPrice: "39,000",
                        score: 91,
                        img: "https://images.unsplash.com/photo-1505691938895-1758d7eaa511?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "은은한 채광과 가벼운 분위기를 원하는 공간에 잘 맞습니다.",
                            "속커튼이나 레이어드 구성으로 활용하기 좋습니다.",
                            "밝고 부드러운 인테리어 톤을 만들기 쉽습니다."
                        ],
                        spec: { size: "140 x 230cm", feature: "쉬폰/린넨 스타일" }
                    }
                ]
            }
        ]
    },
    "캠핑": {
        title: "캠핑 입문 맞춤 제안",
        intentReason: "처음 캠핑을 준비하는 분을 위한 필수 장비 선택 목적",
        steps: [
            {
                step: 1,
                name: "텐트 선택",
                essential: true,
                description: "인원수와 이동 방식에 맞는 텐트를 먼저 정해야 이후 장비 부피와 전체 캠핑 동선이 자연스럽게 맞춰집니다.",
                products: [
                    {
                        id: 111,
                        name: "4시즌 돔텐트 2-3인용",
                        price: "89,900",
                        originalPrice: "129,000",
                        score: 98,
                        img: "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "바람과 비에 강한 구조로 다양한 계절에 안정적으로 사용할 수 있습니다.",
                            "2-3인이 여유롭게 사용할 수 있는 공간으로 입문용에 딱 맞습니다.",
                            "이중 구조 설계로 결로를 최소화해 쾌적한 수면 환경을 만들어줍니다."
                        ],
                        spec: { size: "2-3인용 / 설치 210×180cm", feature: "4시즌 이중 구조 돔텐트" }
                    },
                    {
                        id: 112,
                        name: "원터치 팝업 텐트 2인용",
                        price: "45,900",
                        originalPrice: "65,000",
                        score: 91,
                        img: "https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "설치와 철수가 1분 이내에 끝나 처음 캠핑하는 분에게 특히 편리합니다.",
                            "차박이나 당일 캠핑 등 간편한 야외 활동에 잘 어울립니다.",
                            "가볍고 작은 수납 사이즈로 트렁크 공간을 많이 차지하지 않습니다."
                        ],
                        spec: { size: "2인용 / 210×150cm", feature: "원터치 자동 펼침" }
                    }
                ]
            },
            {
                step: 2,
                name: "취사 & 조명 준비",
                essential: true,
                description: "해 지기 전후로 가장 체감 차이가 큰 영역이라, 기본 취사도구와 조명은 초반에 같이 준비하는 편이 안전합니다.",
                products: [
                    {
                        id: 211,
                        name: "캠핑 버너 + 코펠 세트",
                        price: "34,900",
                        originalPrice: "49,000",
                        score: 97,
                        img: "https://images.unsplash.com/photo-1532375810709-75b1da00537c?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "간단한 라면부터 본격적인 요리까지 폭넓게 활용할 수 있습니다.",
                            "경량 알루미늄 코펠로 부피를 줄이면서 내구성을 유지했습니다.",
                            "입문자도 쉽게 연결할 수 있는 안전 잠금 버너 구조입니다."
                        ],
                        spec: { size: "버너 직경 65mm + 코펠 4종", feature: "가스 버너 + 코펠 세트" }
                    },
                    {
                        id: 212,
                        name: "감성 캠핑 LED 랜턴",
                        price: "28,500",
                        originalPrice: "38,000",
                        score: 89,
                        img: "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "따뜻한 빛 색상으로 캠핑 분위기를 자연스럽게 살려줍니다.",
                            "USB 충전 방식으로 배터리 걱정 없이 며칠 연속 사용 가능합니다.",
                            "조도 조절 기능으로 취침 전 무드등으로도 활용할 수 있습니다."
                        ],
                        spec: { size: "직경 9cm, 높이 18cm", feature: "USB 충전 / 3단계 밝기 조절" }
                    }
                ]
            },
            {
                step: 3,
                name: "침구 & 편의 용품",
                essential: false,
                description: "밤 기온과 바닥 컨디션을 고려한 침구를 챙기면 초보 캠핑에서도 피로감이 크게 줄어듭니다.",
                products: [
                    {
                        id: 311,
                        name: "3시즌 경량 침낭",
                        price: "42,000",
                        originalPrice: "58,000",
                        score: 96,
                        img: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "봄·여름·가을 3시즌을 커버해 한 번 사면 오래 쓸 수 있습니다.",
                            "마미형 구조로 체온을 효율적으로 보존해 밤에도 따뜻하게 잘 수 있습니다.",
                            "경량 소재로 배낭 패킹 시 부피를 크게 줄여줍니다."
                        ],
                        spec: { size: "최대 185cm 신장 대응", feature: "마미형 3시즌 / 소형 수납" }
                    },
                    {
                        id: 312,
                        name: "자충식 캠핑 매트",
                        price: "26,900",
                        originalPrice: "36,000",
                        score: 88,
                        img: "https://images.unsplash.com/photo-1537225228614-56cc3556d7ed?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "바닥의 냉기와 울퉁불퉁함을 효과적으로 차단해줍니다.",
                            "밸브를 열면 자동으로 부풀어 별도 펌프가 필요 없습니다.",
                            "침낭과 함께 쓰면 보온 효과를 크게 높일 수 있습니다."
                        ],
                        spec: { size: "185×58cm, 두께 3cm", feature: "자충식 / 경량 폼 내장" }
                    }
                ]
            },
            {
                step: 4,
                name: "테이블 & 체어 준비",
                essential: false,
                description: "식사, 휴식, 장비 정리를 오래 편하게 하려면 마지막으로 체어와 테이블 구성을 맞춰주는 게 좋습니다.",
                products: [
                    {
                        id: 411,
                        name: "폴딩 캠핑 체어 2개 세트",
                        price: "39,900",
                        originalPrice: "55,000",
                        score: 93,
                        img: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "장시간 앉아 있어도 부담이 적어 식사나 휴식 시간이 편해집니다.",
                            "접이식 구조라 트렁크 수납이 쉽고 설치도 간단합니다.",
                            "입문 캠핑에서 가장 체감 만족도가 큰 편의 장비입니다."
                        ],
                        spec: { size: "내하중 120kg / 2개", feature: "접이식 경량 캠핑 체어" }
                    },
                    {
                        id: 412,
                        name: "롤테이블 알루미늄 세트",
                        price: "47,500",
                        originalPrice: "64,000",
                        score: 90,
                        img: "https://images.unsplash.com/photo-1522163182402-834f871fd851?auto=format&fit=crop&q=80&w=600",
                        aiSummary: [
                            "조리도구와 식기를 안정적으로 올려둘 수 있어 캠핑 동선이 정리됩니다.",
                            "알루미늄 상판이라 관리가 쉽고 야외 오염에도 비교적 강합니다.",
                            "버너와 랜턴을 함께 두기 좋은 기본 테이블 구성입니다."
                        ],
                        spec: { size: "90×52cm", feature: "롤업 상판 / 전용 수납가방 포함" }
                    }
                ]
            }
        ]
    }
};
