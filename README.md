# ChatTask Desktop

React、TypeScript、Tauriで作成したデスクトップ向けタスク管理アプリです。アプリ本体は `chattask-desktop` ディレクトリにあります。

Windowsでのセットアップと起動は [Windows向け手順](docs/windows-setup.md) を参照してください。

## macOSで必要な環境

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

## macOSでの初回セットアップ

リポジトリのルートから、アプリのディレクトリへ移動して依存パッケージをインストールします。

```bash
cd chattask-desktop
source "$HOME/.cargo/env"
npm ci
```

`npm ci` はコミット済みの `package-lock.json` に記録されたバージョンを使用します。依存関係を変更する場合は `npm install` を使用してください。

## テスト

依存パッケージのインストール後は、リポジトリのルートからそのまま実行できます。

```bash
npm test
```

テストと本番ビルドをまとめて確認する場合は、次を実行します。

```bash
npm run check
```

## macOSで開発モードを起動

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

## GitHubでリリースの下書きを自動作成

mainへのpush（Pull Requestのマージを含む）で「ChatTask release draft」が自動実行されます。`tauri.conf.json` のバージョンが未使用なら、テスト・macOS版のビルド・DMGの添付・変更履歴の生成・リリース下書きの作成まで自動で進みます。公開は手動です。同じバージョンのリリース（下書きを含む）またはタグが既にある場合は正常終了でスキップし、ビルドは行いません。

### 初回の設定

1. `.github/workflows/chattask-release.yml`、`.github/scripts/`、`.github/release-notes.md` を含む変更をGitHubのmainへ取り込みます。この取り込み自体でもバージョン確認が実行され、未使用なら下書きを作成します。
2. リポジトリの「Actions」でGitHub Actionsが有効になっていることを確認します。

リリース作成にはGitHubが発行する `GITHUB_TOKEN` を使用します。個人用アクセストークンの登録は不要です。下書きを含む重複確認とリリース作成のジョブに `contents: write` を付与し、依存関係のインストール・ビルドのジョブは読み取り権限で実行します。組織のポリシーでActionsの実行や書き込みが制限されている場合は、管理者による設定が必要です。

### 配布するたびの操作

1. 配布する変更とともに、`chattask-desktop/src-tauri/tauri.conf.json` の `version` を `0.1.1` など新しい未使用の番号へ更新し、mainへpushまたはマージします。バージョン番号自体の更新は手動です。
2. 「Actions」→「ChatTask release draft」で自動実行の進捗を確認します。毎回「Run workflow」を押す必要はありません。
3. 成功すると「Releases」に `ChatTask v0.1.0` のような下書きが作成され、Apple Silicon・Intel共通のDMGと `SHA256SUMS.txt` が添付されます。
4. DMGをダウンロードして動作確認し、下書きの変更内容・データ互換性を補足します。「Publish release」で正式版として公開し、必要に応じて「Set as the latest release」を選択します。

下書きの間はアプリの「更新を確認」の対象になりません。リポジトリが公開されていて、正式リリースを公開した後に利用者が取得できます。初回の `0.1.0` は、同じ `0.1.0` を使用しているアプリには更新として案内されません。

バージョン番号は `tauri.conf.json` を正とし、タグはその値に `v` を付けて生成します。ビルド元は実行開始時のコミットに固定します。既存のリリース（下書きを含む）やタグと番号が重なる場合は作成をスキップし、過去の配布ファイルを上書きしません。同じ番号の下書きを作成した後のコード変更も、その下書きには反映されません。新たな配布版には新しい番号を指定してください。

テスト・ビルド失敗時は、修正をmainへ反映すると同じ未使用バージョンで再度実行されます。「Actions」→「ChatTask release draft」→「Run workflow」からの手動実行も残しています（このボタンの表示にはワークフローがデフォルトブランチに存在する必要があります）。APIへの接続失敗や権限エラーはスキップ扱いにせず失敗として表示します。下書き作成後に添付処理などで失敗した場合は未完成の下書きを公開せず、Actionsの成果物から不足分を手動添付するか、新しいバージョンで再実行してください。

### macOSの署名について

現状は追加の証明書登録なしで動かせるアドホック署名を使用します。Apple Developer IDによる署名・公証は行わないため、ダウンロードしたアプリがmacOSで警告・起動制限の対象になる場合があります。一般向け配布でこれを解消するには、Apple Developerの証明書・公証用認証情報をGitHub Secretsへ登録してワークフローを拡張する必要があります。

Windows・Linux版の生成、アプリ側の自動インストール・自動再起動はこのワークフローの対象外です。

参考：[TauriのGitHub Actions配布ガイド](https://v2.tauri.app/distribute/pipelines/github/)、[macOS署名・公証](https://v2.tauri.app/distribute/sign/macos/)。

### macOSでダウンロードしたChatTaskを開けない場合

現在の配布版はAppleの公証を受けていないため、DMGから`ChatTask.app`を「アプリケーション」フォルダへコピーした後、「開発元を確認できない」などの警告で起動が止まる場合があります。まず、ダウンロードしたアプリを一度開き、macOSの「システム設定」→「プライバシーとセキュリティ」→「このまま開く」で許可してください。[Appleの案内](https://support.apple.com/ja-jp/102445)

ターミナルで対処する場合は、**このリポジトリのGitHub Releasesから取得したDMGであることを確認**してください。同じリリースのDMGと`SHA256SUMS.txt`を両方「ダウンロード」フォルダに置き、まず配布ファイルのチェックサムを照合します。

```bash
cd "$HOME/Downloads"
shasum -a 256 -c SHA256SUMS.txt
```

`OK`が表示された場合に限り、DMGからコピーしたアプリに対して次を実行します。`codesign`が失敗した場合は後続のコマンドを実行しません。アドホック署名では開発元の本人確認はできません。

```bash
codesign --verify --deep --strict "/Applications/ChatTask.app" &&
xattr -dr com.apple.quarantine "/Applications/ChatTask.app" &&
open "/Applications/ChatTask.app"
```

`xattr`は**指定したChatTask.appだけ**のダウンロード時の隔離属性を取り除きます。その版に対するmacOSの初回確認を省く操作なので、入手元やチェックサムを確認できない場合は実行しないでください。「コンピュータが破損する」「アプリが破損している」などの警告には使用せず、配布ファイルを確認してください。新しい版へ置き換えた後は再度必要になることがあります。恒久的に警告をなくすには、配布版のDeveloper ID署名とAppleの公証が必要です。Mac全体のGatekeeperは無効化しません。

## 更新版アプリをビルド

アプリの「設定」→「設定を開く」→「サポート」で、現在のバージョンと「更新を確認」を利用できます。
更新情報は `Ryoran-ran/tauri-ChatTask` の GitHub Releases から、ボタンを押したときだけ取得します。
新版がある場合はバージョン・公開日・変更内容を表示し、既定のブラウザーでダウンロードページを開きます。
この段階では自動インストールや自動再起動は行いません。更新前に完全バックアップを作成し、下記の手順でアプリを置き換えてください。

配布者は、`v0.1.1` のようなバージョンタグで正式リリースを作成し、変更内容とビルド済みのアプリ／DMGを添付して公開してください。
更新確認は認証なしで取得できる公開リリースが対象です。下書き・プレリリースは対象外です。
リリース未公開または非公開リポジトリの場合は、更新情報を取得できない旨を表示します。
GitHubで「最新」に指定するリリースと、ビルドしたアプリのバージョン・タグを一致させてください。
バージョン表示はデスクトップ版では実行中のアプリから取得し、ブラウザーでのプレビューでは `tauri.conf.json` の値を使います。

ソースコードを更新したあと、既に使用しているChatTaskを新しい版へ置き換える場合は、次の手順でビルドします。

### 1. 使用中のデータをバックアップ

ChatTaskの「設定」→「データ管理・バックアップ」から、現在の完全バックアップを作成しておきます。完全バックアップには、タスク・プロジェクト、添付ファイル、プロフィール画像、ChatTaskが管理するローカルツールが含まれます。

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
