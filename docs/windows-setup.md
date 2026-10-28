# WindowsでChatTaskを起動する

## リリース版をインストール

[GitHub Releases](https://github.com/Ryoran-ran/tauri-ChatTask/releases) から Windows 対応版（v0.3.1 以降）の公開済みリリースを開き、Assets の `*-setup.exe` をダウンロードして実行します。インストール後はスタートメニューから ChatTask を起動できます。インストーラーは x64 版です。コード署名は設定されていないため、Windows に発行元の警告が表示される場合があります。

配布ファイルを確認する場合は、同じリリースの `SHA256SUMS-Windows.txt` もダウンロードし、PowerShell で `Get-FileHash .\*-setup.exe -Algorithm SHA256` を実行して表示された値と照合してください。

更新する場合は、ChatTask の「設定」→「データ管理・バックアップ」で完全バックアップを作成し、アプリを終了してから新しい `*-setup.exe` を実行してください。

以下はソースコードから開発・ビルドする場合の手順です。

## 必要な環境

- [Node.js（LTS）](https://nodejs.org/) と npm
- [Rust（rustup）](https://www.rust-lang.org/tools/install) の MSVC ツールチェーン
- Microsoft C++ Build Tools（「C++ によるデスクトップ開発」を選択）
- Microsoft Edge WebView2（Windows 10/11 には通常インストール済み）

インストール方法は [Tauri の Windows 向け前提条件](https://v2.tauri.app/start/prerequisites/#windows) を参照してください。インストール後は PowerShell を開き直します。

## 初回セットアップ

リポジトリのルートで PowerShell を開き、依存パッケージをインストールします。

```powershell
Set-Location .\chattask-desktop
npm.cmd ci
```

`npm.cmd` は PowerShell のスクリプト実行ポリシーに影響されずに npm を起動できます。

## 開発モードで起動

`chattask-desktop` ディレクトリで次を実行します。終了するには PowerShell で `Ctrl+C` を押します。

```powershell
npm.cmd run tauri dev
```

## インストーラーを作成して起動

`chattask-desktop` ディレクトリで次を実行します。

```powershell
npm.cmd run tauri build -- --bundles nsis
```

ビルド後、`src-tauri\target\release\bundle\nsis\` に生成された `*-setup.exe` を実行してインストールし、スタートメニューから ChatTask を起動します。リリース下書きには Windows 版も添付されます。公開前にインストールと起動を確認してください。

現在、添付ファイルをファイルとしてクリップボードへコピーする操作と、ローカルツールのフォルダ・HTML選択およびChrome起動はmacOS版のみ対応しています。
