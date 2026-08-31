import { useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { STATUS_LABELS } from "../data/constants";
import type { ActivityEvent, Goal, NonWorkingPeriod, Task } from "../types";
import { addDays, getNonWorkingPeriod, todayValue } from "../utils";
import { Modal } from "./Modal";

type Period = "day" | "week" | "month";
type AchievementView = "record" | "game" | "company";
type CompanyView = "office" | "organization" | "locations";

const employeeTemplates = [
  { name: "青木 ひなた", age: 29, gender: "女性", department: "企画", team: "事業企画", hobby: "街歩き", skill: "企画を形にすること", personality: "好奇心旺盛で前向き" },
  { name: "佐藤 湊", age: 32, gender: "男性", department: "開発", team: "基盤開発", hobby: "珈琲店めぐり", skill: "問題の切り分け", personality: "落ち着いて粘り強い" },
  { name: "高橋 結衣", age: 26, gender: "女性", department: "企画", team: "デザイン", hobby: "写真", skill: "情報を見やすく整えること", personality: "丁寧で聞き上手" },
  { name: "田中 悠真", age: 35, gender: "男性", department: "営業", team: "法人営業", hobby: "ランニング", skill: "相手の要望を引き出すこと", personality: "社交的で行動が早い" },
  { name: "伊藤 葵", age: 24, gender: "女性", department: "営業", team: "顧客サポート", hobby: "読書", skill: "小さな変化に気づくこと", personality: "穏やかで気配り上手" },
  { name: "山本 蓮", age: 41, gender: "男性", department: "管理", team: "総務", hobby: "料理", skill: "段取りと調整", personality: "堅実で頼りになる" },
  { name: "中村 凛", age: 30, gender: "女性", department: "開発", team: "業務改善", hobby: "ゲーム", skill: "改善の自動化", personality: "集中力が高く率直" },
  { name: "小林 樹", age: 28, gender: "男性", department: "企画", team: "マーケティング", hobby: "映画", skill: "伝わる言葉を考えること", personality: "柔軟でアイデア豊富" },
  { name: "加藤 美咲", age: 38, gender: "女性", department: "管理", team: "人事", hobby: "園芸", skill: "人の強みを見つけること", personality: "おおらかで面倒見が良い" },
  { name: "吉田 陽", age: 23, gender: "男性", department: "開発", team: "新技術", hobby: "自転車", skill: "新しい技術の習得", personality: "素直で吸収が早い" },
  { name: "斎藤 澪", age: 34, gender: "女性", department: "管理", team: "経理", hobby: "美術館めぐり", skill: "数字の違和感を見つけること", personality: "慎重で正確" },
  { name: "松本 大地", age: 45, gender: "男性", department: "開発", team: "品質管理", hobby: "釣り", skill: "リスクの先読み", personality: "冷静で責任感が強い" },
] as const;

type CompanyEmployee = {
  name: string;
  age: number;
  gender: "男性" | "女性";
  department: typeof companyDepartments[number];
  team: string;
  hobby: string;
  skill: string;
  personality: string;
};

const companyDepartments = ["企画", "開発", "営業", "管理"] as const;
const departmentTeams: Record<typeof companyDepartments[number], readonly string[]> = {
  企画: ["事業企画", "デザイン", "マーケティング"],
  開発: ["基盤開発", "業務改善", "品質管理", "新技術"],
  営業: ["法人営業", "顧客サポート", "営業企画"],
  管理: ["総務", "人事", "経理"],
};
const employeeRole = (employee: CompanyEmployee, active: readonly CompanyEmployee[], stage: number) => {
  if (employee === active[0]) return stage >= 5 ? "社長" : "代表";
  let officer: CompanyEmployee | undefined;
  if (stage >= 5) {
    const departmentCounts = companyDepartments.map((department) => ({ department, count: active.filter((candidate) => candidate.department === department).length }));
    const largestDepartment = departmentCounts.sort((a, b) => b.count - a.count || companyDepartments.indexOf(a.department) - companyDepartments.indexOf(b.department))[0]?.department;
    officer = active.find((candidate) => candidate !== active[0] && candidate.department === largestDepartment);
    if (employee === officer) return "担当役員";
  }
  // 社長・担当役員は全社経営を担うため、部署内のまとめ役を選ぶ際には在籍メンバーから除く。
  // これにより、部長が役員へ昇格した部署でも次の社員が部長を引き継ぐ。
  const members = active.filter((candidate) => candidate !== officer && (stage < 5 || candidate !== active[0]) && candidate.department === employee.department);
  if (members[0] !== employee) return "メンバー";
  if (stage >= 4 && members.length >= 3) return "部長";
  if (stage >= 3 && members.length >= 2) return "チームリーダー";
  return "メンバー";
};

const cityPlaces = [
  { type: "res", icon: "⌂", name: "ひだまり住宅", people: "親子と小学生", scene: "学校帰りの子どもたちが庭先で遊んでいます。" },
  { type: "com", icon: "靴", name: "こみち靴店", people: "店主と買い物客", scene: "店主がお客さんに歩きやすい靴を選んでいます。" },
  { type: "com", icon: "ぱ", name: "朝焼けベーカリー", people: "パン職人と学生", scene: "焼きたてのパンを求めて学生が立ち寄っています。" },
  { type: "pub", icon: "本", name: "まちの図書館", people: "司書と親子、高齢者", scene: "読み聞かせの隣で、静かに新聞を読む人がいます。" },
  { type: "wrk", icon: "工", name: "青空工房", people: "職人と若い見習い", scene: "職人が見習いに道具の使い方を教えています。" },
  { type: "com", icon: "珈", name: "喫茶みどり", people: "店員と常連客", scene: "買い物帰りの人たちが一息ついています。" },
  { type: "pub", icon: "医", name: "つばさ診療所", people: "医師、看護師、患者", scene: "地域の人が安心して相談できる診療所です。" },
  { type: "res", icon: "寮", name: "若葉アパート", people: "学生と若い会社員", scene: "住人同士が玄関先で今日の出来事を話しています。" },
  { type: "com", icon: "百", name: "中央百貨店", people: "家族連れと販売員", scene: "週末の売り場に幅広い世代が集まっています。" },
  { type: "pub", icon: "学", name: "さくら小学校", people: "児童と先生", scene: "校庭から元気な声が聞こえてきます。" },
  { type: "wrk", icon: "映", name: "銀河映画館", people: "若者、夫婦、スタッフ", scene: "新作映画を楽しみに人々が列を作っています。" },
  { type: "com", icon: "花", name: "花屋こもれび", people: "花屋と近所の人", scene: "季節の花が商店街に彩りを添えています。" },
] as const;

const cityNamePrefixes = ["朝凪", "木漏れ日", "青葉", "夕映え", "白樺", "水音", "風待ち", "星見", "若草", "鈴風", "月影", "小春", "山吹", "雨音", "若葉", "灯台"] as const;
const cityPlaceNames = {
  res: [
    "ひだまり荘", "風見坂レジデンス", "つむぎ長屋", "月灯りハイツ", "青葉コート", "水辺の家",
    "こもれびテラス", "白樺アパート", "夕凪館", "鈴風住宅", "小春の丘", "星見台ハウス",
  ],
  com: [
    "パン工房 麦日和", "喫茶 月舟", "靴店ステップ", "花と鉢植え リーフ", "八百屋みのり", "菓子舗こはく",
    "台所道具 くらし屋", "古書トビラ", "洋食堂ポラリス", "仕立て屋イトノネ", "珈琲ロースタリー凪", "雑貨店トランク",
    "おにぎり処 結び", "レコード店スピン", "自転車店ペダル", "小さな本屋 栞", "惣菜店おかず箱", "茶房うぐいす",
    "写真館ルーメン", "文具店インク壺", "帽子店クラウン", "果実店サンデー", "玩具店ピース", "魚菜市場あさどれ",
  ],
  pub: [
    "つばさ診療所", "まちかど図書室", "さくら学舎", "ひかり保育園", "みんなの交流館", "青空公民館",
    "こもれび児童館", "水音ケアセンター", "風見消防分署", "星見郵便局", "若葉保健室", "夕凪文化会館",
  ],
  wrk: [
    "青空クラフト舎", "鉄と木の工房", "デザイン室ピクセル", "修理工房なおし屋", "印刷所活版堂", "映像スタジオ灯",
    "縫製アトリエ糸巻", "木工所年輪", "小さな研究室ラボノート", "音響工房エコー", "町の製作所ギア", "陶房つちのね",
  ],
} as const;
// 見た目と名称が食い違わないよう、建物アイコン（業種）ごとに名称を選ぶ。
// type は色分けなどの大分類なので、名称の抽選単位としては広すぎる。
const cityPlaceNamesByIcon: Record<string, readonly string[]> = {
  "⌂": ["ひだまり荘", "風見坂レジデンス", "つむぎ長屋", "月灯りハイツ", "こもれびテラス", "水辺の家"],
  "寮": ["若葉アパート", "白樺ハイツ", "夕凪学生寮", "星見台レジデンス", "鈴風コート", "小春の丘住宅"],
  "靴": ["こみち靴店", "靴店ステップ", "シューズ工房あゆみ", "革靴店ラスト", "足もと屋みち", "靴のアトリエ紐"],
  "ぱ": ["朝焼けベーカリー", "パン工房 麦日和", "石窯パンこむぎ", "ベーカリー日なた", "パン屋ふくらむ", "焼きたて工房穂の香"],
  "珈": ["喫茶みどり", "喫茶 月舟", "珈琲ロースタリー凪", "カフェ木漏れ日", "純喫茶こはく", "珈琲店ひと息"],
  "百": ["中央百貨店", "暮らしの百貨みのり", "デパート青葉", "まちかど百貨店", "生活館つむぎ", "よろず百貨こまち"],
  "花": ["花屋こもれび", "花と鉢植え リーフ", "花店つぼみ", "フラワーショップ鈴風", "花舗あかり", "草花店若葉"],
  "本": ["まちの図書館", "まちかど図書室", "小さな本屋 栞", "古書トビラ", "本棚文庫", "読書室ページ"],
  "医": ["つばさ診療所", "水音クリニック", "若葉医院", "まちの保健室", "ひだまり診療所", "青葉メディカル"],
  "学": ["さくら小学校", "青空学舎", "若草小学校", "星見学園", "こもれび学級", "水辺の学校"],
  "工": ["青空工房", "鉄と木の工房", "町の製作所ギア", "木工所年輪", "修理工房なおし屋", "陶房つちのね"],
  "映": ["銀河映画館", "映像館ルーメン", "シネマ夕映え", "映画館ポラリス", "劇場スクリーン", "まちの映写室"],
};
const cityConcepts = {
  res: ["世代を越えて挨拶が交わされる住まい", "静かな時間と小さな交流を大切にする住まい", "庭先の緑を住民みんなで育てる住まい", "在宅仕事と共同生活が自然に混ざる住まい", "ペットと暮らす人が集まる小さな共同住宅"],
  com: ["地元の素材と顔の見える接客を大切にする店", "仕事帰りにも立ち寄れる小さな専門店", "季節ごとに品揃えと店先の表情が変わる店", "店主の偏愛が棚いっぱいに並ぶ専門店", "週末だけ小さな催しを開く地域密着の店", "古い道具を直して次の持ち主へ渡す店", "朝早くから働く人を迎える店"],
  pub: ["誰でも気軽に相談できる地域の拠点", "子どもから高齢者まで安心して集まれる場所", "学びと暮らしをゆるやかにつなぐ公共施設", "小さな困りごとを地域で支える施設", "静かに過ごす場所と交流の場を備えた施設"],
  wrk: ["職人の技術と新しい発想が出会う仕事場", "地域の依頼を小回りよく形にする仕事場", "つくる過程を街へひらいた活動拠点", "異なる分野の作り手が道具を共有する仕事場", "試作品をすぐ街の人に試してもらえる工房"],
} as const;
const seededIndex = (seed: number, buildingIndex: number, salt: number, length: number) => {
  let value = (seed ^ Math.imul(buildingIndex + 1, 0x45d9f3b) ^ Math.imul(salt, 0x27d4eb2d)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) % length;
};
const employeeCountForLevel = (level: number) => Math.max(1, level <= 20
  ? 1 + Math.floor((level - 1) * .8)
  : 16 + Math.floor((level - 20) * 1.5));
const companyEmployeesForSeed = (seed: number, count: number): CompanyEmployee[] => {
  const departmentOrder = [...companyDepartments];
  for (let index = departmentOrder.length - 1; index > 0; index -= 1) {
    const swapIndex = seededIndex(seed, index, 47, index + 1);
    [departmentOrder[index], departmentOrder[swapIndex]] = [departmentOrder[swapIndex], departmentOrder[index]];
  }
  const surnames = ["青木", "佐藤", "高橋", "田中", "伊藤", "山本", "中村", "小林", "加藤", "吉田", "斎藤", "松本", "井上", "木村", "林", "清水", "山崎", "森", "池田", "橋本", "阿部", "石川", "山下", "前田"];
  for (let index = surnames.length - 1; index > 0; index -= 1) {
    const swapIndex = seededIndex(seed, index, 59, index + 1);
    [surnames[index], surnames[swapIndex]] = [surnames[swapIndex], surnames[index]];
  }
  const femaleNames = ["ひなた", "結衣", "葵", "凛", "美咲", "澪", "陽菜", "紬", "楓", "杏", "彩花", "琴音", "七海", "咲良", "真央", "莉子", "芽依", "千尋", "遥", "優衣", "茜", "文", "瑞希", "環"];
  const maleNames = ["湊", "悠真", "蓮", "樹", "陽", "大地", "蒼", "颯太", "朝陽", "律", "直樹", "健太", "拓海", "翼", "亮", "航", "誠", "陸", "和真", "隼人", "歩", "優", "司", "学"];
  for (let index = femaleNames.length - 1; index > 0; index -= 1) {
    const swapIndex = seededIndex(seed, index, 61, index + 1);
    [femaleNames[index], femaleNames[swapIndex]] = [femaleNames[swapIndex], femaleNames[index]];
  }
  for (let index = maleNames.length - 1; index > 0; index -= 1) {
    const swapIndex = seededIndex(seed, index, 67, index + 1);
    [maleNames[index], maleNames[swapIndex]] = [maleNames[swapIndex], maleNames[index]];
  }
  return Array.from({ length: count }, (_, index) => {
    const employee = employeeTemplates[seededIndex(seed, index, 31, employeeTemplates.length)];
    const department = departmentOrder[index % departmentOrder.length];
    const teams = departmentTeams[department];
    const givenNames = employee.gender === "女性" ? femaleNames : maleNames;
    const givenName = givenNames[seededIndex(seed, index, 67, givenNames.length)];
    const surname = surnames[seededIndex(seed, index, 59, surnames.length)];
    return {
      ...employee,
      name: `${surname} ${givenName}`,
      age: 22 + seededIndex(seed, index, 83, 25),
      department,
      team: teams[seededIndex(seed, index, 71, teams.length)],
    };
  });
};
const cityPlaceFor = (buildingIndex: number, seed: number) => {
  // 建物種別・名称・コンセプトを別々のソルトで選び、同じ系列の名前が続かないようにする。
  const templateIndex = (buildingIndex * 5 + seed) % cityPlaces.length;
  const template = cityPlaces[templateIndex];
  const names = cityPlaceNamesByIcon[template.icon] ?? cityPlaceNames[template.type];
  const nameIndex = seededIndex(seed, buildingIndex, 101, names.length);
  const cycle = Math.floor(buildingIndex / names.length);
  const conceptList = cityConcepts[template.type];
  const concept = conceptList[seededIndex(seed, buildingIndex, 17, conceptList.length)];
  const baseName = names[nameIndex];
  // 候補を一巡するほど街が大きくなった場合だけ地区名を添えて重複を防ぐ。
  // 「若草地区の風見消防分署」のように地名が二重に見えないよう、施設種別に
  // 合わせた自然な支店・棟・工房表記にする。
  const areaName = cityNamePrefixes[seededIndex(seed, buildingIndex, 113, cityNamePrefixes.length)];
  const qualifiedName = template.type === "com"
    ? `${baseName} ${areaName}店`
    : template.type === "res"
      ? `${baseName} ${areaName}棟`
      : template.type === "wrk"
        ? `${baseName} ${areaName}工房`
        : `${baseName}（${areaName}地区）`;
  const name = cycle > 0 ? qualifiedName : baseName;
  return { ...template, name, concept, scene: `${concept}。${template.scene}` };
};

const dateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const fromDateValue = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const shiftDate = (value: string, amount: number) => {
  const date = fromDateValue(value);
  date.setDate(date.getDate() + amount);
  return dateValue(date);
};
const periodRange = (base: string, period: Period): [string, string] => {
  if (period === "day") return [base, base];
  const date = fromDateValue(base);
  if (period === "week") {
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    const start = dateValue(date);
    return [start, shiftDate(start, 6)];
  }
  return [dateValue(new Date(date.getFullYear(), date.getMonth(), 1)), dateValue(new Date(date.getFullYear(), date.getMonth() + 1, 0))];
};
const rangeDates = (start: string, end: string) => {
  const dates: string[] = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) dates.push(date);
  return dates;
};
const localDate = (timestamp: string) => dateValue(new Date(timestamp));
const hoursLabel = (hours: number) => Number.isInteger(hours) ? `${hours}h` : `${Math.round(hours * 10) / 10}h`;
const plannedHoursForDate = (task: Task, date: string) => task.plannedRanges
  .filter((range) => range.startDate <= date && (range.endDate || range.startDate) >= date)
  .reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0);
const actualHoursForDate = (task: Task, date: string) => Object.entries(task.dailyActualHours || {})
  .filter(([planKey]) => planKey === date || planKey.startsWith(`${date}::`))
  .reduce((sum, [, hours]) => sum + (Number(hours) || 0), 0);
const gameScoreFor = (task: Task, date: string) => {
  const planned = plannedHoursForDate(task, date);
  const actual = actualHoursForDate(task, date);
  if (planned <= 0 || actual <= 0) return { score: 100, accuracy: 0, planned, actual };
  const differenceRate = Math.abs(actual - planned) / planned;
  const accuracy = Math.max(0, Math.round(50 * (1 - Math.min(1, differenceRate))));
  return { score: 100 + accuracy, accuracy, planned, actual };
};

export function AchievementsModal({ tasks, projects, activity, nonWorkingPeriods, organizationSeed, onSelect, onClose }: {
  tasks: Task[];
  projects: Goal[];
  activity: ActivityEvent[];
  nonWorkingPeriods: NonWorkingPeriod[];
  organizationSeed: number;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<AchievementView>("record");
  const [gameEnabled, setGameEnabled] = useState(() => localStorage.getItem("chatTaskIdleGameEnabled") === "true");
  const [period, setPeriod] = useState<Period>("week");
  const [base, setBase] = useState(todayValue());
  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);
  const citySeed = organizationSeed;
  const [companyView, setCompanyView] = useState<CompanyView>("office");
  const [selectedLocation, setSelectedLocation] = useState("tokyo");
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  const [officeZoom, setOfficeZoom] = useState(1);
  const [officeHistoryOpen, setOfficeHistoryOpen] = useState(false);
  const [selectedChartDate, setSelectedChartDate] = useState<string | null>(null);
  const [showNonWorkingDays, setShowNonWorkingDays] = useState(() => localStorage.getItem("chatTaskAchievementShowNonWorkingDays") !== "false");
  const workingDateOverrides = useMemo(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskWorkingDateOverrides") || "[]");
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }, []);
  const [start, end] = periodRange(base, period);
  const days = rangeDates(start, end);
  const nonWorkingDates = useMemo(() => new Set(days.filter((date) => getNonWorkingPeriod(date, nonWorkingPeriods, workingDateOverrides))), [days, nonWorkingPeriods, workingDateOverrides]);
  const cancelledCompletionIds = useMemo(() => new Set(activity
    .filter((event) => event.type === "task-completion-cancelled")
    .map((event) => event.details?.completionEventId)
    .filter((id): id is string => typeof id === "string")), [activity]);
  const completionEvents = activity.filter((event) =>
    localDate(event.timestamp) >= start &&
    localDate(event.timestamp) <= end &&
    !cancelledCompletionIds.has(event.id) &&
    (event.type === "task-completed" || event.type === "daily-plan-completed" || event.type === "recurrence-done"));
  const taskCompletionEvents = completionEvents.filter((event) => event.type === "task-completed");
  const legacyCompleted = tasks.filter((task) =>
    task.status === "done" &&
    task.completedAt &&
    localDate(task.completedAt) >= start &&
    localDate(task.completedAt) <= end &&
    !taskCompletionEvents.some((event) => event.taskId === task.id));
  const recurringTaskIds = new Set([
    ...tasks.filter((task) => task.taskKind === "recurring" || task.status === "recurring").map((task) => task.id),
    ...activity.filter((event) => event.type === "task-deleted" && event.details?.snapshot && typeof event.details.snapshot === "object")
      .flatMap((event) => { const snapshot = event.details!.snapshot as Task; return snapshot.taskKind === "recurring" || snapshot.status === "recurring" ? [snapshot.id] : []; }),
  ]);
  const createdEvents = activity.filter((event) => event.type === "task-created" && !recurringTaskIds.has(event.taskId || "") && localDate(event.timestamp) >= start && localDate(event.timestamp) <= end);
  const createdIds = new Set(createdEvents.map((event) => event.taskId).filter(Boolean));
  const legacyCreated = tasks.filter((task) => task.taskKind !== "recurring" && task.status !== "recurring" && localDate(task.createdAt) >= start && localDate(task.createdAt) <= end && !createdIds.has(task.id));
  const createdCount = createdEvents.length + legacyCreated.length;
  const completedTaskCount = taskCompletionEvents.length + legacyCompleted.length;
  const dailyCompleted = tasks.flatMap((task) => Object.entries(task.dailyPlanCompleted || {})
    .filter(([sourceKey, completed]) => completed && sourceKey.slice(0, 10) >= start && sourceKey.slice(0, 10) <= end)
    .map(([sourceKey]) => ({ task, date: sourceKey.slice(0, 10) })));
  const recurrenceCompleted = tasks.flatMap((task) => (task.recurrenceRecords || [])
    .filter((record) => record.status === "done" && record.date >= start && record.date <= end)
    .map((record) => ({ task, date: record.date })));
  const projectAchievements = projects.flatMap((project) => [
    ...project.milestones.filter((milestone) => milestone.completedAt && localDate(milestone.completedAt) >= start && localDate(milestone.completedAt) <= end)
      .map((milestone) => ({ id: `milestone-${project.id}-${milestone.id}`, title: milestone.title, date: localDate(milestone.completedAt!), kind: "マイルストーン達成", taskId: milestone.linkedTaskId || null })),
    ...(project.workItems || []).filter((work) => work.completedAt && localDate(work.completedAt) >= start && localDate(work.completedAt) <= end)
      .map((work) => ({ id: `work-${project.id}-${work.id}`, title: work.title, date: localDate(work.completedAt!), kind: "作業項目達成", taskId: work.linkedTaskId || null })),
  ]);
  const completedResponses = dailyCompleted.length + recurrenceCompleted.length + projectAchievements.length;
  const actualHours = tasks.reduce((sum, task) => sum + Object.entries(task.dailyActualHours || {})
    .filter(([date]) => date >= start && date <= end)
    .reduce((subtotal, [, hours]) => subtotal + (Number(hours) || 0), 0), 0);
  const carryovers = activity.filter((event) => {
    const date = localDate(event.timestamp);
    return date >= start && date <= end && (event.summary.includes("持ち越") || event.type === "recurrence-moved");
  });
  const net = completedTaskCount - createdCount;
  const daily = days.map((date) => ({
    date,
    created: createdEvents.filter((event) => localDate(event.timestamp) === date).length + legacyCreated.filter((task) => localDate(task.createdAt) === date).length,
    completed: taskCompletionEvents.filter((event) => localDate(event.timestamp) === date).length + legacyCompleted.filter((task) => localDate(task.completedAt!) === date).length,
    responses: dailyCompleted.filter((item) => item.date === date).length + recurrenceCompleted.filter((item) => item.date === date).length + projectAchievements.filter((item) => item.date === date).length,
    hours: tasks.reduce((sum, task) => sum + actualHoursForDate(task, date), 0),
  }));
  const chartMax = Math.max(1, ...daily.map((item) => Math.max(item.completed, item.responses, item.created)));
  const deletedTaskSnapshots = activity.flatMap((event) => {
    if (event.type !== "task-deleted" || !event.details?.snapshot || typeof event.details.snapshot !== "object") return [];
    return [{ deletedAt: event.timestamp, task: event.details.snapshot as Task }];
  });
  const currentTaskIds = new Set(tasks.map((task) => task.id));
  const taskEntities = [
    ...tasks.map((task) => ({ task, deletedAt: "" })),
    ...deletedTaskSnapshots.filter(({ task }) => !currentTaskIds.has(task.id)),
  ];
  const excludedFromTaskTotal = new Set<Task["status"]>(["done", "cancelled", "handed-over", "pending"]);
  const statusAtEndOfDate = (task: Task, deletedAt: string, date: string) => {
    let status = task.status;
    activity.filter((event) => event.taskId === task.id && localDate(event.timestamp) > date && (!deletedAt || event.timestamp <= deletedAt))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .forEach((event) => {
        if (event.type === "task-completion-cancelled") { status = "done"; return; }
        if (typeof event.details?.fromStatus === "string" && event.details.fromStatus in STATUS_LABELS) status = event.details.fromStatus as Task["status"];
      });
    return status;
  };
  const activeTaskCountForDate = (date: string) => taskEntities.filter(({ task, deletedAt }) => localDate(task.createdAt) <= date && (!deletedAt || localDate(deletedAt) > date) && task.taskKind !== "recurring" && task.status !== "recurring" && !excludedFromTaskTotal.has(statusAtEndOfDate(task, deletedAt, date))).length;
  const activeTaskSeries = days.map((date) => {
    if (date > todayValue()) return { date, count: null };
    return { date, count: activeTaskCountForDate(date) };
  });
  const chartDaily = showNonWorkingDays ? daily : daily.filter((item) => !nonWorkingDates.has(item.date));
  const chartActiveTaskSeries = showNonWorkingDays ? activeTaskSeries : activeTaskSeries.filter((item) => !nonWorkingDates.has(item.date));
  let previousChartDate = addDays(start, -1);
  if (!showNonWorkingDays) {
    for (let offset = 0; offset < 366 && getNonWorkingPeriod(previousChartDate, nonWorkingPeriods, workingDateOverrides); offset += 1) previousChartDate = addDays(previousChartDate, -1);
  }
  const previousTaskTotal = previousChartDate <= todayValue() ? { date: previousChartDate, count: activeTaskCountForDate(previousChartDate), previous: true as const } : null;
  const visibleTaskTotals = [
    ...(previousTaskTotal ? [previousTaskTotal] : []),
    ...chartActiveTaskSeries.filter((item): item is { date: string; count: number } => item.count !== null).map((item) => ({ ...item, previous: false as const })),
  ];
  const taskTotalMin = Math.max(0, (visibleTaskTotals.length ? Math.min(...visibleTaskTotals.map((item) => item.count)) : 0) - 1);
  const taskTotalMax = Math.max(1, (visibleTaskTotals.length ? Math.max(...visibleTaskTotals.map((item) => item.count)) : 0) + 1);
  const taskTotalRange = Math.max(1, taskTotalMax - taskTotalMin);
  // 日数に応じて描画幅を変え、週・日表示の間延びを防ぎつつ月表示は広く使う。
  const chartWidth = period === "month" ? 1600 : period === "week" ? 1000 : 500;
  const chartSlotCount = chartDaily.length + (previousTaskTotal ? 1 : 0);
  const chartX = (index: number) => chartSlotCount <= 1 ? chartWidth / 2 : 34 + index / (chartSlotCount - 1) * (chartWidth - 68);
  const taskTotalPoints = visibleTaskTotals.map((item) => ({
    ...item,
    x: chartX(item.previous ? 0 : chartDaily.findIndex((day) => day.date === item.date) + (previousTaskTotal ? 1 : 0)),
    y: 142 - (item.count - taskTotalMin) / taskTotalRange * 104,
  }));
  const taskTotalPath = taskTotalPoints.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const defaultChartIndex = chartActiveTaskSeries.reduce((last, item, index) => item.count !== null ? index : last, 0);
  const selectedChartIndex = selectedChartDate ? chartDaily.findIndex((item) => item.date === selectedChartDate) : -1;
  const displayedChartIndex = selectedChartIndex >= 0 ? selectedChartIndex : defaultChartIndex;
  const displayedChartDay = chartDaily[displayedChartIndex];
  const displayedActiveTotal = chartActiveTaskSeries[displayedChartIndex]?.count;
  const completedTaskItems = [
    ...taskCompletionEvents.map((event) => ({ id: event.id, taskId: event.taskId, title: event.taskTitle, date: localDate(event.timestamp), kind: "タスク完了" })),
    ...legacyCompleted.map((task) => ({ id: `legacy-${task.id}`, taskId: task.id, title: task.title, date: localDate(task.completedAt!), kind: "タスク完了" })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const completedResponseItems = [
    ...dailyCompleted.map(({ task, date }) => ({ id: `daily-${task.id}-${date}`, taskId: task.id, title: task.title, date, kind: "今日の対応を達成" })),
    ...recurrenceCompleted.map(({ task, date }) => ({ id: `recurrence-${task.id}-${date}`, taskId: task.id, title: task.title, date, kind: "定期タスクを実施" })),
    ...projectAchievements,
  ].sort((a, b) => b.date.localeCompare(a.date));
  const gameResults = tasks.flatMap((task) => Object.entries(task.dailyPlanCompleted || {})
    .filter(([, completed]) => completed)
    .map(([sourceKey]) => {
      const date = sourceKey.slice(0, 10);
      return { task, date, sourceKey, ...gameScoreFor(task, date) };
    }));
  const totalGameScore = gameResults.reduce((sum, result) => sum + result.score, 0);
  const gameLevel = Math.floor(totalGameScore / 500) + 1;
  const levelScore = totalGameScore % 500;
  const todayGameResults = gameResults.filter((result) => result.date === todayValue());
  const todayGameScore = todayGameResults.reduce((sum, result) => sum + result.score, 0);
  const accurateCount = gameResults.filter((result) => result.accuracy >= 40).length;
  const companyStage = gameLevel >= 18 ? 5 : gameLevel >= 12 ? 4 : gameLevel >= 8 ? 3 : gameLevel >= 4 ? 2 : 1;
  const employeeCount = employeeCountForLevel(gameLevel);
  const companyEmployees = useMemo(() => companyEmployeesForSeed(organizationSeed, employeeCount), [organizationSeed, employeeCount]);
  const officeTier = employeeCount >= 200 ? 4 : employeeCount >= 100 ? 3 : employeeCount >= 13 ? 2 : 1;
  const companyRank = ["", "創業オフィス", "本社オフィス", "広域本社", "グローバル本社"][officeTier];
  const rawActiveEmployees = companyEmployees;
  const employeeRoles = new Map(rawActiveEmployees.map((employee) => [employee, employeeRole(employee, rawActiveEmployees, companyStage)]));
  const executiveEmployees = rawActiveEmployees.filter((employee) => ["社長", "担当役員"].includes(employeeRoles.get(employee) || ""));
  const departmentEmployees = rawActiveEmployees.filter((employee) => !executiveEmployees.includes(employee));
  const activeDepartments = companyDepartments.map((name, departmentIndex) => {
    const members = departmentEmployees.filter((employee) => employee.department === name);
    const teams = departmentTeams[name]
      .map((team) => ({ name: team, members: members.filter((employee) => employee.team === team) }))
      .filter((team) => team.members.length > 0);
    return { name, departmentIndex, members, teams };
  }).filter((department) => department.members.length > 0);
  const companyLocations = [
    { id: "tokyo", name: officeTier >= 2 ? "東京本社" : "本社オフィス", area: "日本・東京", unlockLevel: 1, icon: "本", specialty: "全社統括" },
    { id: "osaka", name: "大阪支店", area: "日本・大阪", unlockLevel: 50, icon: "阪", specialty: "西日本営業" },
    { id: "fukuoka", name: "福岡開発拠点", area: "日本・福岡", unlockLevel: 100, icon: "福", specialty: "プロダクト開発" },
    { id: "singapore", name: "シンガポール支社", area: "シンガポール", unlockLevel: 200, icon: "SG", specialty: "アジア事業" },
    { id: "london", name: "ロンドン支社", area: "イギリス・ロンドン", unlockLevel: 500, icon: "LDN", specialty: "欧州事業" },
  ].map((location) => ({ ...location, unlocked: employeeCount >= location.unlockLevel }));
  const unlockedLocations = companyLocations.filter((location) => location.unlocked);
  const currentLocation = companyLocations.find((location) => location.id === selectedLocation && location.unlocked) || unlockedLocations[0];
  const nextLocation = companyLocations.find((location) => !location.unlocked);
  const deskOffsets = [[0, 0], [15, 0], [30, 0], [0, 12], [15, 12], [30, 12]] as const;
  const activeEmployees = rawActiveEmployees.map((employee) => {
    const role = employeeRoles.get(employee) || "メンバー";
    const executiveIndex = executiveEmployees.indexOf(employee);
    if (executiveIndex >= 0) return {
      ...employee,
      role,
      organizationUnit: "経営",
      deskStyle: { "--desk-left": `${4 + executiveIndex * 15}%`, "--desk-top": "84%" } as CSSProperties,
    };
    const departmentIndex = companyDepartments.indexOf(employee.department);
    const departmentMembers = departmentEmployees.filter((candidate) => candidate.department === employee.department);
    const memberIndex = departmentMembers.indexOf(employee);
    const [offsetX, offsetY] = deskOffsets[memberIndex] || deskOffsets[deskOffsets.length - 1];
    const zoneColumn = departmentIndex % 2;
    const zoneRow = Math.floor(departmentIndex / 2);
    return {
      ...employee,
      role,
      organizationUnit: `${employee.department}部`,
      deskStyle: { "--desk-left": `${4 + zoneColumn * 50 + offsetX}%`, "--desk-top": `${9 + zoneRow * 36 + offsetY}%` } as CSSProperties,
    };
  });
  const locationIndexFor = (employee: typeof activeEmployees[number], index: number) => employee.organizationUnit === "経営" ? 0 : index % unlockedLocations.length;
  const staffedEmployees = activeEmployees.map((employee, index) => {
    const locationIndex = locationIndexFor(employee, index);
    const location = unlockedLocations[locationIndex];
    const earlierAtLocation = activeEmployees.slice(0, index).filter((candidate, earlierIndex) => locationIndexFor(candidate, earlierIndex) === locationIndex).length;
    return {
      ...employee,
      locationId: location.id,
      locationName: location.name,
      employmentType: locationIndex === 0 ? "本社採用" : earlierAtLocation < 2 ? "本社から出向" : "現地採用",
    };
  });
  const locationEmployeeCount = staffedEmployees.filter((employee) => employee.locationId === currentLocation.id).length;
  const currentLocationEmployees = staffedEmployees.filter((employee) => employee.locationId === currentLocation.id);
  const selectedEmployeeProfile = selectedEmployee === null ? null : staffedEmployees[selectedEmployee];
  const locationDepartments = activeDepartments.map((department) => ({
    ...department,
    members: staffedEmployees.filter((employee) => employee.locationId === currentLocation.id && employee.department === department.name && employee.organizationUnit !== "経営"),
    teams: departmentTeams[department.name].map((team) => ({ name: team, members: staffedEmployees.filter((employee) => employee.locationId === currentLocation.id && employee.department === department.name && employee.team === team && employee.organizationUnit !== "経営") })).filter((team) => team.members.length > 0),
  })).filter((department) => department.members.length > 0);
  const officeChanges = (() => {
    const changes: Array<{ id: string; date: string; icon: string; title: string; detail: string; kind: "hire" | "facility" | "level" | "promotion"; batch: number; order: number }> = [];
    const chronological = gameResults.slice().sort((a, b) => a.date.localeCompare(b.date) || a.sourceKey.localeCompare(b.sourceKey));
    if (!chronological.length) return changes;
    changes.push({ id: "office-opened", date: chronological[0].date, icon: "⌂", title: "オフィスを開設", detail: `${companyEmployees[0].name}が最初の一人として働き始めました。`, kind: "facility", batch: -1, order: 0 });
    let score = 0;
    let previousLevel = 1;
    let previousEmployees = 1;
    let previousStage = 1;
    chronological.forEach((result, batch) => {
      let order = 0;
      score += result.score;
      const nextLevel = Math.floor(score / 500) + 1;
      const nextEmployees = Math.min(companyEmployees.length, employeeCountForLevel(nextLevel));
      const nextStage = nextLevel >= 18 ? 5 : nextLevel >= 12 ? 4 : nextLevel >= 8 ? 3 : nextLevel >= 4 ? 2 : 1;
      if (nextLevel > previousLevel) changes.push({ id: `level-${nextLevel}`, date: result.date, icon: "↑", title: `オフィス Lv.${nextLevel}へ成長`, detail: `${result.task.title}の達成をきっかけに成長しました。`, kind: "level", batch, order: order++ });
      [
        { employees: 13, icon: "移", title: "本社オフィスへ移転", detail: "社員が増え、より広いオフィスへ引っ越しました。" },
        { employees: 50, icon: "阪", title: "大阪支店を開設", detail: "本社から立ち上げ担当が出向し、現地採用が始まりました。" },
        { employees: 100, icon: "福", title: "福岡開発拠点を開設", detail: "現地の開発社員を中心とした新しい拠点です。" },
        { employees: 200, icon: "SG", title: "シンガポール支社を開設", detail: "現地採用を中心とする最初の海外拠点が誕生しました。" },
        { employees: 500, icon: "英", title: "ロンドン支社を開設", detail: "欧州でも現地チームづくりが始まりました。" },
      ].forEach((milestone) => {
        if (previousEmployees < milestone.employees && nextEmployees >= milestone.employees) changes.push({ id: `location-${milestone.employees}`, date: result.date, icon: milestone.icon, title: milestone.title, detail: milestone.detail, kind: "facility", batch, order: order++ });
      });
      for (let index = previousEmployees; index < nextEmployees; index += 1) {
        const employee = companyEmployees[index];
        changes.push({ id: `hire-${index}`, date: result.date, icon: "人", title: `${employee.name}が入社`, detail: `${employee.department}部の${employee.team}として新しく加わりました。`, kind: "hire", batch, order: order++ });
      }
      const previousActive = companyEmployees.slice(0, previousEmployees);
      const nextActive = companyEmployees.slice(0, nextEmployees);
      companyDepartments.forEach((department) => {
        const previousCount = previousActive.filter((employee) => employee.department === department).length;
        const nextCount = nextActive.filter((employee) => employee.department === department).length;
        if (previousCount < 2 && nextCount >= 2) changes.push({ id: `island-${department}-${nextLevel}`, date: result.date, icon: "島", title: `${department}部の島が誕生`, detail: "同じ部門の社員が集まり、相談しやすい座席になりました。", kind: "facility", batch, order: order++ });
      });
      previousActive.forEach((employee, index) => {
        const previousRole = employeeRole(employee, previousActive, previousStage);
        const nextRole = employeeRole(employee, nextActive, nextStage);
        if (previousRole !== nextRole) changes.push({ id: `promotion-${nextLevel}-${index}`, date: result.date, icon: "昇", title: `${employee.name}が${nextRole}へ昇格`, detail: nextRole === "社長" ? "所属部署を離れ、会社全体の経営を担うことになりました。" : nextRole === "担当役員" ? `${employee.department}部を管掌し、経営に加わることになりました。` : `${employee.department}部の${employee.team}をまとめる役割を担うことになりました。`, kind: "promotion", batch, order: order++ });
      });
      if (nextStage > previousStage) {
        for (let stage = previousStage + 1; stage <= nextStage; stage += 1) {
          const facility = stage === 2
            ? { title: "休憩スペースが完成", detail: "社員が一息つける場所ができました。", icon: "☕" }
            : stage === 3
              ? { title: "ミーティングスペースが完成", detail: "チームで相談できる場所ができました。", icon: "会" }
              : stage === 4
                ? { title: "複数部署のオフィスへ拡張", detail: "部署をまたいで働ける広さになりました。", icon: "▦" }
                : { title: "本社オフィスへ拡張", detail: "会社の成長を支える本社になりました。", icon: "社" };
          changes.push({ id: `facility-${stage}`, date: result.date, ...facility, kind: "facility", batch, order: order++ });
        }
      }
      previousLevel = nextLevel;
      previousEmployees = nextEmployees;
      previousStage = nextStage;
    });
    // 新しい達成を上にしつつ、各達成の中は
    // 「レベルアップ → 入社・昇進・設備」という因果順を維持する。
    return changes.sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date);
      if (dateOrder) return dateOrder;

      // 同日に複数回レベルアップした場合は、最新のレベルを先に表示する。
      // 生成元のタスク順や sourceKey の並びに履歴表示が引っ張られるのを防ぐ。
      if (a.kind === "level" && b.kind === "level") {
        const aLevel = Number(a.id.replace("level-", ""));
        const bLevel = Number(b.id.replace("level-", ""));
        if (aLevel !== bLevel) return bLevel - aLevel;
      }

      return b.batch - a.batch || a.order - b.order;
    });
  })();
  const monthlySales = Math.max(12, Math.round(totalGameScore * .42));
  const cityStage = gameLevel >= 18 ? 5 : gameLevel >= 12 ? 4 : gameLevel >= 8 ? 3 : gameLevel >= 4 ? 2 : 1;
  const cityRank = ["", "はじまりの集落", "小さな町", "地方都市", "中核都市", "大都市"][cityStage];
  const roadRank = ["", "未舗装の小道", "生活道路", "舗装された街路", "幹線道路", "大通り"][cityStage];
  const nextDevelopment = [
    "",
    "生活道路と新しい街区",
    "道路の舗装と商店",
    "幹線道路と公共施設",
    "大通りと高層建築",
    "都市全体の再開発",
  ][cityStage];
  const population = 12 + Math.floor(totalGameScore * 1.8);
  // 街が育つたびに表示範囲を広げる。外周を最初から見せず、カメラが徐々に引く表現にする。
  const mapSize = [3, 5, 7, 9, 11][cityStage - 1];
  const center = Math.floor(mapSize / 2);
  const roadCells = new Set<string>();
  for (let offset = -center; offset <= center; offset += 1) {
    roadCells.add(`${center}-${center + offset}`);
    roadCells.add(`${center + offset}-${center}`);
  }
  // 地方都市以降は、幹線道路から枝道が伸びて新しい地区を作る。
  if (cityStage >= 3) {
    const branch = center - 2;
    for (let column = 1; column < mapSize - 1; column += 1) roadCells.add(`${branch}-${column}`);
  }
  if (cityStage >= 4) {
    const branch = center + 2;
    for (let column = 1; column < mapSize - 1; column += 1) roadCells.add(`${branch}-${column}`);
  }
  if (cityStage >= 5) {
    for (let row = 1; row < mapSize - 1; row += 1) {
      roadCells.add(`${row}-${center - 3}`);
      roadCells.add(`${row}-${center + 3}`);
    }
  }
  const parkCells = new Set([
    `${Math.max(0, center - 1)}-${Math.max(0, center - 1)}`,
    ...(cityStage >= 3 ? [`${Math.min(mapSize - 1, center + 2)}-${Math.min(mapSize - 1, center + 2)}`] : []),
  ]);
  const buildingCandidates = Array.from({ length: mapSize * mapSize }, (_, index) => {
    const row = Math.floor(index / mapSize);
    const column = index % mapSize;
    return { row, column, key: `${row}-${column}`, distance: Math.abs(row - center) + Math.abs(column - center) };
  })
    .filter(({ key, row, column }) => !roadCells.has(key) && !parkCells.has(key) && !(cityStage >= 4 && row >= mapSize - 2 && column <= 2))
    .sort((a, b) => a.distance - b.distance || a.row - b.row || a.column - b.column);
  const buildingCount = Math.min(buildingCandidates.length, 2 + Math.floor(gameLevel * 1.45));
  const generatedCityPlaces = Array.from({ length: buildingCount }, (_, index) => cityPlaceFor(index, citySeed));
  const buildingPlaces = new Map(buildingCandidates.slice(0, buildingCount).map(({ key }, index) => [key, index]));
  const townTiles = Array.from({ length: mapSize * mapSize }, (_, index) => {
    const row = Math.floor(index / mapSize);
    const column = index % mapSize;
    const key = `${row}-${column}`;
    const buildingIndex = buildingPlaces.get(`${row}-${column}`);
    const water = cityStage >= 4 && row >= mapSize - 2 && column <= 2;
    const horizontalRoad = roadCells.has(key) && (
      row === center ||
      (cityStage >= 3 && row === center - 2) ||
      (cityStage >= 4 && row === center + 2)
    );
    const verticalRoad = roadCells.has(key) && (
      column === center ||
      (cityStage >= 5 && (column === center - 3 || column === center + 3))
    );
    const road = horizontalRoad && verticalRoad ? "intersection" : horizontalRoad ? "road-horizontal" : verticalRoad ? "road-vertical" : "";
    return { index, row, column, buildingIndex, kind: water ? "water" : road || (parkCells.has(key) ? "park" : "block") };
  });
  const selectedPlace = selectedBuilding === null ? null : generatedCityPlaces[selectedBuilding];
  const newestResult = gameResults.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const townEvent = todayGameResults.length
    ? `${generatedCityPlaces[buildingCount - 1]?.name || "新しい場所"}が街に加わりました。新しい交流が生まれています。`
    : newestResult
      ? `${newestResult.task.title}の達成をきっかけに、街の日常が少し豊かになりました。`
      : "住民たちは、次に街へ加わる新しい場所を楽しみにしています。";
  const shift = period === "day" ? 1 : period === "week" ? 7 : 31;

  return <Modal title="頑張りの記録" wide onClose={onClose}>
    <div className="achievement-view-switch" role="tablist">
      <button className={view === "record" ? "active" : ""} onClick={() => setView("record")}>積み重ね</button>
      <button className={view === "game" ? "active" : ""} onClick={() => setView("game")}>まちづくり（試作）</button>
      <button className={view === "company" ? "active" : ""} onClick={() => setView("company")}>会社育成（試作）</button>
    </div>
    {view === "record" ? <div className="achievement-view">
      <header className="achievement-controls">
        <div className="achievement-period-switch">
          <button className={period === "day" ? "active" : ""} onClick={() => setPeriod("day")}>今日</button>
          <button className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>今週</button>
          <button className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>今月</button>
        </div>
        <div className="achievement-date-nav"><button onClick={() => setBase(shiftDate(base, -shift))}>←</button><strong>{start === end ? start : `${start}〜${end}`}</strong><button onClick={() => setBase(shiftDate(base, shift))}>→</button><button onClick={() => setBase(todayValue())}>今日</button></div>
      </header>
      <section className="achievement-metrics">
        <article className="complete"><small>完了したタスク</small><strong>{completedTaskCount}<span>件</span></strong></article>
        <article className="response"><small>達成した対応</small><strong>{completedResponses}<span>件</span></strong></article>
        <article className="created"><small>新しく追加（通常タスク）</small><strong>{createdCount}<span>件</span></strong></article>
        <article className={net >= 0 ? "net positive" : "net"}><small>タスクの差し引き</small><strong>{net > 0 ? "−" : net < 0 ? "＋" : "±"}{Math.abs(net)}<span>件</span></strong><p>{net > 0 ? "未完了を減らしました" : net < 0 ? "取り組みが増えました" : "追加と完了が同数です"}</p></article>
        <article className="hours"><small>対応した時間</small><strong>{hoursLabel(actualHours)}</strong></article>
        <article className="carry"><small>持ち越し・移動</small><strong>{carryovers.length}<span>件</span></strong></article>
      </section>
      <section className="achievement-chart-panel">
        <header><div><strong>日ごとの成果と稼働タスク</strong><small>完了・対応達成・追加と、終了・保留・定期タスクを除いた稼働タスク総数を表示します。</small></div><div className="achievement-chart-options"><label><input type="checkbox" checked={showNonWorkingDays} onChange={(event) => { const checked = event.target.checked; setShowNonWorkingDays(checked); localStorage.setItem("chatTaskAchievementShowNonWorkingDays", String(checked)); setSelectedChartDate(null); }} />非稼働日を表示</label><div className="achievement-legend"><span className="done">タスク完了</span><span className="response">対応達成</span><span className="created">追加</span><span className="active-total">稼働タスク総数</span></div></div></header>
        {displayedChartDay && <div className="achievement-chart-selection"><strong>{displayedChartDay.date}</strong><span className="done">完了 <b>{displayedChartDay.completed}</b></span><span className="response">対応達成 <b>{displayedChartDay.responses}</b></span><span className="created">追加 <b>{displayedChartDay.created}</b></span><span className="active">稼働タスク <b>{displayedActiveTotal ?? "—"}</b></span><small>グラフにカーソルを合わせると切り替わります</small></div>}
        <div className="achievement-combined-chart">
          <svg viewBox={`0 0 ${chartWidth} 190`} role="img" aria-label="日ごとのタスク完了、対応達成、追加、稼働タスク総数">
            <line x1="24" y1="155" x2={chartWidth - 24} y2="155" className="axis" />
            {previousTaskTotal && <text className="date-label previous-date-label" x={chartX(0)} y="178">{previousTaskTotal.date.slice(5).replace("-", "/")}</text>}
            {chartDaily.map((item, index) => { const chartIndex = index + (previousTaskTotal ? 1 : 0), x = chartX(chartIndex), slotWidth = Math.max(20, (chartWidth - 68) / Math.max(1, chartSlotCount - 1)), doneHeight = item.completed / chartMax * 88, responseHeight = item.responses / chartMax * 88, createdHeight = item.created / chartMax * 88, nonWorking = nonWorkingDates.has(item.date); return <g key={item.date} className={nonWorking ? "non-working-day" : undefined}>
              <title>{`${item.date} タスク完了 ${item.completed}件 / 対応達成 ${item.responses}件 / 追加 ${item.created}件 / 稼働タスク ${chartActiveTaskSeries[index]?.count ?? "—"}件 / ${hoursLabel(item.hours)}`}</title>
              {nonWorking && <rect className="non-working-day-background" x={x - slotWidth / 2} y="20" width={slotWidth} height="145" />}
              {displayedChartIndex === index && <line className="selected-day-guide" x1={x} y1="25" x2={x} y2="158" />}
              <rect className="done-bar" x={x - 15} y={155 - doneHeight} width="8" height={doneHeight} rx="2" />
              <rect className="response-bar" x={x - 4} y={155 - responseHeight} width="8" height={responseHeight} rx="2" />
              <rect className="created-bar" x={x + 7} y={155 - createdHeight} width="8" height={createdHeight} rx="2" />
              {(period !== "month" || index % 5 === 0 || index === daily.length - 1) && <text className="date-label" x={x} y="178">{item.date.slice(5).replace("-", "/")}</text>}
              <rect className="day-hit-area" x={x - Math.max(10, (chartWidth - 68) / Math.max(1, chartSlotCount - 1) / 2)} y="20" width={Math.max(20, (chartWidth - 68) / Math.max(1, chartSlotCount - 1))} height="145" tabIndex={0} aria-label={`${item.date}の内容を表示`} onMouseEnter={() => setSelectedChartDate(item.date)} onFocus={() => setSelectedChartDate(item.date)} />
            </g>; })}
            {taskTotalPath && <path d={taskTotalPath} className="active-task-line" />}
            {taskTotalPoints.map((point, index) => { const previous = taskTotalPoints[index - 1]; const showValue = point.previous || index === taskTotalPoints.length - 1 || (previous && point.count !== previous.count); const nonWorking = nonWorkingDates.has(point.date); return <g className={`active-task-point${nonWorking ? " is-non-working" : ""}${point.previous ? " is-previous" : ""}`} key={point.date}><title>{`${point.date} 稼働タスク ${point.count}件${point.previous ? "（表示期間の直前）" : ""}`}</title><circle cx={point.x} cy={point.y} r={nonWorking ? "2.5" : "4"} /><text x={point.x} y={point.y - 9}>{showValue ? point.count : ""}</text></g>; })}
          </svg>
        </div>
      </section>
      <section className="achievement-recent">
        <header><strong>この期間に完了したタスク</strong><small>{completedTaskItems.length ? "内容を選ぶとタスクを開きます。" : "この期間に完了したタスクはありません。"}</small></header>
        <div>{completedTaskItems.map((item) => <button key={item.id} disabled={!item.taskId} onClick={() => item.taskId && onSelect(item.taskId)}><span><b>{item.title || "名称のないタスク"}</b><small>{item.kind}</small></span><time>{item.date}</time></button>)}</div>
      </section>
      <section className="achievement-recent achievement-response-list">
        <header><strong>この期間に達成した対応</strong><small>{completedResponseItems.length ? "日別対応・定期タスク・プロジェクト成果の記録です。" : "この期間の対応達成はありません。"}</small></header>
        <div>{completedResponseItems.map((item) => <button key={item.id} disabled={!item.taskId} onClick={() => item.taskId && onSelect(item.taskId)}><span><b>{item.title || "名称のない対応"}</b><small>{item.kind}</small></span><time>{item.date}</time></button>)}</div>
      </section>
    </div> : view === "company" ? <div className="idle-game-view company-game-view">
      <header className="idle-game-intro company-game-intro">
        <div><small>READ ONLY MODE</small><h2>積み重ねのオフィス</h2><p>今日の達成に応じて、社員とオフィスが育つ観察コンテンツです。</p></div>
        <span className="company-readonly-badge">業務データを参照するだけ</span>
      </header>
      <nav className="company-view-tabs" aria-label="会社の表示切り替え">
        <button type="button" className={companyView === "office" ? "is-active" : ""} onClick={() => setCompanyView("office")}>オフィス</button>
        <button type="button" className={companyView === "organization" ? "is-active" : ""} onClick={() => setCompanyView("organization")}>部署・組織一覧</button>
        <button type="button" className={companyView === "locations" ? "is-active" : ""} onClick={() => setCompanyView("locations")}>拠点一覧</button>
      </nav>
      {companyView === "office" ? <div className="company-game-dashboard">
        <section className={`company-office company-stage-${companyStage}`}>
          <div className="company-office-heading"><span>{currentLocation.name}・{companyRank}</span><strong>座席表 Lv.{gameLevel}</strong><small>{locationEmployeeCount}人全員を表示（全社{employeeCount}人）</small></div>
          <div className="company-zoom-controls" aria-label="座席表の拡大縮小"><button type="button" onClick={() => setOfficeZoom((zoom) => Math.max(.65, +(zoom - .1).toFixed(2)))}>−</button><button type="button" onClick={() => setOfficeZoom(1)}>{Math.round(officeZoom * 100)}%</button><button type="button" onClick={() => setOfficeZoom((zoom) => Math.min(1.6, +(zoom + .1).toFixed(2)))}>＋</button><button type="button" onClick={() => setOfficeZoom(.8)}>全体表示</button></div>
          <div className="company-floor" aria-label={`${companyRank}のトップビュー座席表`} style={{ transform: `scale(${officeZoom})` }}>
            <div className="company-seating-title"><b>{currentLocation.name}</b><span>{officeTier >= 3 ? "3F" : "2F"} オフィス座席表</span></div>
            <div className="company-floor-windows windows-left" aria-hidden="true" /><div className="company-floor-windows windows-right" aria-hidden="true" />
            <div className="company-corridor corridor-vertical"><span>通路</span></div><div className="company-corridor corridor-horizontal" aria-hidden="true" />
            <div className="company-reception"><strong>受付</strong><small>RECEPTION</small></div>
            <div className="company-copy-space"><strong>複合機・書庫</strong><small>PRINT / STORAGE</small></div>
            <div className="company-entrance"><span>出入口</span><i>↕</i></div>
            <div className="company-executive-suite"><strong>経営・役員室</strong><small>{currentLocationEmployees.filter((employee) => employee.organizationUnit === "経営").length}人</small><div className="company-seat-grid executive-seats">{currentLocationEmployees.filter((employee) => employee.organizationUnit === "経営").map((member) => { const employeeIndex = staffedEmployees.indexOf(member); return <button type="button" className={selectedEmployee === employeeIndex ? "is-selected" : ""} key={employeeIndex} onClick={() => setSelectedEmployee(employeeIndex)}>{member.name}</button>; })}</div></div>
            <div className="company-meeting-table"><span>ミーティングルーム</span></div>
            <div className="company-break-space"><i>☕</i><span>休憩室</span></div>
            {companyStage >= 2 && locationDepartments.map((department) => <div className={`company-department-island island-${department.departmentIndex + 1}`} key={department.name}>
              <header><strong>{department.name}部</strong><small>{department.members.length}人</small></header>
              <div className={`company-department-seat-islands ${department.members.length > 4 ? "is-split" : ""}`} aria-label={`${department.name}部の座席`}>
                {Array.from({ length: Math.ceil(department.members.length / 4) }, (_, islandIndex) => department.members.slice().sort((a, b) => Number(["部長", "チームリーダー"].includes(b.role)) - Number(["部長", "チームリーダー"].includes(a.role))).slice(islandIndex * 4, islandIndex * 4 + 4)).map((islandMembers, islandIndex) => <section className="company-seat-island" key={`${department.name}-${islandIndex}`}>
                  {department.members.length > 4 && <small className="company-seat-island-label">{department.name}部 第{islandIndex + 1}島</small>}
                  <div className="company-seat-grid floorplan-seats">{islandMembers.map((member, seatIndex) => { const employeeIndex = staffedEmployees.indexOf(member); const isLeader = ["部長", "チームリーダー"].includes(member.role); return <button type="button" className={`${isLeader && islandIndex === 0 && seatIndex === 0 ? "is-leader" : ""} ${selectedEmployee === employeeIndex ? "is-selected" : ""}`} key={employeeIndex} onClick={() => setSelectedEmployee(employeeIndex)} title={`${member.name}・${member.role}`}>{member.name.split(" ")[0]}</button>; })}</div>
                </section>)}
              </div>
            </div>)}
          </div>
          <div className="company-office-tip">名前を選ぶと社員プロフィールを表示します</div>
        </section>
        <aside className="company-side-panel">
          {selectedEmployeeProfile ? <section className="employee-profile" aria-live="polite"><header><span className={`gender-${selectedEmployeeProfile.gender === "男性" ? "male" : "female"}`}>{selectedEmployeeProfile.name.slice(0, 1)}</span><div><small>{selectedEmployeeProfile.organizationUnit}・{selectedEmployeeProfile.role}</small><h3>{selectedEmployeeProfile.name}</h3></div><button type="button" onClick={() => setSelectedEmployee(null)}>×</button></header><dl><div><dt>年齢</dt><dd>{selectedEmployeeProfile.age}歳</dd></div><div><dt>性別</dt><dd>{selectedEmployeeProfile.gender}</dd></div><div><dt>部署</dt><dd>{selectedEmployeeProfile.organizationUnit === "経営" ? `${selectedEmployeeProfile.department}部管掌` : selectedEmployeeProfile.organizationUnit}</dd></div><div><dt>課・チーム</dt><dd>{selectedEmployeeProfile.team}</dd></div><div><dt>役職</dt><dd>{selectedEmployeeProfile.role}</dd></div><div><dt>採用・異動</dt><dd>{selectedEmployeeProfile.employmentType}</dd></div><div><dt>趣味</dt><dd>{selectedEmployeeProfile.hobby}</dd></div><div><dt>特技</dt><dd>{selectedEmployeeProfile.skill}</dd></div><div><dt>性格</dt><dd>{selectedEmployeeProfile.personality}</dd></div></dl></section> : <section className="company-overview">
            <small>{companyRank}</small><h3>{currentLocation.name}の配置</h3><p>部署ごとの広がりと共用設備を眺める画面です。社員一人ひとりは組織一覧にまとめています。</p>
            <div className="company-next-hire"><b>現在レベルの成長</b><strong>{levelScore}<span>pt 積み上げ</span></strong><i><em style={{ width: `${levelScore / 5}%` }} /></i></div>
            {nextLocation && <div className="company-next-location"><small>次の拠点</small><strong>{nextLocation.name}</strong><span>全社{nextLocation.unlockLevel}人で開設</span></div>}
          </section>}
          <section className="company-metrics">
            <article><small>{currentLocation.name}</small><strong>{locationEmployeeCount}<span>人</span></strong></article>
            <article><small>全社社員</small><strong>{employeeCount}<span>人</span></strong></article>
            <article><small>月間売上</small><strong>{monthlySales.toLocaleString()}<span>万円</span></strong></article>
            <article><small>今日の成長</small><strong>+{todayGameScore.toLocaleString()}</strong></article>
          </section>
        </aside>
      </div> : companyView === "organization" ? <section className="company-directory-view">
        <header><div><small>ORGANIZATION</small><h3>部署・組織一覧</h3><p>社員が増えると、部署の中に課・チームが育ちます。</p></div><strong>{employeeCount}人</strong></header>
        <div className="company-directory-grid">
          <article className="company-executive-directory"><header><span>経</span><div><h4>経営・役員</h4><small>{staffedEmployees.filter((employee) => employee.organizationUnit === "経営").length}人</small></div></header><div className="company-employee-list">{staffedEmployees.filter((employee) => employee.organizationUnit === "経営").map((member, index) => <article key={`${member.name}-${index}`}><b>{member.name}</b><span>{member.role}</span><small>{member.locationName}・{member.employmentType}</small></article>)}</div></article>
          {activeDepartments.map((department) => <article key={department.name}>
          <header><span>{department.name.slice(0, 1)}</span><div><h4>{department.name}部</h4><small>{department.members.length}人</small></div></header>
          <div className="company-team-list">{department.teams.map((team) => {
            const members = staffedEmployees.filter((employee) => employee.department === department.name && employee.team === team.name && employee.organizationUnit !== "経営");
            return <details key={team.name} open={members.length <= 6}><summary><strong>{team.name}{department.members.length >= 6 ? "課" : "チーム"}</strong><small>{members.length}人</small></summary><div className="company-employee-list">{members.map((member, index) => <article key={`${member.name}-${index}`}><b>{member.name}</b><span>{member.role}</span><small>{member.locationName}・{member.employmentType}</small></article>)}</div></details>;
          })}</div>
        </article>)}</div>
      </section> : <section className="company-locations-view">
        <header><div><small>OFFICE NETWORK</small><h3>拠点一覧</h3><p>国内の支店から海外拠点へ、会社の活動範囲が広がります。</p></div><strong>{unlockedLocations.length}<span>拠点</span></strong></header>
        <div className="company-location-grid">{companyLocations.map((location) => <button type="button" key={location.id} disabled={!location.unlocked} className={`${location.unlocked ? "is-unlocked" : "is-locked"} ${currentLocation.id === location.id ? "is-selected" : ""}`} onClick={() => { setSelectedLocation(location.id); setSelectedEmployee(null); setCompanyView("office"); }}>
          <i>{location.unlocked ? location.icon : "🔒"}</i><span><small>{location.area}</small><strong>{location.name}</strong><em>{location.unlocked ? `${staffedEmployees.filter((employee) => employee.locationId === location.id).length}人・${location.specialty}` : `全社${location.unlockLevel}人で開設`}</em></span>
        </button>)}</div>
        <footer><span>拠点の育ち方</span><p>開設時は本社から2人が出向し、それ以降は現地採用を中心に社員が増えていきます。社員数に固定上限はありません。</p></footer>
      </section>}
      <section className="company-growth-log">
        <header><strong>最近の会社の成長</strong><span><button type="button" onClick={() => setOfficeHistoryOpen(true)}>オフィス履歴を見る</button>参照専用</span></header>
        <div>{gameResults.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((result) => <article key={`${result.task.id}-${result.sourceKey}`}><time>{result.date}</time><strong>{result.task.title}</strong><b>+{result.score}</b></article>)}</div>
      </section>
      <p className="idle-game-readonly-note">この画面からタスク・予定・工数・ステータスを変更することはありません。</p>
      {officeHistoryOpen && createPortal(<div className="company-history-backdrop" onPointerDown={() => setOfficeHistoryOpen(false)}><section className="company-history-window" role="dialog" aria-modal="true" aria-label="オフィスの変化履歴" onPointerDown={(event) => event.stopPropagation()}>
        <header><div><small>OFFICE HISTORY</small><h3>オフィスの変化</h3><p>入社、設備の追加、オフィスの成長を時系列で振り返ります。</p></div><button type="button" aria-label="履歴を閉じる" onClick={() => setOfficeHistoryOpen(false)}>×</button></header>
        <div className="company-history-window-list">{officeChanges.map((change) => <article className={`kind-${change.kind}`} key={change.id}><time>{change.date}</time><i>{change.icon}</i><div><strong>{change.title}</strong><small>{change.detail}</small></div></article>)}{!officeChanges.length && <p>最初の達成からオフィスの歴史が始まります。</p>}</div>
        <footer><span>{officeChanges.length}件の変化</span><button type="button" onClick={() => setOfficeHistoryOpen(false)}>閉じる</button></footer>
      </section></div>, document.body)}
    </div> : <div className="idle-game-view">
      <header className="idle-game-intro">
        <div><small>READ ONLY MODE</small><h2>積み重ねの街</h2><p>今日の対応達成を、街の発展として眺める放置コンテンツです。</p></div>
        <label><input type="checkbox" checked={gameEnabled} onChange={(event) => { setGameEnabled(event.target.checked); localStorage.setItem("chatTaskIdleGameEnabled", String(event.target.checked)); }} /><span>{gameEnabled ? "街を表示中" : "まちづくりを有効にする"}</span></label>
      </header>
      {!gameEnabled ? <section className="idle-game-disabled">
        <div aria-hidden="true">⌂</div><h3>まちづくりは無効です</h3>
        <p>有効化しても、タスク・予定・工数・ステータスは変更しません。完了実績を参照して画面上のスコアを計算するだけです。</p>
      </section> : <>
        <div className="idle-game-dashboard">
          <section className={`idle-game-city city-${cityStage} road-stage-${cityStage}`}>
            <div className="idle-game-map-wrap">
              <div className="idle-game-map" style={{ "--city-grid-size": mapSize } as CSSProperties} aria-label={`${cityRank}。${buildingCount}棟、道路は${roadRank}`}>
                {townTiles.map((tile) => <div className={`idle-game-tile tile-${tile.kind}`} key={tile.index}>
                  {tile.buildingIndex !== undefined && (() => {
                    const place = generatedCityPlaces[tile.buildingIndex];
                    return <button type="button"
                      className={`city-zone zone-${place.type} building-tier-${Math.min(4, Math.floor(tile.buildingIndex / 8) + 1)} ${tile.buildingIndex >= buildingCount - todayGameResults.length ? "is-new" : ""} ${selectedBuilding === tile.buildingIndex ? "is-selected" : ""}`}
                      title={`${place.name}：${place.people}`}
                      aria-label={`${place.name}。${place.people}`}
                      onClick={() => setSelectedBuilding(tile.buildingIndex!)}
                    ><b>{place.icon}</b><span /></button>;
                  })()}
                  {tile.kind === "park" && <i className="city-park-node" title="公園"><b>●</b><span>●</span><em>●</em></i>}
                </div>)}
                <span className="city-resident resident-child" title="学校帰りの子ども">子</span>
                <span className="city-resident resident-adult" title="買い物中の大人">人</span>
                <span className="city-resident resident-senior" title="散歩中の高齢者">老</span>
              </div>
            </div>
            <div className="idle-game-city-legend"><span className="res">住宅</span><span className="com">商業</span><span className="wrk">活動</span><span className="pub">公共</span></div>
            <div className="idle-game-city-tip">表示範囲 {mapSize}×{mapSize}・成長するとカメラが引きます</div>
          </section>
          <aside className="idle-game-side-panel">
            <div className="idle-game-city-copy"><small>{cityRank}</small><strong>街レベル {gameLevel}</strong><p>{todayGameResults.length ? `今日は${todayGameResults.length}件の達成で街が発展しました` : "次の達成を待っています"}</p><span>道路：{roadRank}</span><span>次の発展：{nextDevelopment}</span></div>
            <section className="idle-game-story" aria-live="polite">
              <small>{selectedPlace ? selectedPlace.concept : "今日の街の出来事"}</small>
              <strong>{selectedPlace?.name || "街角だより"}</strong>
              <p>{selectedPlace?.scene || townEvent}</p>
              <span>{selectedPlace ? `ここにいる人：${selectedPlace.people}` : `子ども・大人・高齢者など ${Math.max(3, Math.min(24, Math.floor(population / 300)))}人の姿が見えます`}</span>
              {selectedPlace && <button type="button" onClick={() => setSelectedBuilding(null)}>街全体に戻る</button>}
            </section>
            <section className="idle-game-status">
              <article><small>街の発展度</small><strong>{totalGameScore.toLocaleString()}</strong></article>
              <article><small>人口</small><strong>{population.toLocaleString()}<span>人</span></strong></article>
              <article><small>今日の発展</small><strong>+{todayGameScore.toLocaleString()}</strong></article>
              <article><small>建物</small><strong>{buildingCount}<span>棟</span></strong></article>
              <article><small>高精度な仕事</small><strong>{accurateCount}<span>回</span></strong></article>
              <article className="idle-game-level-progress"><small>次の街レベルまで</small><strong>{500 - levelScore}<span>pt</span></strong><div><i style={{ width: `${levelScore / 5}%` }} /></div></article>
            </section>
          </aside>
        </div>
        <section className="idle-game-log">
          <header><div><strong>最近の街の発展</strong><small>達成で資材100＋工数精度ボーナス最大50</small></div><span>参照専用</span></header>
          <div>{gameResults.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((result) => <article key={`${result.task.id}-${result.sourceKey}`}>
            <time>{result.date}</time><div><strong>{result.task.title}</strong><small>{result.planned > 0 && result.actual > 0 ? `予定 ${hoursLabel(result.planned)} / 実績 ${hoursLabel(result.actual)}・精度 +${result.accuracy}` : "達成ボーナス"}</small></div><b>+{result.score}</b>
          </article>)}{!gameResults.length && <p className="idle-game-empty-log">今日の対応を達成すると、ここに街の発展履歴が表示されます。</p>}</div>
        </section>
        <p className="idle-game-readonly-note">この画面は業務データを参照するだけです。ゲームからタスクへの作成・変更・削除は行いません。</p>
      </>}
    </div>}
  </Modal>;
}
