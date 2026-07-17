import type {
  AdminCustomerChatThread,
  AdminSaleRecord,
  AdminShipmentBatch,
  AuctionPost,
  ChatThread,
  PaymentAccount,
  UserProfile,
  WonAuction,
} from "@/src/types/auction";
import { getRelativeKoreanDateTime } from "@/src/utils/formatters";
import { getNextShippingDispatchDate } from "@/src/utils/shipping";

export type { ChatThread };

const MOCK_NOW = new Date();
const mockDateTime = (daysAgo: number, time: string) =>
  getRelativeKoreanDateTime(-daysAgo, time, MOCK_NOW);

// TODO: DB 연동 필요 — 실제 서비스에서는 아래 데이터를 API/Repository 응답으로 교체하세요.
// TODO: DB 연동 필요 — bidHistory는 관리자 수정 API가 없는 append-only 입찰 원장에서 읽어오세요.
export const auctionPosts: AuctionPost[] = [
  {
    id: "auction-burberry-trench-0716",
    title: "버버리 체크 안감 빈티지 트렌치코트",
    description:
      "버버리 체크 안감 트렌치코트 여성 66~77 가슴 57cm 총장 108cm 얼룩·찢김 없음 상태 A",
    category: "여성 아우터 · 66~77",
    createdAt: mockDateTime(0, "09:00:00"),
    closesAt: mockDateTime(0, "21:00:00"),
    status: "active",
    participantCount: 5,
    startingPrice: 39000,
    currentPrice: 68000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1544022613-e87ca75a784a?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1551488831-00ddcb6c6bd3?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-trench-5",
        bidderName: "김민수",
        amount: 68000,
        bidAt: mockDateTime(0, "18:42:00"),
      },
      {
        id: "bid-trench-4",
        bidderName: "박정희",
        amount: 65000,
        bidAt: mockDateTime(0, "17:18:00"),
      },
      {
        id: "bid-trench-3",
        bidderName: "이영숙",
        amount: 59000,
        bidAt: mockDateTime(0, "15:06:00"),
      },
      {
        id: "bid-trench-2",
        bidderName: "최수진",
        amount: 52000,
        bidAt: mockDateTime(0, "12:31:00"),
      },
      {
        id: "bid-trench-1",
        bidderName: "정미경",
        amount: 44000,
        bidAt: mockDateTime(0, "10:14:00"),
      },
    ],
  },
  {
    id: "auction-camel-coat-0716",
    title: "울 100% 카멜 핸드메이드 코트",
    description:
      "울 100% 카멜 핸드메이드 코트 여성 66 가슴 54cm 총장 102cm 세탁 완료 상태 A+",
    category: "여성 아우터 · 66",
    createdAt: mockDateTime(0, "09:20:00"),
    closesAt: mockDateTime(0, "21:00:00"),
    status: "active",
    participantCount: 0,
    startingPrice: 25000,
    currentPrice: 25000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1608234807905-4466023792f5?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [],
  },
  {
    id: "auction-linen-blouse-0716",
    title: "프랑스 자수 린넨 블라우스",
    description:
      "프랑스 자수 린넨 블라우스 여성 55~66 가슴 52cm 총장 64cm 비침 적음 상태 A",
    category: "여성 상의 · 55~66",
    createdAt: mockDateTime(0, "09:40:00"),
    closesAt: mockDateTime(0, "21:00:00"),
    status: "active",
    participantCount: 4,
    startingPrice: 12000,
    currentPrice: 22000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1564257577054-3f183f1f082b?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1605763240000-7e93b172d754?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-blouse-4",
        bidderName: "윤혜진",
        amount: 22000,
        bidAt: mockDateTime(0, "17:55:00"),
      },
      {
        id: "bid-blouse-3",
        bidderName: "김나은",
        amount: 19000,
        bidAt: mockDateTime(0, "16:20:00"),
      },
      {
        id: "bid-blouse-2",
        bidderName: "오미숙",
        amount: 16000,
        bidAt: mockDateTime(0, "13:03:00"),
      },
      {
        id: "bid-blouse-1",
        bidderName: "한경희",
        amount: 13000,
        bidAt: mockDateTime(0, "11:27:00"),
      },
    ],
  },
  {
    id: "auction-floral-dress-0716",
    title: "레트로 플라워 쉬폰 롱 원피스",
    description:
      "레트로 플라워 쉬폰 롱 원피스 여성 66~77 가슴 55cm 총장 116cm 안감·허리끈 있음 상태 A",
    category: "여성 원피스 · 66~77",
    createdAt: mockDateTime(1, "09:00:00"),
    closesAt: mockDateTime(1, "21:00:00"),
    status: "active",
    participantCount: 4,
    startingPrice: 15000,
    currentPrice: 31000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1596783074918-c84cb06531ca?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-dress-4",
        bidderName: "강선영",
        amount: 31000,
        bidAt: mockDateTime(1, "18:11:00"),
      },
      {
        id: "bid-dress-3",
        bidderName: "박은주",
        amount: 27000,
        bidAt: mockDateTime(1, "15:44:00"),
      },
      {
        id: "bid-dress-2",
        bidderName: "조현숙",
        amount: 21000,
        bidAt: mockDateTime(1, "13:38:00"),
      },
      {
        id: "bid-dress-1",
        bidderName: "문지영",
        amount: 17000,
        bidAt: mockDateTime(1, "10:42:00"),
      },
    ],
  },
  {
    id: "auction-cable-knit-0716",
    title: "폴로 랄프로렌 케이블 니트",
    description:
      "폴로 랄프로렌 케이블 니트 여성 66 가슴 51cm 총장 63cm 늘어남·큰 보풀 없음 상태 A+",
    category: "여성 니트 · 66",
    createdAt: mockDateTime(1, "09:25:00"),
    closesAt: mockDateTime(1, "21:00:00"),
    status: "active",
    participantCount: 2,
    startingPrice: 18000,
    currentPrice: 24000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1583743814966-8936f37f4678?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-knit-2",
        bidderName: "서정아",
        amount: 24000,
        bidAt: mockDateTime(1, "16:49:00"),
      },
      {
        id: "bid-knit-1",
        bidderName: "임미자",
        amount: 20000,
        bidAt: mockDateTime(1, "11:52:00"),
      },
    ],
  },
  {
    id: "auction-levis-501-0715",
    title: "빈티지 리바이스 501 데님",
    description:
      "미국 빈티지 리바이스 501 허리 31인치 총장 101cm 원형 밑단 원단 탄탄 상태 A",
    category: "공용 하의 · 31인치",
    createdAt: mockDateTime(1, "09:50:00"),
    closesAt: mockDateTime(1, "21:00:00"),
    status: "active",
    participantCount: 4,
    startingPrice: 25000,
    currentPrice: 59000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1565084888279-aca607ecce0c?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-denim-5",
        bidderName: "김나은",
        amount: 59000,
        bidAt: mockDateTime(1, "20:56:00"),
      },
      {
        id: "bid-denim-4",
        bidderName: "신동호",
        amount: 57000,
        bidAt: mockDateTime(1, "20:51:00"),
      },
      {
        id: "bid-denim-3",
        bidderName: "김나은",
        amount: 53000,
        bidAt: mockDateTime(1, "20:44:00"),
      },
      {
        id: "bid-denim-2",
        bidderName: "백승호",
        amount: 44000,
        bidAt: mockDateTime(1, "18:22:00"),
      },
      {
        id: "bid-denim-1",
        bidderName: "홍재민",
        amount: 31000,
        bidAt: mockDateTime(1, "14:09:00"),
      },
    ],
  },
  {
    id: "auction-tweed-jacket-recent",
    title: "샤넬풍 울 트위드 재킷",
    description:
      "아이보리 울 트위드 재킷 여성 66 가슴 53cm 총장 58cm 안감·주머니 있음 상태 A+",
    category: "여성 아우터 · 66",
    createdAt: mockDateTime(2, "09:05:00"),
    closesAt: mockDateTime(2, "21:00:00"),
    status: "active",
    participantCount: 3,
    startingPrice: 22000,
    currentPrice: 42000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-tweed-3",
        bidderName: "이정화",
        amount: 42000,
        bidAt: mockDateTime(2, "19:35:00"),
      },
      {
        id: "bid-tweed-2",
        bidderName: "김혜숙",
        amount: 35000,
        bidAt: mockDateTime(2, "16:12:00"),
      },
      {
        id: "bid-tweed-1",
        bidderName: "박명희",
        amount: 27000,
        bidAt: mockDateTime(2, "11:48:00"),
      },
    ],
  },
  {
    id: "auction-silk-scarf-recent",
    title: "이탈리아 실크 정사각 스카프",
    description:
      "이탈리아 100% 실크 스카프 86cm 정사각 체인 패턴 세탁 완료 올 풀림 없음 상태 A+",
    category: "여성 잡화 · 실크",
    createdAt: mockDateTime(2, "09:35:00"),
    closesAt: mockDateTime(2, "21:00:00"),
    status: "active",
    participantCount: 0,
    startingPrice: 9000,
    currentPrice: 9000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1584030373081-f37b7bb4fa8e?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [],
  },
  {
    id: "auction-denim-shirt-recent",
    title: "랄프로렌 워싱 데님 셔츠",
    description:
      "랄프로렌 워싱 데님 셔츠 공용 100 가슴 56cm 총장 74cm 단추 정상 상태 A",
    category: "공용 상의 · 100",
    createdAt: mockDateTime(3, "09:10:00"),
    closesAt: mockDateTime(3, "21:00:00"),
    status: "active",
    participantCount: 2,
    startingPrice: 16000,
    currentPrice: 23000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1603252110481-7ba873bf42ab?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-denim-shirt-2",
        bidderName: "정상호",
        amount: 23000,
        bidAt: mockDateTime(3, "17:28:00"),
      },
      {
        id: "bid-denim-shirt-1",
        bidderName: "문영자",
        amount: 18000,
        bidAt: mockDateTime(3, "12:02:00"),
      },
    ],
  },
  {
    id: "auction-pleated-skirt-recent",
    title: "브라운 체크 플리츠 롱스커트",
    description:
      "브라운 체크 플리츠 롱스커트 허리 29~31인치 총장 82cm 뒷밴딩·안감 있음 상태 A",
    category: "여성 하의 · 29~31",
    createdAt: mockDateTime(3, "09:40:00"),
    closesAt: mockDateTime(3, "21:00:00"),
    status: "active",
    participantCount: 1,
    startingPrice: 11000,
    currentPrice: 14000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-skirt-1",
        bidderName: "송미란",
        amount: 14000,
        bidAt: mockDateTime(3, "14:16:00"),
      },
    ],
  },
  {
    id: "auction-cashmere-cardigan-recent",
    title: "캐시미어 혼방 라운드 카디건",
    description:
      "라벤더 캐시미어 혼방 카디건 여성 66~77 가슴 56cm 총장 65cm 얼룩·단추 빠짐 없음 상태 A+",
    category: "여성 니트 · 66~77",
    createdAt: mockDateTime(4, "09:15:00"),
    closesAt: mockDateTime(4, "21:00:00"),
    status: "active",
    participantCount: 0,
    startingPrice: 17000,
    currentPrice: 17000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1608234807905-4466023792f5?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [],
  },
  {
    id: "auction-windbreaker-recent",
    title: "노스페이스 경량 바람막이",
    description:
      "노스페이스 경량 바람막이 공용 100 가슴 58cm 총장 69cm 지퍼·조임끈 정상 상태 A",
    category: "공용 아우터 · 100",
    createdAt: mockDateTime(5, "09:30:00"),
    closesAt: mockDateTime(5, "21:00:00"),
    status: "active",
    participantCount: 4,
    startingPrice: 19000,
    currentPrice: 33000,
    bidIncrement: 1000,
    imageUrls: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=85",
      "https://images.unsplash.com/photo-1544022613-e87ca75a784a?auto=format&fit=crop&w=1200&q=85",
    ],
    bidHistory: [
      {
        id: "bid-windbreaker-4",
        bidderName: "김성희",
        amount: 33000,
        bidAt: mockDateTime(5, "20:08:00"),
      },
      {
        id: "bid-windbreaker-3",
        bidderName: "최광호",
        amount: 29000,
        bidAt: mockDateTime(5, "17:51:00"),
      },
      {
        id: "bid-windbreaker-2",
        bidderName: "이숙자",
        amount: 25000,
        bidAt: mockDateTime(5, "14:27:00"),
      },
      {
        id: "bid-windbreaker-1",
        bidderName: "장민호",
        amount: 21000,
        bidAt: mockDateTime(5, "10:33:00"),
      },
    ],
  },
];

export const currentUser: UserProfile = {
  id: "user-kim-naeun",
  name: "김나은",
  phone: "010-4827-1935",
  address: "서울특별시 마포구 성미산로 24길 18, 302호",
  shippingCount: 2,
  shippingAddresses: [
    {
      id: "address-home",
      label: "기본 배송지",
      recipientName: "김나은",
      phone: "010-4827-1935",
      address: "서울특별시 마포구 성미산로 24길 18, 302호",
      isDefault: true,
    },
    {
      id: "address-daughter",
      label: "딸네 집",
      recipientName: "김은지",
      phone: "010-7314-2280",
      address: "경기도 고양시 일산동구 중앙로 1200, 105동 1204호",
      isDefault: false,
    },
    {
      id: "address-office",
      label: "가게",
      recipientName: "김나은",
      phone: "010-4827-1935",
      address: "서울특별시 마포구 월드컵북로 82, 1층 꽃가게",
      isDefault: false,
    },
  ],
};

export const wonAuctions: WonAuction[] = [
  {
    id: "win-levis-0715",
    auctionId: "sale-levis-501-0715",
    title: "빈티지 리바이스 501 데님",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-15T21:00:00+09:00",
    winningBid: 59000,
    isBulky: false,
    paymentStatus: "pending",
    stage: "payment-pending",
    paymentDeadlineAt: getRelativeKoreanDateTime(1, "11:59:59", MOCK_NOW),
  },
  {
    id: "win-silk-scarf-0714",
    auctionId: "sale-silk-scarf-0714",
    title: "에르메스 스타일 실크 스카프",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-14T21:00:00+09:00",
    winningBid: 28000,
    isBulky: false,
    paymentStatus: "pending",
    stage: "payment-pending",
    paymentDeadlineAt: getRelativeKoreanDateTime(1, "11:59:59", MOCK_NOW),
  },
  {
    id: "win-cardigan-0713",
    auctionId: "sale-cashmere-cardigan-0713",
    title: "캐시미어 혼방 라운드 카디건",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1608234807905-4466023792f5?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-13T21:00:00+09:00",
    winningBid: 36000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "keep",
    paidAt: mockDateTime(1, "10:30:00"),
    keepExpiresAt: getRelativeKoreanDateTime(13, "10:30:00", MOCK_NOW),
  },
  {
    id: "win-northface-padding-0712",
    auctionId: "sale-northface-padding-0712",
    title: "노스페이스 구스 롱패딩",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1544022613-e87ca75a784a?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-12T21:00:00+09:00",
    winningBid: 72000,
    isBulky: true,
    paymentStatus: "paid",
    stage: "keep",
    paidAt: mockDateTime(0, "11:20:00"),
    keepExpiresAt: getRelativeKoreanDateTime(7, "11:20:00", MOCK_NOW),
  },
  {
    id: "win-wool-jacket-0711",
    auctionId: "sale-wool-jacket-0711",
    title: "브라운 헤링본 울 재킷",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-11T21:00:00+09:00",
    winningBid: 47000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "keep",
    paidAt: mockDateTime(11, "09:30:00"),
    keepExpiresAt: getRelativeKoreanDateTime(2, "09:30:00", MOCK_NOW),
  },
  {
    id: "win-linen-dress-0710",
    auctionId: "sale-linen-dress-0710",
    title: "내추럴 린넨 셔츠 원피스",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-10T21:00:00+09:00",
    winningBid: 41000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "keep",
    paidAt: mockDateTime(9, "14:10:00"),
    keepExpiresAt: getRelativeKoreanDateTime(4, "14:10:00", MOCK_NOW),
  },
  {
    id: "win-polo-knit-0709",
    auctionId: "sale-polo-knit-0709",
    title: "폴로 랄프로렌 울 니트 L",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-09T21:00:00+09:00",
    winningBid: 44000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "keep",
    paidAt: mockDateTime(8, "12:40:00"),
    keepExpiresAt: getRelativeKoreanDateTime(5, "12:40:00", MOCK_NOW),
  },
  {
    id: "win-lacoste-shirt-0708",
    auctionId: "sale-lacoste-shirt-0708",
    title: "라코스테 클래식 피케 셔츠",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-08T21:00:00+09:00",
    winningBid: 32000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "keep",
    paidAt: mockDateTime(5, "15:20:00"),
    keepExpiresAt: getRelativeKoreanDateTime(9, "15:20:00", MOCK_NOW),
  },
  {
    id: "win-pleated-skirt-0707",
    auctionId: "sale-pleated-skirt-0707",
    title: "버버리 체크 플리츠 스커트 66",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-07T21:00:00+09:00",
    winningBid: 38000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "keep",
    paidAt: mockDateTime(3, "10:50:00"),
    keepExpiresAt: getRelativeKoreanDateTime(11, "10:50:00", MOCK_NOW),
  },
  {
    id: "win-dior-jacket-shipping-0716",
    auctionId: "sale-dior-jacket-shipping-0716",
    title: "디올 빈티지 울 재킷 66",
    description:
      "디올 빈티지 울 재킷 여성 66 가슴 52cm 총장 68cm 안감 깨끗 상태 A",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=800&q=85",
    imageUrls: [
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1400&q=90",
      "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1400&q=90",
    ],
    closedAt: mockDateTime(2, "21:00:00"),
    winningBid: 63000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "shipping-requested",
    paidAt: mockDateTime(1, "10:15:00"),
    shipmentBatchId: "shipment-batch-naeun-0716",
    shippingRequestedAt: mockDateTime(0, "10:20:00"),
    shippingScheduledAt: getNextShippingDispatchDate(
      mockDateTime(0, "10:20:00"),
    ),
    shippingAddress: currentUser.shippingAddresses[0],
  },
  {
    id: "win-maxmara-skirt-shipping-0716",
    auctionId: "sale-maxmara-skirt-shipping-0716",
    title: "막스마라 플리츠 스커트 66",
    description:
      "막스마라 플리츠 스커트 여성 66 허리 35cm 총장 78cm 주름 상태 A+",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=800&q=85",
    imageUrls: [
      "https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=1400&q=90",
      "https://images.unsplash.com/photo-1594633312681-425c7b97ccd1?auto=format&fit=crop&w=1400&q=90",
    ],
    closedAt: mockDateTime(3, "21:00:00"),
    winningBid: 42000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "shipping-requested",
    paidAt: mockDateTime(1, "10:15:00"),
    shipmentBatchId: "shipment-batch-naeun-0716",
    shippingRequestedAt: mockDateTime(0, "10:20:00"),
    shippingScheduledAt: getNextShippingDispatchDate(
      mockDateTime(0, "10:20:00"),
    ),
    shippingAddress: currentUser.shippingAddresses[0],
  },
  {
    id: "win-silk-blouse-0706",
    auctionId: "sale-silk-blouse-0706",
    title: "아이보리 실크 블라우스 66",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1564257577054-486c1b7d3f15?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-06T21:00:00+09:00",
    winningBid: 35000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "shipped",
    paidAt: mockDateTime(10, "10:00:00"),
    shippingRequestedAt: mockDateTime(8, "09:15:00"),
    shippingScheduledAt: mockDateTime(7, "17:00:00"),
    shippingAddress: currentUser.shippingAddresses[0],
    shipmentBatchId: "shipment-batch-naeun-shipped-0706",
    courier: "한진택배",
    trackingNumber: "540012340001",
    shippedAt: mockDateTime(7, "17:12:00"),
  },
  {
    id: "win-denim-shirt-0705",
    auctionId: "sale-denim-shirt-0705",
    title: "리바이스 웨스턴 데님 셔츠 L",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1588359348347-9bc6cbbb689e?auto=format&fit=crop&w=800&q=85",
    closedAt: "2026-07-05T21:00:00+09:00",
    winningBid: 39000,
    isBulky: false,
    paymentStatus: "paid",
    stage: "shipped",
    paidAt: mockDateTime(10, "10:00:00"),
    shippingRequestedAt: mockDateTime(9, "13:25:00"),
    shippingScheduledAt: mockDateTime(8, "17:00:00"),
    shippingAddress: currentUser.shippingAddresses[2],
    shipmentBatchId: "shipment-batch-naeun-shipped-0705",
    courier: "한진택배",
    trackingNumber: "540012340019",
    shippedAt: mockDateTime(8, "17:08:00"),
  },
];

/**
 * 현재 로그인 사용자 외 고객의 관리자 물류 Mock입니다.
 * 로그인 사용자의 배치는 wonAuctions에서 실시간 파생해 이 목록과 합칩니다.
 */
export const adminShipmentBatches: AdminShipmentBatch[] = [
  {
    id: "shipment-batch-soyeon-0716",
    buyer: {
      userId: "user-park-soyeon",
      name: "박소연",
      phone: "010-7712-4208",
      address: "경기도 성남시 분당구 정자일로 45, 1102동 804호",
    },
    shippingAddress: {
      id: "address-soyeon-home",
      label: "기본 배송지",
      recipientName: "박소연",
      phone: "010-7712-4208",
      address: "경기도 성남시 분당구 정자일로 45, 1102동 804호",
      isDefault: true,
    },
    requestedAt: mockDateTime(0, "11:10:00"),
    scheduledAt: getNextShippingDispatchDate(mockDateTime(0, "11:10:00")),
    status: "packing",
    items: [
      {
        id: "shipment-item-soyeon-jacket",
        auctionId: "sale-herringbone-jacket-0715",
        title: "브라운 헤링본 울 재킷",
        description:
          "브라운 헤링본 울 재킷 여성 66 가슴 53cm 총장 69cm 안감 상태 A",
        thumbnailUrl:
          "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=800&q=85",
        imageUrls: [
          "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1400&q=90",
          "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1400&q=90",
        ],
        winningBid: 47000,
      },
      {
        id: "shipment-item-soyeon-knit",
        auctionId: "sale-polo-knit-soyeon-0714",
        title: "폴로 랄프로렌 울 니트 L",
        description:
          "폴로 랄프로렌 울 니트 L 가슴 55cm 총장 68cm 보풀 없음 상태 A+",
        thumbnailUrl:
          "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=800&q=85",
        imageUrls: [
          "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=1400&q=90",
          "https://images.unsplash.com/photo-1608234807905-4466023792f5?auto=format&fit=crop&w=1400&q=90",
        ],
        winningBid: 44000,
      },
      {
        id: "shipment-item-soyeon-blouse",
        auctionId: "sale-linen-blouse-soyeon-0713",
        title: "프랑스 자수 린넨 블라우스",
        description:
          "프랑스 자수 린넨 블라우스 여성 55~66 가슴 52cm 총장 64cm 상태 A",
        thumbnailUrl:
          "https://images.unsplash.com/photo-1564257577054-486c1b7d3f15?auto=format&fit=crop&w=800&q=85",
        imageUrls: [
          "https://images.unsplash.com/photo-1564257577054-486c1b7d3f15?auto=format&fit=crop&w=1400&q=90",
        ],
        winningBid: 25000,
      },
    ],
  },
  {
    id: "shipment-batch-junho-shipped-0715",
    buyer: {
      userId: "user-lee-junho",
      name: "이준호",
      phone: "010-9064-1182",
      address: "인천광역시 연수구 아트센터대로 160, 203동 1501호",
    },
    shippingAddress: {
      id: "address-junho-home",
      label: "기본 배송지",
      recipientName: "이준호",
      phone: "010-9064-1182",
      address: "인천광역시 연수구 아트센터대로 160, 203동 1501호",
      isDefault: true,
    },
    requestedAt: mockDateTime(2, "13:10:00"),
    scheduledAt: getNextShippingDispatchDate(mockDateTime(2, "13:10:00")),
    status: "shipped",
    courier: "한진택배",
    trackingNumber: "540012349877",
    shippedAt: mockDateTime(1, "16:48:00"),
    items: [
      {
        id: "shipment-item-junho-shirt",
        auctionId: "sale-polo-shirt-0714",
        title: "라코스테 클래식 피케 셔츠",
        description:
          "라코스테 클래식 피케 셔츠 남성 100 가슴 54cm 총장 70cm 상태 A",
        thumbnailUrl:
          "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=85",
        imageUrls: [
          "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=1400&q=90",
        ],
        winningBid: 32000,
      },
    ],
  },
];

export const paymentAccount: PaymentAccount = {
  bankName: "카카오뱅크",
  accountNumber: "3333-27-4819357",
  accountHolder: "다미네 구제 김소담",
};

export const adminSaleRecords: AdminSaleRecord[] = [
  {
    id: "record-burberry-0716-hyejin",
    auctionId: "sale-burberry-trench-0716",
    title: "버버리 체크 안감 트렌치코트",
    description:
      "버버리 체크 안감 트렌치코트 여성 66~77 가슴 57cm 총장 108cm 상태 굳",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=85",
    imageUrls: [
      "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=1400&q=90",
    ],
    soldAt: mockDateTime(0, "21:00:00"),
    winningBid: 68000,
    buyer: {
      userId: "user-kang-hyejin",
      name: "강혜진",
      phone: "010-3358-2219",
      address: "서울특별시 송파구 올림픽로 77, 505동 1102호",
    },
    paymentStatus: "pending",
    shippingStatus: "preparing",
    stage: "payment-pending",
  },
  {
    id: "record-wool-jacket-0711-misook",
    auctionId: "sale-wool-jacket-0711",
    title: "브라운 헤링본 울 재킷",
    description:
      "브라운 헤링본 울 재킷 여성 66 가슴 53cm 총장 69cm 안감 상태 A",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=800&q=85",
    imageUrls: [
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=1400&q=90",
    ],
    soldAt: mockDateTime(5, "21:00:00"),
    winningBid: 47000,
    buyer: {
      userId: "user-han-misook",
      name: "한미숙",
      phone: "010-5274-9031",
      address: "대전광역시 서구 둔산중로 96, 102동 702호",
    },
    paymentStatus: "paid",
    shippingStatus: "preparing",
    stage: "keep",
  },
  {
    id: "record-linen-dress-0710-jeonghee",
    auctionId: "sale-linen-dress-0710",
    title: "내추럴 린넨 셔츠 원피스",
    description:
      "내추럴 린넨 셔츠 원피스 여성 66 가슴 54cm 총장 112cm 상태 A+",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=800&q=85",
    imageUrls: [
      "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=1400&q=90",
    ],
    soldAt: mockDateTime(6, "21:00:00"),
    winningBid: 41000,
    buyer: {
      userId: "user-oh-jeonghee",
      name: "오정희",
      phone: "010-8042-3771",
      address: "광주광역시 북구 설죽로 201, 301동 408호",
    },
    paymentStatus: "paid",
    shippingStatus: "ready",
    stage: "shipping-requested",
  },
  {
    id: "record-levis-0715-naeun",
    auctionId: "sale-levis-501-0715",
    title: "빈티지 리바이스 501 데님",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=800&q=85",
    soldAt: mockDateTime(1, "21:00:00"),
    winningBid: 59000,
    buyer: {
      userId: currentUser.id,
      name: currentUser.name,
      phone: currentUser.phone,
      address: currentUser.address,
    },
    paymentStatus: "paid",
    shippingStatus: "ready",
    stage: "payment-pending",
  },
  {
    id: "record-scarf-0714-naeun",
    auctionId: "sale-silk-scarf-0714",
    title: "에르메스 스타일 실크 스카프",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=800&q=85",
    soldAt: mockDateTime(2, "21:00:00"),
    winningBid: 28000,
    buyer: {
      userId: currentUser.id,
      name: currentUser.name,
      phone: currentUser.phone,
      address: currentUser.address,
    },
    paymentStatus: "pending",
    shippingStatus: "preparing",
    stage: "payment-pending",
  },
  {
    id: "record-cardigan-0713-naeun",
    auctionId: "sale-cashmere-cardigan-0713",
    title: "캐시미어 혼방 라운드 카디건",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1608234807905-4466023792f5?auto=format&fit=crop&w=800&q=85",
    soldAt: mockDateTime(3, "21:00:00"),
    winningBid: 36000,
    buyer: {
      userId: currentUser.id,
      name: currentUser.name,
      phone: currentUser.phone,
      address: currentUser.address,
    },
    paymentStatus: "paid",
    shippingStatus: "shipped",
    stage: "keep",
  },
  {
    id: "record-padding-0712-naeun",
    auctionId: "sale-northface-padding-0712",
    title: "노스페이스 구스 롱패딩",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1544022613-e87ca75a784a?auto=format&fit=crop&w=800&q=85",
    soldAt: mockDateTime(4, "21:00:00"),
    winningBid: 72000,
    buyer: {
      userId: currentUser.id,
      name: currentUser.name,
      phone: currentUser.phone,
      address: currentUser.address,
    },
    paymentStatus: "paid",
    shippingStatus: "preparing",
    stage: "keep",
  },
  {
    id: "record-jacket-0715-soyeon",
    auctionId: "sale-herringbone-jacket-0715",
    title: "브라운 헤링본 울 재킷",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=800&q=85",
    soldAt: mockDateTime(1, "21:00:00"),
    winningBid: 47000,
    buyer: {
      userId: "user-park-soyeon",
      name: "박소연",
      phone: "010-7712-4208",
      address: "경기도 성남시 분당구 정자일로 45, 1102동 804호",
    },
    paymentStatus: "pending",
    shippingStatus: "preparing",
    stage: "payment-pending",
  },
  {
    id: "record-polo-0714-junho",
    auctionId: "sale-polo-shirt-0714",
    title: "라코스테 클래식 피케 셔츠",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=85",
    soldAt: mockDateTime(2, "21:00:00"),
    winningBid: 32000,
    buyer: {
      userId: "user-lee-junho",
      name: "이준호",
      phone: "010-9064-1182",
      address: "인천광역시 연수구 센트럴로 160, 203동 1501호",
    },
    paymentStatus: "paid",
    shippingStatus: "ready",
    stage: "shipping-requested",
  },
  {
    id: "record-dress-0713-yujin",
    auctionId: "sale-linen-dress-0713",
    title: "내추럴 린넨 셔츠 원피스",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=800&q=85",
    soldAt: mockDateTime(3, "21:00:00"),
    winningBid: 41000,
    buyer: {
      userId: "user-choi-yujin",
      name: "최유진",
      phone: "010-3381-6420",
      address: "부산광역시 수영구 광안해변로 219, 507호",
    },
    paymentStatus: "paid",
    shippingStatus: "shipped",
    stage: "shipped",
  },
];

export const adminCustomerChats: AdminCustomerChatThread[] = [
  {
    id: "admin-chat-kim-naeun",
    userId: currentUser.id,
    customerName: currentUser.name,
    online: true,
    lastMessage: "두 벌을 함께 보내 주세요.",
    lastMessageAt: mockDateTime(0, "10:22:00"),
    messages: [
      {
        id: "admin-chat-naeun-1",
        sender: "customer",
        text: "디올 재킷과 막스마라 스커트를 함께 보내 주세요.",
        sentAt: mockDateTime(0, "10:21:00"),
      },
      {
        id: "admin-chat-naeun-2",
        sender: "admin",
        text: "네, 합배송 접수 확인했습니다. 송장 등록 후 알려드릴게요.",
        sentAt: mockDateTime(0, "10:22:00"),
      },
    ],
  },
  {
    id: "admin-chat-park-soyeon",
    userId: "user-park-soyeon",
    customerName: "박소연",
    online: true,
    lastMessage: "입금 확인 부탁드립니다.",
    lastMessageAt: mockDateTime(0, "11:32:00"),
    messages: [
      {
        id: "admin-chat-soyeon-1",
        sender: "customer",
        text: "오늘 오전에 입금했습니다. 확인 부탁드립니다.",
        sentAt: mockDateTime(0, "11:32:00"),
      },
    ],
  },
  {
    id: "admin-chat-lee-junho",
    userId: "user-lee-junho",
    customerName: "이준호",
    online: false,
    lastMessage: "한진택배로 발송되었습니다.",
    lastMessageAt: mockDateTime(1, "16:50:00"),
    messages: [
      {
        id: "admin-chat-junho-1",
        sender: "admin",
        text: "한진택배로 발송되었습니다. 배송 현황에서 송장을 확인해 주세요.",
        sentAt: mockDateTime(1, "16:50:00"),
      },
    ],
  },
];

export const chatThreads: ChatThread[] = [
  {
    id: "chat-auction-host",
    name: "다미네 구제 운영자",
    initials: "다미네",
    accent: "#e98978",
    lastMessage: "트렌치코트는 여성 66~77 사이즈에 잘 맞아요.",
    lastMessageAt: "2026-07-16T18:12:00+09:00",
    unread: 2,
    online: true,
    messages: [
      {
        id: "host-message-1",
        sender: "admin",
        text: "나은님, 오늘 구제 의류 경매에도 와주셔서 반가워요!",
        sentAt: "2026-07-16T18:02:00+09:00",
      },
      {
        id: "host-message-2",
        sender: "me",
        text: "트렌치코트가 평소 66반을 입는 사람에게도 맞을까요?",
        sentAt: "2026-07-16T18:07:00+09:00",
      },
      {
        id: "host-message-3",
        sender: "admin",
        text: "네, 가슴 단면이 57cm라 66반도 여유 있게 맞습니다.",
        sentAt: "2026-07-16T18:09:00+09:00",
      },
      {
        id: "host-message-4",
        sender: "admin",
        text: "트렌치코트는 여성 66~77 사이즈에 잘 맞아요.",
        sentAt: "2026-07-16T18:12:00+09:00",
      },
    ],
  },
  {
    id: "chat-delivery",
    name: "다미네 구제 배송팀",
    initials: "배송",
    accent: "#7faeb8",
    lastMessage: "내일 오후 출고 후 송장 번호를 보내드릴게요.",
    lastMessageAt: "2026-07-16T16:45:00+09:00",
    unread: 0,
    online: true,
    messages: [
      {
        id: "delivery-message-1",
        sender: "admin",
        text: "리바이스 데님 낙찰 및 입금이 확인되었습니다.",
        sentAt: "2026-07-16T16:31:00+09:00",
      },
      {
        id: "delivery-message-2",
        sender: "me",
        text: "주소는 내 정보에 저장한 곳으로 부탁드려요.",
        sentAt: "2026-07-16T16:38:00+09:00",
      },
      {
        id: "delivery-message-3",
        sender: "admin",
        text: "확인했어요. 내일 오후 출고 후 송장 번호를 보내드릴게요.",
        sentAt: "2026-07-16T16:45:00+09:00",
      },
    ],
  },
  {
    id: "chat-community-guide",
    name: "다미네 구제 이용 안내",
    initials: "안내",
    accent: "#d6a75f",
    lastMessage: "새 상품은 매일 오전 9시에 공개됩니다.",
    lastMessageAt: "2026-07-14T09:05:00+09:00",
    unread: 1,
    online: false,
    messages: [
      {
        id: "guide-message-1",
        sender: "admin",
        text: "50대를 위한 다미네 구제 의류 경매에 오신 것을 환영합니다.",
        sentAt: "2026-07-12T10:00:00+09:00",
      },
      {
        id: "guide-message-2",
        sender: "me",
        text: "경매 상품은 보통 언제 새로 올라오나요?",
        sentAt: "2026-07-14T09:01:00+09:00",
      },
      {
        id: "guide-message-3",
        sender: "admin",
        text: "새 상품은 매일 오전 9시에 공개됩니다.",
        sentAt: "2026-07-14T09:05:00+09:00",
      },
    ],
  },
];
