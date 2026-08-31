# ChatTask Desktop

既存のバニラJavaScript版をReact + TypeScript + Tauriへ移植したデスクトップ版です。

## 開発

```bash
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

## ビルド

```bash
npm run build
npm run tauri build -- --bundles app
```

## ソース構成

```text
src/
├── components/
│   ├── Header.tsx              ヘッダーと入出力操作
│   ├── Sidebar.tsx             検索・フィルター・タスク一覧
│   ├── TaskCard.tsx            タスクカード
│   ├── TaskDetail.tsx          タスク詳細・日別計画・メモ
│   ├── TodayModal.tsx          今日のページ
│   ├── DocumentsModal.tsx      タスクドキュメント
│   ├── TagSettingsModal.tsx    タグ設定
│   └── Modal.tsx               共通モーダル
├── data/constants.ts           ステータス・優先度などの定義
├── services/storage.ts         保存・旧データ正規化・JSON移行
├── types.ts                    データ型
├── utils.ts                    日付・URL・予定期間処理
├── App.tsx                     アプリ状態と画面の接続
└── App.css                     共通スタイル
```

## Web版からのデータ移行

1. Web版の設定から「データをエクスポート」を実行します。
2. デスクトップ版の「読み込み」からJSONファイルを選択します。
3. タスク、タグ、履歴、日別メモ、休暇データが読み込まれます。

現在は移行の安全性を優先して、保存先に従来と同じlocalStorage形式を使用しています。次の段階で `services/storage.ts` をSQLite実装へ差し替えます。

## 移植済み機能

- タスク、親子タスク、ステータス、優先度、案件タグ
- 検索、一覧フィルター、カード密度・一覧幅・折りたたみ
- 複数予定日・予定期間、日別計画、達成チェック、持ち越し
- 定期タスク、各回の実施・スキップ・別日移動・移動理由
- 今日のページ、日次メモ、休暇・祝日・土日判定
- 関連リンク、Markdownメモ、変更履歴
- 複数ドキュメントとNotion風ブロックエディター
- ガントチャート、日次・週次・月次・任意期間のMarkdownまとめ
- ヘルプ、設定状態の保存、Web版JSONの読み込み・書き出し

SQLite、添付ファイル、ユーザープロフィールは、Web版に存在しない次段階の機能として含めていません。

移植対象と実装状況は [MIGRATION_CHECKLIST.md](./MIGRATION_CHECKLIST.md) を参照してください。
