// 会话额度监控（Client 半部）— 浏览器 bundle（ModuleLoader 格式）
// 数据通道：fetch Host 半部的 /quota HTTP 接口。
// UI：
//   - 输入框正上方一行：消耗文字 + 「改额度」（同一行）
//   - 细进度条：表示【剩余额度】，右端对齐、消耗时从左侧消失（倒退）；
//     颜色随剩余比例连续渐变（绿→红）；每次扣费条会闪一下（消耗脉冲）；
//     条覆盖在输入框卡片顶部边框线位置（替代原本 1px 分隔线，不额外占高度），
//     两端圆角 22px 与卡片轮廓一致
//   - 耗尽弹窗（shell.overlay）
// 与 cordis.patch.yml 中本 bundle 的行 id 保持一致（quota-meter）。
window.__ModuleLoader__.load({
	id: "quota-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		var S = {
			// 根：全宽；设置额度后细条通过负 margin 下沉盖住输入框顶线
			wrap: { position: "relative", zIndex: 2, width: "100%" },
			// 文字行：消耗文字 + 改额度 在同一行（nowrap 居中）
			row: { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", maxWidth: "var(--dsh-composer-card-max-width)", margin: "0 auto", padding: "5px 16px 7px", fontSize: "12px", lineHeight: "1.4", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" },
			text: { whiteSpace: "nowrap" },
			strong: { color: "var(--dsw-alias-label-primary)", fontWeight: 600 },
			muted: { opacity: 0.75 },
			// 进度条轨道：高度 5px；宽度 = 输入框卡片宽度 - 2×22px（两端各让出
			// 一个卡片圆角半径），只覆盖卡片顶部直线段。轨道背景透明（未消耗区
			// 不显眼）；着色部分 = 填充条 + 两端弧形片（见下方 cap）。
			trackWrap: { display: "flex", justifyContent: "center", width: "100%" },
			track: { position: "relative", width: "calc(min(var(--dsh-composer-card-max-width), 100% - 32px) - 44px)", height: "5px", borderRadius: "0px", background: "transparent", overflow: "visible" },
			set: { display: "inline-flex", alignItems: "center", gap: "6px" },
			input: { width: "64px", padding: "3px 8px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", outline: "none" },
			btn: { padding: "3px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", cursor: "pointer" },
			link: { background: "none", border: "none", padding: 0, color: "var(--dsw-alias-label-secondary)", fontSize: "12px", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" },
			toast: { pointerEvents: "auto", position: "fixed", left: "50%", top: "16%", transform: "translateX(-50%)", zIndex: 60, width: 340, maxWidth: "calc(100vw - 32px)", padding: "16px 18px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 14, background: "var(--dsw-alias-bg-overlay)", color: "var(--dsw-alias-label-primary)", boxShadow: "0 12px 40px rgba(0,0,0,.28)" },
			toastTitle: { fontWeight: 600, fontSize: 14, marginBottom: 6, color: "var(--dsw-alias-state-error-primary)" },
			toastText: { fontSize: 12, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)", marginBottom: 12 },
			toastActions: { display: "flex", justifyContent: "flex-end", gap: 8 }
		};

		function fmt(v) {
			if (!Number.isFinite(v)) return "0.00";
			return v >= 0.005 ? v.toFixed(2) : v.toFixed(4);
		}

		function stateUrl(sessionId) {
			return "/quota/state?sessionId=" + encodeURIComponent(sessionId);
		}

		// 连续色阶：剩余比例 1→0 时色相 152（绿）→ 0（红），不再分档，
		// 每次消耗颜色都连续变化，配合方向即可分辨"减少/增加"
		function ratioHue(ratio) {
			return Math.round(152 * Math.max(0, Math.min(1, ratio)));
		}

		function baseColor(ratio, danger) {
			if (danger) return "hsl(0, 70%, 50%)";
			return "hsl(" + ratioHue(ratio) + ", 70%, 48%)";
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
			var prevSpent = react.useRef(null);
			var pulseHook = react.useState(false);
			var pulse = pulseHook[0];
			var setPulse = pulseHook[1];

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

			// 消耗脉冲：检测到 spent 增加 → 条闪一下高亮再回落
			react.useEffect(function () {
				if (state === null) return;
				var s = Number(state.spent) || 0;
				if (prevSpent.current !== null && s > prevSpent.current) {
					setPulse(true);
					var t = window.setTimeout(function () { setPulse(false); }, 550);
					return function () { window.clearTimeout(t); };
				}
				prevSpent.current = s;
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

			if (state === null) {
				return react.createElement("div", { style: S.wrap },
					react.createElement("div", { style: S.row }, "额度加载中…")
				);
			}

			var unit = state.unit || "¥";
			var calls = Number(state.calls) || 0;
			var callsText = calls > 0 ? "（" + calls + " 次调用）" : "";
			var spentText = "已花 " + unit + fmt(state.spent) + callsText;

			// 未设置额度：只有文字行 + 设置控件，无进度条
			if (state.quota === null || state.quota <= 0) {
				return react.createElement("div", { style: S.wrap },
					react.createElement("div", { style: S.row },
						react.createElement("span", { style: S.text }, react.createElement("strong", { style: S.strong }, spentText)),
						react.createElement("span", { style: S.muted }, "· 未设置额度"),
						react.createElement("div", { style: S.set },
							react.createElement("span", null, unit),
							react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); }, placeholder: "5.00" }),
							react.createElement("button", { style: S.btn, onClick: function () { applyQuota(draft); } }, "设置")
						)
					)
				);
			}

			var quota = Number(state.quota) || 0;
			var spent = Number(state.spent) || 0;
			var danger = !!state.exhausted || spent >= quota;
			var remaining = Math.max(0, quota - spent);
			// 倒退方式：fill 右端对齐，宽度 = 剩余比例 → 消耗时从左侧消失
			var ratio = danger ? 0 : Math.max(0, Math.min(1, remaining / quota));
			var color = baseColor(ratio, danger);

			var textStyle = danger ? { whiteSpace: "nowrap", color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 } : S.text;
			var textNode = danger
				? react.createElement("span", { style: textStyle }, "额度已用完 " + unit + fmt(spent) + " / " + unit + fmt(quota))
				: react.createElement("span", { style: textStyle },
					react.createElement("strong", { style: S.strong }, spentText),
					" / " + unit + fmt(quota) + " · 剩余 " + unit + fmt(remaining)
				);

			// 填充：右对齐；左端（移动端）圆头；脉冲闪白；渐变左浅右深 + 辉光
			var fillBg = pulse
				? "linear-gradient(90deg, color-mix(in srgb, " + color + " 30%, white), white)"
				: "linear-gradient(90deg, color-mix(in srgb, " + color + " 68%, white), " + color + ")";
			var fillStyle = {
				position: "absolute", right: 0, top: 0, bottom: 0,
				width: (ratio * 100) + "%",
				borderRadius: "4px 0 0 4px",
				background: fillBg,
				boxShadow: pulse ? "0 0 12px color-mix(in srgb, " + color + " 70%, transparent)" : "0 0 8px color-mix(in srgb, " + color + " 40%, transparent)",
				transition: pulse ? "box-shadow .1s ease" : "width .5s cubic-bezier(.4,0,.2,1), box-shadow .3s ease"
			};
			// 两端弧形片：5px 厚的弧线描边，顺着卡片 22px 圆角往下弯（无缝衔接）。
			// 右端片始终着色（填充从右端开始）；左端片仅在填充全覆盖（或耗尽）时着色。
			var leftCapVisible = danger || ratio >= 0.9999;
			var leftCapStyle = {
				position: "absolute", left: "-22px", top: "5px",
				width: "22px", height: "22px", boxSizing: "border-box",
				border: "5px solid " + (leftCapVisible ? color : "transparent"),
				borderRight: "none", borderBottom: "none",
				borderTopLeftRadius: "22px"
			};
			var rightCapStyle = {
				position: "absolute", right: "-22px", top: "5px",
				width: "22px", height: "22px", boxSizing: "border-box",
				border: "5px solid " + color,
				borderLeft: "none", borderBottom: "none",
				borderTopRightRadius: "22px"
			};
			var trackStyle = Object.assign({}, S.track);
			if (danger) trackStyle.background = "linear-gradient(90deg, color-mix(in srgb, " + color + " 65%, white), " + color + ")";

			return react.createElement("div", { style: Object.assign({}, S.wrap, { marginBottom: "-8px" }) },
				react.createElement("div", { style: S.row },
					textNode,
					editing
						? react.createElement("div", { style: S.set },
							react.createElement("span", null, unit),
							react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); } }),
							react.createElement("button", { style: S.btn, onClick: function () { applyQuota(draft); } }, "确认")
						)
						: react.createElement("button", { style: S.link, onClick: function () { setDraft(fmt(quota)); setEditing(true); } }, "改额度")
				),
				react.createElement("div", { style: S.trackWrap },
					react.createElement("div", { style: trackStyle },
						react.createElement("div", { style: fillStyle }),
						react.createElement("div", { style: leftCapStyle }),
						react.createElement("div", { style: rightCapStyle })
					)
				)
			);
		}

		// ---------- 耗尽弹提示（shell.overlay） ----------
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
			return react.createElement("div", { style: S.toast, role: "alert" },
				react.createElement("div", { style: S.toastTitle }, "本会话额度已用完"),
				react.createElement("div", { style: S.toastText }, "新的模型请求已被拦截。请在输入框上方的额度条重新设置额度，或新开一个会话。"),
				react.createElement("div", { style: S.toastActions },
					react.createElement("button", { style: S.btn, onClick: function () { setVisible(false); } }, "知道了")
				)
			);
		}

		function apply(ctx) {
			ctx.slots.inject("conversation.input.dock", function () {
				return ctx.slots.register({
					name: "conversation.input.dock",
					id: "quota-meter",
					// 末端 dock 条目：紧贴输入框卡片（todo=0 / queue=20 之前）
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
