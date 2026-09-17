import { useState, type RefObject } from "react";
import type { WorkspaceMode } from "../types";
import { Modal } from "./Modal";

type Category = "general" | "calendar" | "tasks" | "display" | "tools" | "data" | "support";

interface Props {
  workspaceMode: WorkspaceMode;
  hideRecurring: boolean;
  openTodayOnStartup: boolean;
  importRef: RefObject<HTMLInputElement | null>;
  onHideRecurring: (value: boolean) => void;
  onOpenTodayOnStartup: (value: boolean) => void;
  onProfile: () => void;
  onWorkspaceMode: () => void;
  onWeekendSettings: () => void;
  onNonWorking: () => void;
  onTags: () => void;
  onTemplates: () => void;
  onTools: () => void;
  onDataManagement: () => void;
  onExport: () => void;
  onHelp: () => void;
  onClose: () => void;
}

const CATEGORIES: { id: Category; icon: string; label: string; description: string }[] = [
  { id: "general", icon: "◎", label: "一般", description: "プロフィール・利用モード" },
  { id: "calendar", icon: "▦", label: "休み・予定", description: "曜日・休暇・祝日" },
  { id: "tasks", icon: "✓", label: "タスク", description: "案件タグ・テンプレート" },
  { id: "display", icon: "◫", label: "表示", description: "一覧・起動時の表示" },
  { id: "tools", icon: "◇", label: "連携・ツール", description: "ローカルツール" },
  { id: "data", icon: "▤", label: "データ管理", description: "バックアップ・入出力" },
  { id: "support", icon: "?", label: "サポート", description: "使い方を確認" },
];

export function SettingsCenterModal(props: Props) {
  const [category, setCategory] = useState<Category>("general");
  const openChild = (action: () => void) => action();
  const importData = () => {
    if (props.importRef.current) {
      props.importRef.current.value = "";
      props.importRef.current.click();
    }
  };
  return <Modal title="設定" onClose={props.onClose} wide>
    <div className="settings-center">
      <aside><header><strong>ChatTask設定</strong><small>{props.workspaceMode === "work" ? "仕事用モード" : "日常用モード"}</small></header><nav aria-label="設定カテゴリー">{CATEGORIES.map((item) => <button type="button" key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}><i aria-hidden="true">{item.icon}</i><span><b>{item.label}</b><small>{item.description}</small></span></button>)}</nav></aside>
      <section className="settings-center-content">
        {category === "general" && <><header><small>GENERAL</small><h3>一般設定</h3><p>利用者情報と、この端末で使用するモードを設定します。</p></header><div className="settings-center-list"><button type="button" onClick={() => openChild(props.onProfile)}><i>◎</i><span><b>プロフィール設定</b><small>表示名とプロフィール画像を変更します</small></span><em>開く</em></button><button type="button" onClick={() => openChild(props.onWorkspaceMode)}><i>{props.workspaceMode === "work" ? "▣" : "⌂"}</i><span><b>利用モード</b><small>現在：{props.workspaceMode === "work" ? "仕事用" : "日常用"}　登録済みデータは共通です</small></span><em>変更</em></button></div></>}
        {category === "calendar" && <><header><small>CALENDAR</small><h3>休み・予定</h3><p>仕事用・日常用で共通の休み設定です。</p></header><div className="settings-center-list"><button type="button" onClick={() => openChild(props.onWeekendSettings)}><i>曜</i><span><b>休みの曜日設定</b><small>適用開始日ごとに、休みとする曜日を管理します</small></span><em>開く</em></button><button type="button" onClick={() => openChild(props.onNonWorking)}><i>休</i><span><b>休暇・祝日設定</b><small>個別の休暇、祝日、非稼働日を登録します</small></span><em>開く</em></button></div><div className="settings-center-note"><strong>両方のモードで使用できます</strong><span>日常用モードでは休みの日も予定を登録でき、日付の補足情報として表示されます。</span></div></>}
        {category === "tasks" && <><header><small>TASKS</small><h3>タスク設定</h3><p>タスクの分類と再利用に関する設定です。</p></header><div className="settings-center-list"><button type="button" onClick={() => openChild(props.onTags)}><i>#</i><span><b>案件タグ設定</b><small>タスクや習慣を分類するタグを管理します</small></span><em>開く</em></button><button type="button" onClick={() => openChild(props.onTemplates)}><i>複</i><span><b>タスクテンプレート管理</b><small>繰り返し作成するタスクのひな形を管理します</small></span><em>開く</em></button></div></>}
        {category === "display" && <><header><small>DISPLAY</small><h3>表示設定</h3><p>一覧と起動時の表示を調整します。</p></header><div className="settings-center-toggles"><label><span><b>定期タスクを一覧で非表示</b><small>必要な日には「今日」の画面へ表示されます</small></span><input type="checkbox" checked={props.hideRecurring} onChange={(event) => props.onHideRecurring(event.target.checked)} /></label><label><span><b>起動時に「今日」を開く</b><small>アプリを開いたとき、今日の予定を最初に表示します</small></span><input type="checkbox" checked={props.openTodayOnStartup} onChange={(event) => props.onOpenTodayOnStartup(event.target.checked)} /></label></div></>}
        {category === "tools" && <><header><small>TOOLS</small><h3>連携・ツール</h3><p>作業で利用するローカルツールを管理します。</p></header><div className="settings-center-list"><button type="button" onClick={() => openChild(props.onTools)}><i>◇</i><span><b>ツール</b><small>コマンドや保存場所などのツール設定を開きます</small></span><em>開く</em></button></div></>}
        {category === "data" && <><header><small>DATA</small><h3>データ管理</h3><p>使用頻度の低いバックアップと移行操作をまとめています。</p></header><div className="settings-center-list"><button type="button" onClick={() => openChild(props.onDataManagement)}><i>保</i><span><b>データ管理・バックアップ</b><small>保存状況の確認とバックアップの管理を行います</small></span><em>開く</em></button><button type="button" onClick={() => openChild(props.onExport)}><i>出</i><span><b>データをエクスポート</b><small>現在のデータをJSONファイルに書き出します</small></span><em>実行</em></button><button type="button" onClick={importData}><i>入</i><span><b>データをインポート</b><small>JSONファイルからデータを読み込みます</small></span><em>選択</em></button></div><div className="settings-center-warning"><strong>データを読み込む前に</strong><span>現在のデータをエクスポートしておくことをおすすめします。</span></div></>}
        {category === "support" && <><header><small>SUPPORT</small><h3>サポート</h3><p>操作方法や各機能の考え方を確認できます。</p></header><div className="settings-center-list"><button type="button" onClick={() => openChild(props.onHelp)}><i>?</i><span><b>ヘルプ</b><small>ChatTaskの使い方を確認します</small></span><em>開く</em></button></div></>}
      </section>
    </div>
  </Modal>;
}
