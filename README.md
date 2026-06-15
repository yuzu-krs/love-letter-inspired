# love-letter-inspired

リアルタイム対戦できる、ラブレター風のブラウザカードゲームです。カード名と世界観は独自のものにして、手札推理、護り、交換、脱落、山札切れ判定のある短時間ゲームとして実装しています。

## 起動

```bash
npm install
npm run prisma:migrate
npm start
```

起動後、ブラウザで `http://localhost:3000` を開きます。ひとりが部屋を作り、表示された4桁コードを他のプレイヤーに共有してください。
入口の部屋一覧から募集中の部屋を選んで参加できます。部屋一覧はリアルタイム更新されるので、手動更新は不要です。合言葉を入れて部屋を作ると鍵付き部屋になり、参加時にも同じ合言葉が必要です。

## ゲーム概要

- 2〜4人対応です。
- 部屋主がゲームを開始します。
- 部屋主は開始前に1手の持ち時間を `なし / 30 / 60 / 120 / 180 秒` から選べます。
- 手番では1枚引き、2枚の手札から1枚を出します。
- 最後まで残るか、山札が尽きた時点で一番強い手札を持っている人がラウンド勝者です。
- 2人戦は4点、3〜4人戦は3点でゲーム勝利です。
- 対戦中もルールブックでカード効果と枚数構成を確認できます。
- 占い結果はログではなく、自分だけに見える秘密メモとして表示されます。
- Googleログインしたユーザーは通算成績（ゲーム勝利、ラウンド勝利、プレイ数、カード使用数）が保存されます。
- ロビーにランキング（上位10人）が表示されます。
- 効果音は画面右上の `音 ON/OFF` で切り替えられます。
- 部屋一覧では、募集中/対戦中、参加人数、鍵付きかどうかを確認できます。
- カード使用、脱落、ラウンド/ゲーム勝者は大きな演出レイヤーで表示されます。
- 演出レイヤーは自動で順に進み、クリックまたはEnter/Escでスキップできます。
- 2番の占い、3番の決闘、5番の捨て札、4番の護りも専用ポップアップでカード付き表示されます。
- View Transitions、ネイティブ `dialog` のコマンドパレット、Web Share、ハプティクス、container queries によるモダンUI強化を入れています。
- 対応ブラウザではPWAとしてインストールでき、Service Workerで画面とカード画像をキャッシュします。

## Googleログイン設定（Auth.js）

`.env` を作成して以下を設定してください。

```bash
DATABASE_URL="file:./dev.db"
AUTH_SECRET="openssl rand -base64 32 で生成した値"
AUTH_GOOGLE_ID="Google OAuth client id"
AUTH_GOOGLE_SECRET="Google OAuth client secret"
```

Google OAuth の承認済みリダイレクトURIは以下です。

- `http://localhost:3000/auth/callback/google`

## 実装メモ

- サーバー: Express + Socket.IO
- 認証: Auth.js (`@auth/express`) + Google Provider
- DB: SQLite + Prisma (Prisma Adapter / Prisma Client / Prisma Migrate)
- クライアント: Vanilla HTML/CSS/JavaScript
- 状態管理: サーバーを正本にして、各プレイヤーへ自分の手札だけを配信
- カード画像: `assets/cards/01-scout.png` 〜 `assets/cards/08-sealed-letter.png`

## チェック

```bash
npm run check
npm run prisma:generate
npm audit --audit-level=moderate
```

サーバーは基本的なセキュリティヘッダー、Socket.IO操作の簡易レート制限、暗号学的乱数によるシャッフルと部屋コード生成を使っています。鍵付き部屋の合言葉はソルト付きハッシュとして保持し、部屋一覧には鍵付きかどうかだけを表示します。
