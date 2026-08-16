// 会话额度监控（Client 半部）— 浏览器 bundle（ModuleLoader 格式）
// 数据通道：fetch Host 半部的 /quota HTTP 接口。
// UI：输入框正上方进度条（conversation.input.dock）+ 耗尽弹窗（shell.overlay）。
// 与 cordis.patch.yml 中本 bundle 的行 id 保持一致（quota-meter）。
window.__ModuleLoader__.load({
	id: "quota-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		var S = {
			wrap: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "10px", maxWidth: "min(560px, 100%)", margin: "0 auto", padding: "4px 12px", fontSize: "12px", lineHeight: "1.4", color: "var(--dsw-alias-label-secondary)" },
			text: { whiteSpace: "nowrap" },
			strong: { color: "var(--dsw-alias-label-primary)", fontWeight: 600 },
			muted: { opacity: 0.75 },
			bar: { position: "relative", flex: "0 1 260px", height: "6px", minWidth: "80px", borderRadius: "999px", background: "var(--dsw-alias-bg-layer-2)", overflow: "hidden" },
			fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "999px", transition: "width .4s ease" },
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

		// ---------- 进度条 + 额度设置（conversation.input.dock） ----------
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
				return react.createElement("div", { style: S.wrap }, "额度加载中…");
			}

			var unit = state.unit || "¥";
			var calls = Number(state.calls) || 0;
			var callsText = calls > 0 ? "（" + calls + " 次调用）" : "";
			var spentText = "已花 " + unit + fmt(state.spent) + callsText;

			if (state.quota === null || state.quota <= 0) {
				return react.createElement("div", { style: S.wrap },
					react.createElement("span", { style: S.text }, react.createElement("strong", { style: S.strong }, spentText)),
					react.createElement("span", { style: S.muted }, "· 未设置额度"),
					react.createElement("div", { style: S.set },
						react.createElement("span", null, unit),
						react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); }, placeholder: "5.00" }),
						react.createElement("button", { style: S.btn, onClick: function () { applyQuota(draft); } }, "设置")
					)
				);
			}

			var pct = Math.min(100, Math.max(0, (state.spent / state.quota) * 100));
			var remaining = Math.max(0, state.quota - state.spent);
			var danger = !!state.exhausted;
			var warn = !danger && pct >= 90;
			var fillStyle = { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "999px", transition: "width .4s ease", width: pct + "%", background: danger ? "var(--dsw-alias-state-error-primary)" : (warn ? "var(--dsw-alias-state-warn-primary)" : "var(--dsw-alias-brand-primary)") };
			var textStyle = danger ? { whiteSpace: "nowrap", color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 } : S.text;
			var textNode = danger
				? react.createElement("span", { style: textStyle }, "额度已用完 " + unit + fmt(state.spent) + " / " + unit + fmt(state.quota))
				: react.createElement("span", { style: textStyle },
					react.createElement("strong", { style: S.strong }, spentText),
					" / " + unit + fmt(state.quota) + " · 剩余 " + unit + fmt(remaining)
				);

			return react.createElement("div", { style: S.wrap },
				textNode,
				react.createElement("div", { style: S.bar }, react.createElement("div", { style: fillStyle })),
				editing
					? react.createElement("div", { style: S.set },
						react.createElement("span", null, unit),
						react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); } }),
						react.createElement("button", { style: S.btn, onClick: function () { applyQuota(draft); } }, "确认")
					)
					: react.createElement("button", { style: S.link, onClick: function () { setDraft(fmt(state.quota)); setEditing(true); } }, "改额度")
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
					order: 30
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
