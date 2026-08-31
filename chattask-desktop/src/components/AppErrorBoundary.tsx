import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

interface State { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ChatTaskの描画に失敗しました。", error, info.componentStack);
    void invoke("report_frontend_error", { message: `${error.stack || error.message}\n${info.componentStack}` }).catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-error-screen"><section><h1>ChatTaskを表示できませんでした</h1><p>データは削除されていません。アプリを再起動しても直らない場合は、下記の内容をお知らせください。</p><pre>{this.state.error.stack || this.state.error.message}</pre><button onClick={() => window.location.reload()}>再読み込み</button></section></main>;
  }
}
