# ChatTask Desktop

React、TypeScript、Tauriで作成したデスクトップ向けタスク管理アプリです。アプリ本体は `chattask-desktop` ディレクトリにあります。

## 必要な環境

macOSでビルドする場合は、次のツールが必要です。

- Node.js、npm
- Rust、Cargo
- Xcode Command Line Tools

未導入の場合は、Xcode Command Line Toolsをインストールします。

```bash
xcode-select --install
```

Rustは[rustup](https://rustup.rs/)からインストールできます。インストール後、新しいターミナルを開くか、次を実行してCargoを有効にします。

```bash
source "$HOME/.cargo/env"
```

## 初回セットアップ

リポジトリのルートから、アプリのディレクトリへ移動して依存パッケージをインストールします。

```bash
cd chattask-desktop
source "$HOME/.cargo/env"
npm ci
```

`npm ci` はコミット済みの `package-lock.json` に記録されたバージョンを使用します。依存関係を変更する場合は `npm install` を使用してください。

## 開発モードで起動

```bash
cd chattask-desktop
source "$HOME/.cargo/env"
npm run tauri dev
```

ソースコードを変更すると、開発中のアプリへ反映されます。

## macOSアプリをビルド

```bash
cd chattask-desktop
source "$HOME/.cargo/env"
npm run tauri build -- --bundles app
```

TauriがフロントエンドのTypeScript・ViteビルドとRustのリリースビルドを順番に実行します。そのため、事前に `npm run build` を実行する必要はありません。

ビルドが完了すると、通常は次の場所にアプリが生成されます。

```text
chattask-desktop/src-tauri/target/release/bundle/macos/ChatTask.app
```

Finderから起動するか、ターミナルから次のように開けます。

```bash
open src-tauri/target/release/bundle/macos/ChatTask.app
```

## 更新版アプリをビルド

ソースコードを更新したあと、既に使用しているChatTaskを新しい版へ置き換える場合は、次の手順でビルドします。

### 1. 使用中のデータをバックアップ

ChatTaskの「設定」→「データ管理・バックアップ」から、現在のデータをバックアップしておきます。

通常、アプリ本体を置き換えても保存データは削除されませんが、更新前にバックアップすることを推奨します。

### 2. ソースコードと依存関係を更新

リポジトリのルートで最新のソースコードを取得し、依存関係を `package-lock.json` の内容に合わせます。

```bash
git pull
cd chattask-desktop
source "$HOME/.cargo/env"
npm ci
```

ローカルに未コミットの変更がある場合は、内容を確認してコミットまたは退避してから `git pull` を実行してください。

### 3. アプリのバージョンを更新

配布する更新版では、`chattask-desktop/src-tauri/tauri.conf.json` の `version` を以前より大きい値に変更します。

```json
{
  "version": "0.1.1"
}
```

バージョンには `メジャー.マイナー.パッチ` 形式を使用します。

- 不具合修正：`0.1.0` → `0.1.1`
- 後方互換性のある機能追加：`0.1.0` → `0.2.0`
- 大きな仕様変更：`0.1.0` → `1.0.0`

Tauriでは `tauri.conf.json` の `version` が生成されるアプリのバージョンとして使用されます。

### 4. 更新版をビルド

`chattask-desktop` ディレクトリで実行します。

```bash
npm run tauri build -- --bundles app
```

ビルドが成功したら、新しいアプリを一度起動して、主要な画面とデータの読み込みを確認します。

```bash
open src-tauri/target/release/bundle/macos/ChatTask.app
```

### 5. 使用中のアプリを置き換え

1. 起動中のChatTaskを終了します。
2. `chattask-desktop/src-tauri/target/release/bundle/macos/ChatTask.app` をFinderで開きます。
3. 新しい `ChatTask.app` を「アプリケーション」フォルダへコピーします。
4. 既存ファイルの置き換えを確認されたら「置き換える」を選択します。
5. 更新後のChatTaskを起動し、データとバージョンを確認します。

アプリ本体の置き換えではなく、他の利用者へ更新版を配布する場合は、DMGも生成できます。

```bash
npm run tauri build -- --bundles app,dmg
```

DMGは通常、次の場所に生成されます。

```text
chattask-desktop/src-tauri/target/release/bundle/dmg/
```

macOSで他の利用者へ正式に配布する場合は、Apple Developerの証明書によるコード署名と公証が別途必要です。現在の構成はアプリ内からの自動更新には対応していないため、更新版は新しいアプリまたはDMGを使って手動で置き換えます。

## フロントエンドだけを確認

デスクトップアプリを生成せず、React部分だけをビルドする場合は次を実行します。

```bash
cd chattask-desktop
npm run build
```

生成物は `chattask-desktop/dist` に出力されます。

## ビルドをやり直す場合

通常は同じビルドコマンドを再実行するだけで問題ありません。

依存関係に問題がある場合は、`chattask-desktop` ディレクトリで次を実行してから再度ビルドしてください。

```bash
npm ci
npm run tauri build -- --bundles app
```

アプリの機能やソース構成については、[chattask-desktop/README.md](./chattask-desktop/README.md)を参照してください。
