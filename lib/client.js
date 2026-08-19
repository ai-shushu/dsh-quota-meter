// 会话额度监控（Client 半部）— 浏览器 bundle（ModuleLoader 格式）
// 数据通道：fetch Host 半部的 /quota HTTP 接口。
// UI：
//   - 输入框上方一行：消耗文字 + 「改额度」+「价格」（同一行，文字链接）
//   - 2px 细进度条：覆盖在输入框卡片顶部边框线位置（gap 0），只覆盖直线段
//     （宽 = 卡片宽 - 2×22px）；品牌蓝剩余（deepseek-500，右对齐倒退）+
//     浅蓝消耗痕迹 + Deep diving 同款蓝白流光；耗尽整条红（state-error-primary）
//   - 价格弹层 = 官方 Modal（mask-1+blur、radius 24、border-inverted、
//     bg-layer-2、胶囊按钮、表单字段规范）
//   - 耗尽提示 = 官方 Modal 风格对话框
// 与 cordis.patch.yml 中本 bundle 的行 id 保持一致（quota-meter-shushu）。
window.__ModuleLoader__.load({
	id: "quota-meter-shushu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// 注入动画 keyframes（bundle 加载时执行一次；均为中性色）
		if (typeof document !== "undefined" && !document.getElementById("quota-meter-shushu-flow")) {
			var flowStyle = document.createElement("style");
			flowStyle.id = "quota-meter-shushu-flow";
			flowStyle.textContent = "@keyframes quota-meter-shushu-badge { 0% { opacity: 0; transform: translateY(-3px); } 12% { opacity: 1; transform: translateY(0); } 78% { opacity: 1; } 100% { opacity: 0; } }"
				+ " @keyframes quota-meter-shushu-num { 0% { color: var(--dsw-alias-label-tertiary); transform: translateY(2px); } 100% { color: inherit; transform: translateY(0); } }"
				+ " @keyframes quota-meter-shushu-scan { 0% { left: -50%; } 90%, 100% { left: 100%; } }"
				+ " @keyframes quota-meter-shushu-fadein { 0% { opacity: 0; transform: translateY(-3px); } 100% { opacity: 1; transform: translateY(0); } }"
				+ " @keyframes quota-meter-shushu-breath { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; box-shadow: 0 0 6px currentColor; } }";
			document.head.appendChild(flowStyle);
		}

		var S = {
			// ── 输入框上方的额度条（覆盖卡片顶部边框线的细条 + 文字行）──
			wrap: { position: "relative", zIndex: 2, width: "100%" },
			// 文字行：与进度条同宽同居中（左右边界 = 进度条两端，非对话框边缘）；
			// 已花~徽标 左对齐，改额度/价格 右对齐
			row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", width: "calc(min(var(--dsh-composer-card-max-width), 100% - 32px) - 44px)", margin: "0 auto", padding: "5px 0 7px", fontSize: "12px", lineHeight: "1.4", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" },
			rowLeft: { display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 },
			rowRight: { display: "inline-flex", alignItems: "center", gap: 10, flex: "none" },
			text: { whiteSpace: "nowrap" },
			strong: { color: "var(--dsw-alias-label-primary)", fontWeight: 600, fontVariantNumeric: "tabular-nums" },
			// 2px 细条轨道：宽 = 卡片宽 - 2×22px（只覆盖直线段），透明背景；
			// 着色 = 品牌蓝剩余（右对齐倒退）+ 浅蓝消耗痕迹；danger 整条红
			trackWrap: { display: "flex", justifyContent: "center", width: "100%" },
			// overflow visible：扫描光带向上凸出条外（增强可见性）
			track: { position: "relative", width: "calc(min(var(--dsh-composer-card-max-width), 100% - 32px) - 44px)", height: "2px", borderRadius: "2px", background: "transparent", overflow: "visible" },
			remain: { position: "absolute", right: 0, top: 0, bottom: 0, borderRadius: "2px", background: "var(--dsw-static-deepseek-500)", transition: "width .4s ease" },
			spent: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "2px 0 0 2px", background: "rgba(65, 118, 230, 0.22)", transition: "width .4s ease" },
			set: { display: "inline-flex", alignItems: "center", gap: "6px" },
			// 表单输入（GoalBar objectiveInput 规格）
			input: { height: "26px", padding: "0 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", lineHeight: "20px", outline: "none", width: "64px" },
			link: { background: "none", border: "none", padding: 0, color: "var(--dsw-alias-label-secondary)", fontSize: "12px", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" },
			// 消耗徽标：本次烧掉的金额（琥珀语义色，柔和醒目，黑白界面唯一暖色点缀）
			badge: { flex: "none", display: "inline-block", padding: "0 6px", borderRadius: "999px", background: "var(--dsw-alias-state-warn-tertiary)", color: "var(--dsw-alias-state-warn-primary)", fontSize: "11px", lineHeight: "16px", fontVariantNumeric: "tabular-nums", animation: "quota-meter-shushu-badge 1.2s ease forwards" },
			// Plan 徽标：套餐模型调用不计费，以 "Plan" 代替金额（成功绿）
			planBadge: { flex: "none", display: "inline-block", padding: "0 6px", borderRadius: "999px", background: "var(--dsw-alias-state-success-tertiary)", color: "var(--dsw-alias-state-success-primary)", fontSize: "11px", lineHeight: "16px", fontWeight: 600, animation: "quota-meter-shushu-badge 1.2s ease forwards" },
			// 未配价模型提示徽标（琥珀，点击打开价格弹层）
			unpricedBadge: { flex: "none", display: "inline-flex", alignItems: "center", gap: 3, padding: "0 6px", borderRadius: "999px", background: "var(--dsw-alias-state-warn-tertiary)", color: "var(--dsw-alias-state-warn-primary)", fontSize: "11px", lineHeight: "16px", border: "none", cursor: "pointer" },
			// 峰谷提示（额度条）：高峰 = 琥珀 + 呼吸（警示）；空闲 = 绿色胶囊 + 主色文字，安静静止
			peakBadge: { flex: "none", display: "inline-block", padding: "0 6px", borderRadius: "999px", background: "var(--dsw-alias-state-warn-tertiary)", color: "var(--dsw-alias-state-warn-primary)", fontSize: "11px", lineHeight: "16px", border: "none", cursor: "pointer" },
			peakBadgeActive: { animation: "quota-meter-shushu-fadein .3s ease, quota-meter-shushu-breath 2s ease-in-out .3s infinite" },
			freeBadge: { flex: "none", display: "inline-block", padding: "0 6px", borderRadius: "999px", background: "var(--dsw-alias-state-success-tertiary)", color: "var(--dsw-alias-label-primary)", fontSize: "11px", lineHeight: "16px", border: "none", cursor: "pointer", animation: "quota-meter-shushu-fadein .3s ease" },
			// 弹层卡片峰谷状态点（高峰中 = 琥珀 / 空闲中 = 绿）
			todState: { flex: "none", fontSize: "11px", lineHeight: "16px", padding: "1px 6px", borderRadius: "4px" },
			todStatePeak: { background: "var(--dsw-alias-state-warn-tertiary)", color: "var(--dsw-alias-state-warn-primary)" },
			todStateFree: { background: "color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)", color: "var(--dsw-alias-state-success-primary)" },
			// 按钮（Button 组件规格：胶囊；sm = h28/r14/pad10）
			btnSm: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, height: "28px", padding: "0 10px", border: "none", borderRadius: "14px", background: "transparent", color: "var(--dsw-alias-label-primary)", fontSize: "12px", lineHeight: "18px", cursor: "pointer" },
			btnPrimarySm: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, height: "28px", padding: "0 12px", border: "none", borderRadius: "14px", background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", fontSize: "12px", lineHeight: "18px", cursor: "pointer" },
			btnOutlineSm: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, height: "28px", padding: "0 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "14px", background: "transparent", color: "var(--dsw-alias-label-primary)", fontSize: "12px", lineHeight: "18px", cursor: "pointer" },

			// ── 价格设置 Modal（对齐设置面板设计语言：14/22 正文、12/18 caption、
			// h32 字段、border-l2 发丝线、胶囊按钮、卡片式模型条目）──
			modalRoot: { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" },
			mask: { position: "absolute", inset: 0, background: "var(--dsw-alias-bg-mask-1)", backdropFilter: "var(--dsw-mask-blur)" },
			dialog: { position: "relative", zIndex: 1, display: "flex", flexDirection: "column", width: "min(720px, calc(100vw - 48px))", maxHeight: "min(800px, calc(100vh - 48px))", overflow: "hidden", border: "1px solid var(--dsw-alias-border-inverted)", borderRadius: "24px", background: "var(--dsw-alias-bg-layer-2)", boxShadow: "var(--dsw-shadow-lv3)", color: "var(--dsw-alias-label-primary)", whiteSpace: "normal" },
			header: { flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "22px 14px 12px 24px" },
			title: { margin: 0, fontSize: "16px", lineHeight: "24px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
			close: { flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", border: "none", borderRadius: "28px", background: "transparent", cursor: "pointer", color: "var(--dsw-alias-label-primary)", fontSize: "14px" },
			body: { flex: "1", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: "14px" },
			modalSub: { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			// 弹层顶部未配价模型提示区
			// 未配价模型区：解释行 + 已用段（琥珀）+ 目录段（折叠）
			missingWrap: { display: "flex", flexDirection: "column", gap: "6px" },
			missingExplain: { fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-tertiary)" },
			missingBox: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 8, background: "var(--dsw-alias-state-warn-tertiary)", color: "var(--dsw-alias-state-warn-primary)", fontSize: 12, lineHeight: "18px" },
			// 未配价模型行：模型名（主色，flex 撑开）+ 三个操作按钮（固定列，表格式对齐）
			missingRow: { display: "flex", alignItems: "center", gap: 10 },
			missingModel: { flex: "1 1 auto", minWidth: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			missingFix: { flex: "none", width: "48px", textAlign: "left", border: "none", background: "none", padding: 0, color: "var(--dsw-alias-state-warn-primary)", fontSize: 12, cursor: "pointer" },
			// 忽略未配价模型（品牌蓝，逐个操作，持久化）
			missingIgnore: { flex: "none", width: "48px", textAlign: "left", border: "none", background: "none", padding: 0, color: "var(--dsw-static-deepseek-500)", fontSize: 12, cursor: "pointer" },
			// Plan：套餐模型（成功绿，调用不计费）
			missingPlan: { flex: "none", width: "48px", textAlign: "left", border: "none", background: "none", padding: 0, color: "var(--dsw-alias-state-success-primary)", fontSize: 12, cursor: "pointer" },
			// 目录段：全部可用模型里未配价的（折叠 + 分组 + 内部滚动）
			missingCatalog: { display: "flex", flexDirection: "column", gap: 4, border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: "6px 10px" },
			catalogToggle: { border: "none", background: "none", padding: 0, textAlign: "left", color: "var(--dsw-static-deepseek-500)", fontSize: 12, lineHeight: "18px", fontWeight: 600, cursor: "pointer" },
			catalogList: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto", paddingTop: 4 },
			catalogGroup: { display: "flex", flexDirection: "column", gap: 4 },
			catalogGroupName: { fontSize: "11px", fontWeight: 600, lineHeight: "16px", color: "var(--dsw-alias-label-secondary)" },
			// 已忽略/已 Plan 管理区：取消标记按钮（灰）
			markedCancel: { flex: "none", width: "72px", textAlign: "left", border: "none", background: "none", padding: 0, color: "var(--dsw-alias-label-tertiary)", fontSize: 12, cursor: "pointer" },
			// 模型卡片（对齐设置页 rowCard：border-l2 + r12 + 卡片内 gap）
			modelCard: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "12px" },
			modelHead: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" },
			// 折叠展开箭头：纯视觉提示，整行可点击切换
			chevron: { flex: "none", width: "14px", textAlign: "center", fontSize: "11px", lineHeight: "16px", color: "var(--dsw-alias-label-secondary)" },
			modelName: { flex: "1 1 auto", minWidth: 0, fontSize: "14px", lineHeight: "22px", fontWeight: 500, color: "var(--dsw-alias-label-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			pill: { flex: "none", fontSize: "11px", lineHeight: "16px", padding: "1px 6px", border: "1px solid var(--dsw-alias-border-l3)", borderRadius: "4px", color: "var(--dsw-alias-label-secondary)" },
			modelProvider: { flex: "none", fontSize: "11px", lineHeight: "16px", padding: "1px 6px", borderRadius: "4px", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)" },
			// 价格三档：label 在上、input 在下，3 列网格
			priceGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" },
			priceField: { display: "flex", flexDirection: "column", gap: "4px" },
			priceFieldLabel: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
			priceInput: { boxSizing: "border-box", width: "100%", height: "32px", padding: "0 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "14px", lineHeight: "22px", outline: "none", textAlign: "right", fontVariantNumeric: "tabular-nums" },
			groupLabel: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, color: "var(--dsw-alias-label-secondary)" },
			// 峰谷时段
			todRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
			todLabel: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" },
			todSep: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
			tinyInput: { boxSizing: "border-box", width: "44px", height: "32px", padding: "0 6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "14px", lineHeight: "22px", outline: "none", textAlign: "center", fontVariantNumeric: "tabular-nums" },
			tzInput: { boxSizing: "border-box", flex: "1 1 130px", minWidth: 90, height: "32px", padding: "0 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "14px", lineHeight: "22px", outline: "none" },
			// 添加模型（editor 卡片风格：bg-module-platform + r12）
			editorCard: { borderRadius: "12px", background: "var(--dsw-alias-bg-module-platform)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" },
			editorTitle: { fontSize: "14px", lineHeight: "22px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
			field: { display: "flex", flexDirection: "column", gap: "6px" },
			fieldLabel: { fontSize: "12px", lineHeight: "18px", fontWeight: 500, color: "var(--dsw-alias-label-secondary)" },
			textInput: { boxSizing: "border-box", width: "100%", height: "32px", padding: "0 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "14px", lineHeight: "22px", outline: "none" },
			addRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
			modalErr: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px", lineHeight: "18px", margin: 0 },
			modalActions: { flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", borderTop: "1px solid var(--dsw-alias-border-l2)" },

			// ── 耗尽对话框（官方 Modal 风格）──
			toastDialog: { position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "14px", width: "min(340px, 100%)", padding: "0 0 20px", border: "1px solid var(--dsw-alias-border-inverted)", borderRadius: "24px", background: "var(--dsw-alias-bg-layer-2)", boxShadow: "var(--dsw-shadow-lv3)", fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" },
			toastTitle: { margin: 0, fontSize: "16px", lineHeight: "24px", fontWeight: 500, color: "var(--dsw-alias-state-error-primary)" },
			toastText: { margin: 0, fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" },
			toastActions: { display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 24px 0", borderTop: "1px solid var(--dsw-alias-border-l2)" }
		};

		function fmt(v) {
			if (!Number.isFinite(v)) return "0.00";
			return v >= 0.005 ? v.toFixed(2) : v.toFixed(4);
		}

		// 剩余金额固定 4 位小数：大额度下消耗差异（如 ¥4.9999）也可见
		function fmt4(v) {
			return Number.isFinite(v) ? v.toFixed(4) : "0.0000";
		}

		function stateUrl(sessionId) {
			return "/quota/state?sessionId=" + encodeURIComponent(sessionId);
		}

		// ---------- 额度条 + 设置（conversation.input.dock） ----------
		function QuotaMeter(props) {
			var sessionId = props.sessionId;
			var stateHook = react.useState(null);
			var state = stateHook[0];
			var setState = stateHook[1];
			var draftHook = react.useState("5");
			var draft = draftHook[0];
			var setDraft = draftHook[1];
			var editingHook = react.useState(false);
			var editing = editingHook[0];
			var setEditing = editingHook[1];

			// 价格设置 Modal 状态
			var pricesOpenHook = react.useState(false);
			var pricesOpen = pricesOpenHook[0];
			var setPricesOpen = pricesOpenHook[1];
			var pricesDraftHook = react.useState(null);
			var pricesDraft = pricesDraftHook[0];
			var setPricesDraft = pricesDraftHook[1];
			var pricesErrHook = react.useState("");
			var pricesErr = pricesErrHook[0];
			var setPricesErr = pricesErrHook[1];
			var addHook = react.useState({ name: "", provider: "", miss: "", hit: "", out: "", tod: false, peakMiss: "", peakHit: "", peakOut: "", tz: "Asia/Shanghai", p0s: "9", p0e: "12", p1s: "14", p1e: "18" });
			var add = addHook[0];
			var setAdd = addHook[1];
			// 模型卡片展开状态：collapsed[name] 为 true 表示展开；缺省折叠
			var collapsedHook = react.useState({});
			var collapsed = collapsedHook[0];
			var setCollapsed = collapsedHook[1];
			// 目录中未配价的完整模型清单（按 provider 分组；打开弹层时扫描一次）
			var catalogHook = react.useState([]);
			var catalogUnpriced = catalogHook[0];
			var setCatalogUnpriced = catalogHook[1];
			// 目录段展开状态（默认折叠）
			var catalogOpenHook = react.useState(false);
			var catalogOpen = catalogOpenHook[0];
			var setCatalogOpen = catalogOpenHook[1];
			// 已忽略/已 Plan 管理区展开状态（默认折叠）
			var markedOpenHook = react.useState(false);
			var markedOpen = markedOpenHook[0];
			var setMarkedOpen = markedOpenHook[1];
			// 峰谷模型当前时段状态（host 按模型 tod 计算，供弹层卡片标注）
			var todStatusHook = react.useState({});
			var todStatus = todStatusHook[0];
			var setTodStatus = todStatusHook[1];

			// 消耗反馈：检测 spent 增量 → 徽标（本次金额）+ 剩余数字滚动
			var prevSpent = react.useRef(null);
			var badgeHook = react.useState(0);
			var badgeTick = badgeHook[0];
			var setBadgeTick = badgeHook[1];
			var lastDeltaHook = react.useState(0);
			var lastDelta = lastDeltaHook[0];
			var setLastDelta = lastDeltaHook[1];
			// Plan 徽标：套餐调用不计费，planTick 变化时显示 "Plan"
			var planBadgeHook = react.useState(0);
			var planBadgeTick = planBadgeHook[0];
			var setPlanBadgeTick = planBadgeHook[1];
			var prevPlanTick = react.useRef(null);

			react.useEffect(function () {
				var alive = true;
				var refresh = async function () {
					try {
						var r = await window.fetch(stateUrl(sessionId)).then(function (x) { return x.json(); });
						if (alive) setState(r);
					} catch (err) { console.error("[quota] get failed", err); }
				};
				refresh();
				var timer = window.setInterval(refresh, 1000);
				return function () { alive = false; window.clearInterval(timer); };
			}, [sessionId]);

			// 消耗时记录增量并递增 tick（徽标/数字动画重放）；Plan 调用发 Plan 徽标
			react.useEffect(function () {
				if (state === null) return;
				var s = Number(state.spent) || 0;
				if (prevSpent.current !== null && s > prevSpent.current) {
					setLastDelta(s - prevSpent.current);
					setBadgeTick(function (n) { return n + 1; });
				}
				prevSpent.current = s;
				if (state.planTick !== undefined && prevPlanTick.current !== null && state.planTick !== prevPlanTick.current) {
					setPlanBadgeTick(function (n) { return n + 1; });
				}
				prevPlanTick.current = state.planTick;
			}, [state]);

			var applyQuota = async function (amount) {
				var n = Number(amount);
				if (!Number.isFinite(n) || n <= 0) return;
				try {
					var r = await window.fetch("/quota/set?sessionId=" + encodeURIComponent(sessionId), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ amount: n })
					}).then(function (x) { return x.json(); });
					if (r && r.ok) {
						setState({ quota: r.quota, spent: r.spent, calls: r.calls, exhausted: r.exhausted, unit: r.unit });
						setEditing(false);
					}
				} catch (err) { console.error("[quota] set failed", err); }
			};

			// ---- 价格设置 ----
			// 加载价目表 + 目录未配价清单（打开弹层与标记操作后共用）
			var loadPricesData = async function () {
				try {
					var r = await window.fetch("/quota/prices?sessionId=" + encodeURIComponent(sessionId)).then(function (x) { return x.json(); });
					if (r && r.prices) setPricesDraft(JSON.parse(JSON.stringify(r.prices)));
					if (r && r.catalogUnpriced) setCatalogUnpriced(r.catalogUnpriced);
					if (r && r.todStatus) setTodStatus(r.todStatus);
					return true;
				} catch (err) { setPricesErr("加载价目表失败"); return false; }
			};

			var openPrices = async function () {
				setPricesOpen(true);
				setPricesErr("");
				setCollapsed({});
				setCatalogOpen(false);
				setMarkedOpen(false);
				await loadPricesData();
			};

			var closePrices = function () {
				setPricesOpen(false);
				setPricesErr("");
			};

			var savePrices = async function () {
				setPricesErr("");
				try {
					var r = await window.fetch("/quota/prices", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(pricesDraft)
					}).then(function (x) { return x.json(); });
					if (r && r.ok) {
						setPricesDraft(JSON.parse(JSON.stringify(r.prices)));
						setPricesOpen(false);
					} else {
						setPricesErr((r && r.reason) || "保存失败");
					}
				} catch (err) { setPricesErr("保存失败"); }
			};

			var resetPrices = async function () {
				setPricesErr("");
				try {
					var r = await window.fetch("/quota/prices", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ reset: true })
					}).then(function (x) { return x.json(); });
					if (r && r.prices) setPricesDraft(JSON.parse(JSON.stringify(r.prices)));
				} catch (err) { setPricesErr("恢复默认失败"); }
			};

			// 通用价格字段更新：key 形如 "inputMiss" 或 "default.inputMiss"/"peak.inputMiss"
			var setModelField = function (name, key, value) {
				setPricesDraft(function (prev) {
					var models = Object.assign({}, prev.models);
					var entry = Object.assign({}, models[name]);
					var prices = Object.assign({}, entry.prices);
					var parts = key.split(".");
					if (parts.length === 2) {
						var group = Object.assign({}, prices[parts[0]] || {});
						group[parts[1]] = value;
						prices[parts[0]] = group;
					} else {
						prices[parts[0]] = value;
					}
					entry.prices = prices;
					models[name] = entry;
					return Object.assign({}, prev, { models: models });
				});
			};

			// 峰谷时段字段更新：key = 'tz' | '0s' | '0e' | '1s' | '1e'
			var setTodField = function (name, key, value) {
				setPricesDraft(function (prev) {
					var models = Object.assign({}, prev.models);
					var entry = Object.assign({}, models[name]);
					var tod = Object.assign({ tz: "Asia/Shanghai", peak: [[9, 12], [14, 18]] }, entry.tod || {});
					if (key === "tz") {
						tod.tz = value;
					} else {
						var idx = Number(key[0]);
						var isStart = key[1] === "s";
						var peak = tod.peak.map(function (w) { return w.slice(); });
						while (peak.length <= idx) peak.push([0, 0]);
						peak[idx][isStart ? 0 : 1] = value;
						tod.peak = peak;
					}
					entry.tod = tod;
					models[name] = entry;
					return Object.assign({}, prev, { models: models });
				});
			};

			var addModel = function () {
				var name = add.name.trim();
				if (!name) return;
				setPricesDraft(function (prev) {
					var models = Object.assign({}, prev.models);
					if (add.tod) {
						models[name] = {
							provider: add.provider.trim(),
							pricing: "per-token-tod",
							tod: { tz: add.tz || "Asia/Shanghai", peak: [[Number(add.p0s), Number(add.p0e)], [Number(add.p1s), Number(add.p1e)]] },
							prices: {
								default: { inputMiss: add.miss, inputHit: add.hit, output: add.out },
								peak: { inputMiss: add.peakMiss, inputHit: add.peakHit, output: add.peakOut }
							}
						};
					} else {
						models[name] = {
							provider: add.provider.trim(),
							pricing: "per-token",
							prices: { inputMiss: add.miss, inputHit: add.hit, output: add.out }
						};
					}
					return Object.assign({}, prev, { models: models, fallback: prev.fallback || name });
				});
				setAdd({ name: "", provider: "", miss: "", hit: "", out: "", tod: false, peakMiss: "", peakHit: "", peakOut: "", tz: "Asia/Shanghai", p0s: "9", p0e: "12", p1s: "14", p1e: "18" });
			};

			var removeModel = function (name) {
				setPricesDraft(function (prev) {
					var models = Object.assign({}, prev.models);
					delete models[name];
					if (Object.keys(models).length === 0) return prev;
					var fallback = prev.fallback === name ? Object.keys(models)[0] : prev.fallback;
					return Object.assign({}, prev, { models: models, fallback: fallback });
				});
				// 同步清理折叠状态
				setCollapsed(function (prev) {
					if (!prev[name]) return prev;
					var next = Object.assign({}, prev);
					delete next[name];
					return next;
				});
			};

			// 切换模型卡片的展开/折叠
			var toggleModel = function (name) {
				setCollapsed(function (prev) {
					var next = Object.assign({}, prev);
					if (next[name]) delete next[name];
					else next[name] = true;
					return next;
				});
			};

			// 忽略某个未配价模型（持久化到价目表，按默认价粗算且不再提示）
			var ignoreModel = async function (name) {
				setPricesErr("");
				try {
					var r = await window.fetch("/quota/prices", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ ignore: name })
					}).then(function (x) { return x.json(); });
					if (r && r.prices) await loadPricesData();
					else setPricesErr((r && r.reason) || "忽略失败");
				} catch (err) { setPricesErr("忽略失败"); }
			};

			// 标记某模型为套餐（持久化到价目表，调用不计费，不再提示）
			var planModel = async function (name) {
				setPricesErr("");
				try {
					var r = await window.fetch("/quota/prices", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ plan: name })
					}).then(function (x) { return x.json(); });
					if (r && r.prices) await loadPricesData();
					else setPricesErr((r && r.reason) || "标记失败");
				} catch (err) { setPricesErr("标记失败"); }
			};

			// 取消忽略（该模型回到未配价提示）
			var unignoreModel = async function (name) {
				setPricesErr("");
				try {
					var r = await window.fetch("/quota/prices", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ unignore: name })
					}).then(function (x) { return x.json(); });
					if (r && r.prices) await loadPricesData();
					else setPricesErr((r && r.reason) || "取消忽略失败");
				} catch (err) { setPricesErr("取消忽略失败"); }
			};

			// 取消 Plan（该模型回到未配价提示）
			var unplanModel = async function (name) {
				setPricesErr("");
				try {
					var r = await window.fetch("/quota/prices", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ unplan: name })
					}).then(function (x) { return x.json(); });
					if (r && r.prices) await loadPricesData();
					else setPricesErr((r && r.reason) || "取消 Plan 失败");
				} catch (err) { setPricesErr("取消 Plan 失败"); }
			};

			// 单个价格字段：label 在上、input 在下
			var priceField = function (label, value, onChange) {
				return react.createElement("div", { style: S.priceField },
					react.createElement("span", { style: S.priceFieldLabel }, label),
					react.createElement("input", { style: S.priceInput, value: value == null ? "" : String(value), onChange: onChange })
				);
			};
			// 三档价格网格（未命中 / 命中 / 输出）
			var priceGrid = function (name, group) {
				var keyOf = function (f) { return group ? group + "." + f : f; };
				var entry = pricesDraft.models[name];
				var p = group ? (entry.prices[group] || {}) : entry.prices;
				return react.createElement("div", { style: S.priceGrid },
					priceField("未命中", p.inputMiss, function (e) { setModelField(name, keyOf("inputMiss"), e.target.value); }),
					priceField("命中", p.inputHit, function (e) { setModelField(name, keyOf("inputHit"), e.target.value); }),
					priceField("输出", p.output, function (e) { setModelField(name, keyOf("output"), e.target.value); })
				);
			};

			var pricesModal = function () {
				if (!pricesOpen || pricesDraft === null) return null;
				var entries = Object.entries(pricesDraft.models || {});
				var addPriceGrid = function (v1, v2, v3, setV1, setV2, setV3) {
					return react.createElement("div", { style: S.priceGrid },
						priceField("未命中", v1, function (e) { setV1(e.target.value); }),
						priceField("命中", v2, function (e) { setV2(e.target.value); }),
						priceField("输出", v3, function (e) { setV3(e.target.value); })
					);
				};
				var todRow = function (name, m) {
					var tod = Object.assign({ tz: "Asia/Shanghai", peak: [[9, 12], [14, 18]] }, m.tod || {});
					var peak = tod.peak || [];
					var w0 = peak[0] || [9, 12];
					var w1 = peak[1] || [14, 18];
					var numInput = function (key, v) {
						return react.createElement("input", { style: S.tinyInput, value: String(v), onChange: function (e) { setTodField(name, key, e.target.value); } });
					};
					return react.createElement("div", { style: S.todRow },
						react.createElement("span", { style: S.todLabel }, "高峰时段"),
						numInput("0s", w0[0]),
						react.createElement("span", { style: S.todSep }, "–"),
						numInput("0e", w0[1]),
						numInput("1s", w1[0]),
						react.createElement("span", { style: S.todSep }, "–"),
						numInput("1e", w1[1]),
						react.createElement("input", { style: S.tzInput, placeholder: "时区", value: tod.tz || "", onChange: function (e) { setTodField(name, "tz", e.target.value); } })
					);
				};
				var addTodRow = function () {
					var bind = function (k) { return function (e) { setAdd(Object.assign({}, add, (_b = {}, _b[k] = e.target.value, _b))); }; };
					return react.createElement("div", { style: S.todRow },
						react.createElement("span", { style: S.todLabel }, "高峰时段"),
						react.createElement("input", { style: S.tinyInput, value: add.p0s, onChange: bind("p0s") }),
						react.createElement("span", { style: S.todSep }, "–"),
						react.createElement("input", { style: S.tinyInput, value: add.p0e, onChange: bind("p0e") }),
						react.createElement("input", { style: S.tinyInput, value: add.p1s, onChange: bind("p1s") }),
						react.createElement("span", { style: S.todSep }, "–"),
						react.createElement("input", { style: S.tinyInput, value: add.p1e, onChange: bind("p1e") }),
						react.createElement("input", { style: S.tzInput, placeholder: "时区", value: add.tz, onChange: bind("tz") })
					);
				};
				return react.createElement("div", { style: S.modalRoot, onClick: closePrices },
					react.createElement("div", { style: S.mask }),
					react.createElement("div", { style: S.dialog, onClick: function (e) { e.stopPropagation(); } },
						react.createElement("div", { style: S.header },
							react.createElement("h2", { style: S.title }, "价格设置"),
							react.createElement("button", { style: S.close, onClick: closePrices }, "✕")
						),
						react.createElement("div", { style: S.body },
							react.createElement("p", { style: S.modalSub }, "单位 " + (pricesDraft.unit || "¥") + " / 每 " + (pricesDraft.per || "1M") + " tokens。未命中 / 命中 / 输出三档计价；「峰谷」模型按自己的高峰时段选档（DeepSeek：北京时间 9–12、14–18）。"),
							(function () {
								// 未配价模型提示：已用段（本会话用过的，琥珀）+ 目录段（全部可用模型，折叠）
								var used = (state && state.unpricedModels) ? state.unpricedModels : [];
								var priced = pricesDraft.models || {};
								var ignored = pricesDraft.ignored || [];
								var plans = pricesDraft.plans || [];
								var usedMissing = used.filter(function (m) {
									return !priced[m] && ignored.indexOf(m) < 0 && plans.indexOf(m) < 0;
								});
								var catalogGroups = catalogUnpriced || [];
								var catalogCount = 0;
								catalogGroups.forEach(function (g) { catalogCount += (g.models || []).length; });
								if (usedMissing.length === 0 && catalogCount === 0) return null;
								// 三个操作按钮（补配=自己填价 / 忽略=默认价粗算 / Plan=套餐不计费）；
								// 模型名占左列（省略号），三按钮固定列对齐
								var actionRow = function (m, provider) {
									return react.createElement("div", { key: m, style: S.missingRow },
										react.createElement("span", { style: S.missingModel, title: m }, m),
										react.createElement("button", { style: S.missingFix, title: "按你填写的价格计费", onClick: function () { setAdd(Object.assign({}, add, { name: m, provider: provider || add.provider })); } }, "补配"),
										react.createElement("button", { style: S.missingIgnore, title: "按默认价粗略计费，不再提示", onClick: function () { ignoreModel(m); } }, "忽略"),
										react.createElement("button", { style: S.missingPlan, title: "套餐模型，调用不产生费用", onClick: function () { planModel(m); } }, "Plan")
									);
								};
								return react.createElement("div", { style: S.missingWrap },
									react.createElement("div", { style: S.missingExplain }, "未配置价格的模型：补配=按你填写的价格计费 · 忽略=按默认价粗略计费且不再提示 · Plan=套餐模型不产生费用"),
									usedMissing.length > 0
										? react.createElement("div", { style: S.missingBox },
											react.createElement("span", null, "本次会话用过的未配价模型（当前按 fallback 计价）："),
											usedMissing.map(function (m) { return actionRow(m, ""); })
										)
										: null,
									catalogCount > 0
										? react.createElement("div", { style: S.missingCatalog },
											react.createElement("button", { style: S.catalogToggle, onClick: function () { setCatalogOpen(function (v) { return !v; }); } },
												(catalogOpen ? "▾" : "▸") + " 还有 " + catalogCount + " 个可用模型未配价"
											),
											catalogOpen
												? react.createElement("div", { style: S.catalogList },
													catalogGroups.map(function (g) {
														return react.createElement("div", { key: g.provider, style: S.catalogGroup },
															react.createElement("div", { style: S.catalogGroupName }, g.providerName || g.provider),
															(g.models || []).map(function (m) { return actionRow(m, g.provider); })
														);
													})
												)
												: null
										)
										: null
								);
							})(),
							(function () {
								// 已忽略 / 已 Plan 管理区：可查看并逐个取消标记（操作可逆）
								var ignoredList = pricesDraft.ignored || [];
								var plansList = pricesDraft.plans || [];
								if (ignoredList.length === 0 && plansList.length === 0) return null;
								var markedRow = function (m, isPlan) {
									return react.createElement("div", { key: m, style: S.missingRow },
										react.createElement("span", { style: S.missingModel, title: m }, m),
										react.createElement("button", { style: S.missingFix, title: "按你填写的价格计费", onClick: function () { setAdd(Object.assign({}, add, { name: m })); } }, "补配"),
										react.createElement("button", { style: S.markedCancel, title: isPlan ? "取消 Plan，回到未配价提示" : "取消忽略，回到未配价提示", onClick: function () { if (isPlan) unplanModel(m); else unignoreModel(m); } }, isPlan ? "取消 Plan" : "取消忽略")
									);
								};
								return react.createElement("div", { style: S.missingCatalog },
									react.createElement("button", { style: S.catalogToggle, onClick: function () { setMarkedOpen(function (v) { return !v; }); } },
										(markedOpen ? "▾" : "▸") + " 已忽略 " + ignoredList.length + " · Plan " + plansList.length
									),
									markedOpen
										? react.createElement("div", { style: S.catalogList },
											ignoredList.length > 0
												? react.createElement("div", { key: "ig", style: S.catalogGroup },
													react.createElement("div", { style: S.catalogGroupName }, "已忽略（按默认价粗略计费）"),
													ignoredList.map(function (m) { return markedRow(m, false); })
												)
												: null,
											plansList.length > 0
												? react.createElement("div", { key: "pl", style: S.catalogGroup },
													react.createElement("div", { style: S.catalogGroupName }, "Plan（套餐，不计费）"),
													plansList.map(function (m) { return markedRow(m, true); })
												)
												: null
										)
										: null
								);
							})(),
							entries.map(function (entry) {
								var name = entry[0];
								var m = entry[1];
								var tod = m.pricing === "per-token-tod";
								var isOpen = !!collapsed[name];
								return react.createElement("div", { key: name, style: S.modelCard },
									react.createElement("div", { style: S.modelHead, title: isOpen ? "折叠" : "展开", onClick: function () { toggleModel(name); } },
										react.createElement("span", { style: S.chevron }, isOpen ? "▾" : "▸"),
										react.createElement("span", { style: S.modelName }, name),
										tod ? react.createElement("span", { style: S.pill }, "峰谷") : null,
										tod && todStatus && todStatus[name]
											? react.createElement("span", { style: Object.assign({}, S.todState, todStatus[name].peak ? S.todStatePeak : S.todStateFree) }, todStatus[name].peak ? "● 高峰中" : "● 空闲中")
											: null,
										m.provider ? react.createElement("span", { style: S.modelProvider }, m.provider) : null,
										react.createElement("div", { style: { flex: 1 } }),
										react.createElement("button", { style: S.btnSm, onClick: function (e) { e.stopPropagation(); removeModel(name); } }, "删除")
									),
									isOpen
										? (tod
											? react.createElement(react.Fragment, null,
												react.createElement("span", { style: S.groupLabel }, "空闲"),
												priceGrid(name, "default"),
												react.createElement("span", { style: S.groupLabel }, "高峰"),
												priceGrid(name, "peak"),
												todRow(name, m)
											)
											: priceGrid(name, null))
										: null
								);
							}),
							react.createElement("div", { style: S.editorCard },
								react.createElement("span", { style: S.editorTitle }, "添加模型"),
								react.createElement("div", { style: S.field },
									react.createElement("span", { style: S.fieldLabel }, "模型名"),
									react.createElement("input", { style: S.textInput, placeholder: "例如 glm-5.2", value: add.name, onChange: function (e) { setAdd(Object.assign({}, add, { name: e.target.value })); } })
								),
								react.createElement("div", { style: S.field },
									react.createElement("span", { style: S.fieldLabel }, "平台"),
									react.createElement("input", { style: S.textInput, placeholder: "例如 zhipu", value: add.provider, onChange: function (e) { setAdd(Object.assign({}, add, { provider: e.target.value })); } })
								),
								react.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", cursor: "pointer", width: "fit-content" } },
									react.createElement("input", { type: "checkbox", checked: !!add.tod, onChange: function (e) { setAdd(Object.assign({}, add, { tod: e.target.checked })); } }),
									"峰谷价"
								),
								add.tod
									? react.createElement(react.Fragment, null,
										react.createElement("span", { style: S.groupLabel }, "空闲"),
										addPriceGrid(add.miss, add.hit, add.out,
											function (v) { setAdd(Object.assign({}, add, { miss: v })); },
											function (v) { setAdd(Object.assign({}, add, { hit: v })); },
											function (v) { setAdd(Object.assign({}, add, { out: v })); }),
										react.createElement("span", { style: S.groupLabel }, "高峰"),
										addPriceGrid(add.peakMiss, add.peakHit, add.peakOut,
											function (v) { setAdd(Object.assign({}, add, { peakMiss: v })); },
											function (v) { setAdd(Object.assign({}, add, { peakHit: v })); },
											function (v) { setAdd(Object.assign({}, add, { peakOut: v })); }),
										addTodRow()
									)
									: addPriceGrid(add.miss, add.hit, add.out,
										function (v) { setAdd(Object.assign({}, add, { miss: v })); },
										function (v) { setAdd(Object.assign({}, add, { hit: v })); },
										function (v) { setAdd(Object.assign({}, add, { out: v })); }),
								react.createElement("div", null,
									react.createElement("button", { style: S.btnOutlineSm, onClick: addModel }, "添加")
								)
							),
							pricesErr ? react.createElement("div", { style: S.modalErr }, pricesErr) : null
						),
						react.createElement("div", { style: S.modalActions },
							react.createElement("button", { style: S.btnSm, onClick: resetPrices }, "恢复默认"),
							react.createElement("div", { style: { flex: 1 } }),
							react.createElement("button", { style: S.btnOutlineSm, onClick: closePrices }, "取消"),
							react.createElement("button", { style: S.btnPrimarySm, onClick: savePrices }, "保存")
						)
					)
				);
			};

			if (state === null) {
				return react.createElement("div", { style: S.wrap },
					react.createElement("div", { style: S.row }, "额度加载中…")
				);
			}

			var unit = state.unit || "¥";
			var calls = Number(state.calls) || 0;
			var callsText = calls > 0 ? "（" + calls + " 次调用）" : "";
			var spentText = "已花 " + unit + fmt(state.spent) + callsText;

			// 当前模型未配价提示（琥珀徽标，锚定当前会话选中的模型；
			// 切换到配价模型后自动消失，历史未配价记录在价格弹层管理）
			var currentModel = state.currentModel || "";
			var unpricedBadge = state.currentUnpriced
				? react.createElement("button", { style: S.unpricedBadge, onClick: openPrices, title: "当前模型 " + currentModel + " 未配置价格，按 fallback 计价" }, "⚠ " + currentModel + " 未配价")
				: null;

			// 未设置额度：已花 左对齐，设置控件 + 价格 右对齐（无进度条）
			if (state.quota === null || state.quota <= 0) {
				return react.createElement("div", { style: S.wrap },
					react.createElement("div", { style: S.row },
						react.createElement("span", { style: S.rowLeft },
							react.createElement("span", { style: S.text },
								react.createElement("strong", { style: S.strong }, spentText),
								" · 未设置额度"
							),
							unpricedBadge
						),
						react.createElement("span", { style: S.rowRight },
							react.createElement("div", { style: S.set },
								react.createElement("span", { style: { fontSize: "13px", color: "var(--dsw-alias-label-secondary)" } }, unit),
								react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); }, placeholder: "5.00" }),
								react.createElement("button", { style: S.btnPrimarySm, onClick: function () { applyQuota(draft); } }, "设置")
							),
							react.createElement("button", { style: S.link, onClick: openPrices }, "价格"),
							pricesModal()
						)
					)
				);
			}

			var quota = Number(state.quota) || 0;
			var spent = Number(state.spent) || 0;
			var danger = !!state.exhausted || spent >= quota;
			var remaining = Math.max(0, quota - spent);
			var ratio = danger ? 0 : Math.max(0, Math.min(1, remaining / quota));
			var spentRatio = danger ? 0 : Math.max(0, Math.min(1, spent / quota));

			var textNode = danger
				? react.createElement("span", { style: Object.assign({}, S.text, { color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 }) },
					"额度已用完 " + unit + fmt(spent) + " / " + unit + fmt(quota)
				)
				: react.createElement("span", { style: S.text },
					unit,
					// 剩余金额（4 位小数）+ 数字滚动动画
					react.createElement("strong", { key: badgeTick, style: Object.assign({}, S.strong, { display: "inline-block", animation: badgeTick > 0 ? "quota-meter-shushu-num .35s ease" : undefined }) },
						fmt4(remaining)
					),
					"/" + unit + fmt(quota)
				);

			// 细条：品牌蓝剩余（右对齐倒退）+ 浅蓝消耗痕迹；danger 整条红。
			// 无自身动效（扫描光带是唯一的请求中动效，避免干扰）
			var remainStyle = Object.assign({}, S.remain, {
				width: (ratio * 100) + "%",
				background: "var(--dsw-static-deepseek-500)"
			});
			var spentStyle = Object.assign({}, S.spent, { width: (spentRatio * 100) + "%" });
			var trackStyle = Object.assign({}, S.track);
			if (danger) trackStyle.background = "color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent)";
			// 消耗徽标（A）：本次烧掉的金额，弹出后淡出（与额度大小无关）
			var badge = badgeTick > 0
				? react.createElement("span", { key: badgeTick, style: S.badge }, "-" + unit + fmt(lastDelta))
				: null;
			// Plan 徽标（B）：套餐调用不计费，以 "Plan" 代替金额
			var planBadge = planBadgeTick > 0
				? react.createElement("span", { key: "plan" + planBadgeTick, style: S.planBadge }, "Plan")
				: null;
			// 峰谷徽标（C）：当前模型高峰时段 = ⚡ 高峰价（琥珀呼吸）/ 空闲 = 空闲价（静态）
			var peakBadge = state.peak === true
				? react.createElement("button", { key: "peak-on", style: Object.assign({}, S.peakBadge, S.peakBadgeActive), onClick: openPrices, title: "当前为高峰时段，按高峰价计费（点击查看价格）" }, "⚡ 高峰价")
				: state.peak === false
					? react.createElement("button", { key: "peak-off", style: S.freeBadge, onClick: openPrices, title: "当前为空闲时段，按空闲价计费（点击查看价格）" }, "空闲价")
					: null;

			// 请求中蓝色扫描（Deep diving 同款）：只扫【剩余段】——扫描容器与
			// 剩余段同位置同宽（右对齐），从消耗边界向右扫到右端。
			// 光带宽：剩余 >1/10 时固定 30px；≤1/10 时自适应（剩余段一半宽）
			var inflight = !!state.inflight;
			var scanCageStyle = {
				position: "absolute", right: 0, top: "-1px", width: (ratio * 100) + "%",
				height: "4px", overflow: "hidden", pointerEvents: "none", zIndex: 2
			};
			var scanBandStyle = {
				position: "absolute", top: 0, bottom: 0, left: 0,
				width: ratio <= 0.1 ? "50%" : "30px",
				background: "linear-gradient(90deg, transparent 0%, var(--dsw-static-deepseek-500) 30%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 70%, transparent 100%)",
				animation: "quota-meter-shushu-scan 1.8s linear infinite"
			};

			return react.createElement("div", { style: Object.assign({}, S.wrap, { marginBottom: "-8px" }) },
				react.createElement("div", { style: S.row },
					react.createElement("span", { style: S.rowLeft },
						textNode,
						peakBadge,
						unpricedBadge,
						badge,
						planBadge
					),
					react.createElement("span", { style: S.rowRight },
						editing
							? react.createElement("div", { style: S.set },
								react.createElement("span", { style: { fontSize: "13px", color: "var(--dsw-alias-label-secondary)" } }, unit),
								react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); } }),
								react.createElement("button", { style: S.btnPrimarySm, onClick: function () { applyQuota(draft); } }, "确认")
							)
							: react.createElement("button", { style: S.link, onClick: function () { setDraft(fmt(quota)); setEditing(true); } }, "改额度"),
						react.createElement("button", { style: S.link, onClick: openPrices }, "价格"),
						pricesModal()
					)
				),
				react.createElement("div", { style: S.trackWrap },
					react.createElement("div", { style: trackStyle },
						!danger && react.createElement("div", { style: spentStyle }),
						!danger && react.createElement("div", { style: remainStyle }),
						!danger && inflight && react.createElement("div", { style: scanCageStyle },
							react.createElement("div", { style: scanBandStyle })
						)
					)
				)
			);
		}

		// ---------- 耗尽提示（官方 Modal 风格） ----------
		var exhaustedPrev = {};
		function ExhaustedToast(props) {
			var useSessions = props.useSessions;
			var current = useSessions(function (s) { return s.current; });
			var visibleHook = react.useState(false);
			var visible = visibleHook[0];
			var setVisible = visibleHook[1];

			react.useEffect(function () {
				if (current === undefined) {
					exhaustedPrev[current] = false;
					setVisible(false);
					return;
				}
				var alive = true;
				var check = async function () {
					try {
						var r = await window.fetch(stateUrl(current)).then(function (x) { return x.json(); });
						if (!alive) return;
						var was = exhaustedPrev[current];
						var is = !!(r && r.exhausted);
						if (is && was !== true) setVisible(true);
						if (!is && was === true) setVisible(false);
						exhaustedPrev[current] = is;
					} catch (err) { /* 静默重试 */ }
				};
				check();
				var timer = window.setInterval(check, 1000);
				return function () { alive = false; window.clearInterval(timer); };
			}, [current]);

			if (!visible) return null;
			return react.createElement("div", { style: S.modalRoot },
				react.createElement("div", { style: S.mask }),
				react.createElement("div", { style: S.toastDialog, role: "alert" },
					react.createElement("div", { style: S.header },
						react.createElement("h2", { style: S.toastTitle }, "本会话额度已用完")
					),
					react.createElement("div", { style: { padding: "0 24px" } },
						react.createElement("p", { style: S.toastText }, "新的模型请求已被拦截。请在输入框上方的额度条重新设置额度，或新开一个会话。")
					),
					react.createElement("div", { style: S.toastActions },
						react.createElement("button", { style: S.btnPrimarySm, onClick: function () { setVisible(false); } }, "知道了")
					)
				)
			);
		}

		function apply(ctx) {
			ctx.slots.inject("conversation.input.dock", function () {
				return ctx.slots.register({
					name: "conversation.input.dock",
					id: "quota-meter-shushu",
					// 与 Todo(0)/Queue(20) 并列的 dock 卡片条
					order: 90
				}, QuotaMeter);
			});
			ctx.slots.inject("shell.overlay", function () {
				return ctx.slots.register({
					name: "shell.overlay",
					id: "quota-exhausted-toast",
					order: 90
				}, ExhaustedToast);
			});
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
