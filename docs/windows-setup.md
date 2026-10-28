# WindowsでChatTaskを起動する

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

ビルド後、`src-tauri\target\release\bundle\nsis\` に生成された `*-setup.exe` を実行してインストールし、スタートメニューから ChatTask を起動します。このリポジトリの GitHub リリース下書きは macOS 版のみを作成するため、Windows 版は Windows 上でビルドしてください。
