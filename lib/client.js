// 会话额度监控（Client 半部）— 浏览器 bundle（ModuleLoader 格式）
// 数据通道：fetch Host 半部的 /quota HTTP 接口。
// UI：
//   - 输入框正上方一行：消耗文字 + 「改额度」（同一行）
//   - 细进度条：表示【剩余额度】，随消耗向左倒退收缩，并覆盖在输入框卡片的
//     顶部边框线位置（替代原本的 1px 分隔线，不额外占高度）
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
			// 细进度条轨道：宽度与输入框卡片一致，3px 高，内嵌描边
			trackWrap: { display: "flex", justifyContent: "center", width: "100%" },
			track: { position: "relative", width: "min(var(--dsh-composer-card-max-width), calc(100% - 32px))", height: "3px", borderRadius: "999px", background: "var(--dsw-alias-bg-layer-2)", overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--dsw-alias-border-l2-darkmode-thin)" },
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

		// 剩余比例 -> 条色：充足=绿，过半转琥珀，低=红（倒退条，满→空）
		function ratioColor(ratio) {
			if (ratio >= 0.5) return "var(--dsw-alias-state-success-primary)";
			if (ratio >= 0.25) return "var(--dsw-alias-state-warn-primary)";
			return "var(--dsw-alias-state-error-primary)";
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
			// 倒退方式：宽度 = 剩余比例，随消耗从右向左收缩
			var ratio = danger ? 0 : Math.max(0, Math.min(1, remaining / quota));
			var color = danger ? "var(--dsw-alias-state-error-primary)" : ratioColor(ratio);

			var textStyle = danger ? { whiteSpace: "nowrap", color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 } : S.text;
			var textNode = danger
				? react.createElement("span", { style: textStyle }, "额度已用完 " + unit + fmt(spent) + " / " + unit + fmt(quota))
				: react.createElement("span", { style: textStyle },
					react.createElement("strong", { style: S.strong }, spentText),
					" / " + unit + fmt(quota) + " · 剩余 " + unit + fmt(remaining)
				);

			// 细条填充：渐变 + 微弱辉光；耗尽时整条变红（无填充）
			var fillStyle = {
				position: "absolute", left: 0, top: 0, bottom: 0,
				width: (ratio * 100) + "%",
				borderRadius: "999px",
				background: "linear-gradient(90deg, color-mix(in srgb, " + color + " 72%, white), " + color + ")",
				boxShadow: "0 0 8px color-mix(in srgb, " + color + " 45%, transparent)",
				transition: "width .5s cubic-bezier(.4,0,.2,1)"
			};
			var trackStyle = Object.assign({}, S.track);
			if (danger) trackStyle.background = "linear-gradient(90deg, color-mix(in srgb, " + color + " 70%, white), " + color + ")";

			return react.createElement("div", { style: Object.assign({}, S.wrap, { marginBottom: "-7px" }) },
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
					react.createElement("div", { style: trackStyle }, react.createElement("div", { style: fillStyle }))
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
