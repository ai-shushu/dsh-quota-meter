// 会话额度监控（Client 半部）— 浏览器 bundle（ModuleLoader 格式）
// 数据通道：fetch Host 半部的 /quota HTTP 接口。
// UI：
//   - 输入框正上方一行：消耗文字 + 「改额度」+「设置」（价格，弹层）
//   - 2px 细进度条：表示【剩余额度】，右端对齐、消耗时从左侧消失（倒退）；
//     已消耗部分 = 左侧灰色痕迹（随消耗增长），剩余部分 = 右侧彩色渐变段
//     （随消耗缩短）+ 极淡流光（柔和动感，非突闪）；
//     颜色随剩余比例连续渐变（绿→红）；条覆盖输入框卡片顶部边框线位置，
//     宽度 = 卡片宽 - 2×22px（只覆盖直线段，避开圆角）
//   - 价格设置弹层：模型（多平台）三档价格编辑，持久化到 host JSON 文件
//   - 耗尽弹窗（shell.overlay）
// 与 cordis.patch.yml 中本 bundle 的行 id 保持一致（quota-meter）。
window.__ModuleLoader__.load({
	id: "quota-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// 注入流光动画 keyframes（bundle 加载时执行一次）
		if (typeof document !== "undefined" && !document.getElementById("quota-meter-flow")) {
			var flowStyle = document.createElement("style");
			flowStyle.id = "quota-meter-flow";
			flowStyle.textContent = "@keyframes quota-meter-flow { from { background-position: 0 0, 0 0; } to { background-position: 48px 0, 0 0; } }";
			document.head.appendChild(flowStyle);
		}

		var S = {
			// 根：全宽；设置额度后细条通过负 margin 下沉盖住输入框顶线
			wrap: { position: "relative", zIndex: 2, width: "100%" },
			// 文字行：消耗文字 + 改额度 + 设置 在同一行（nowrap 居中）
			row: { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", maxWidth: "var(--dsh-composer-card-max-width)", margin: "0 auto", padding: "5px 16px 7px", fontSize: "12px", lineHeight: "1.4", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" },
			text: { whiteSpace: "nowrap" },
			strong: { color: "var(--dsw-alias-label-primary)", fontWeight: 600 },
			muted: { opacity: 0.75 },
			// 2px 细条轨道：宽度 = 卡片宽 - 2×22px（只覆盖直线段）；透明背景；
			// 着色部分 = 灰色痕迹（左）+ 彩色剩余（右）；danger 时整条红
			trackWrap: { display: "flex", justifyContent: "center", width: "100%" },
			track: { position: "relative", width: "calc(min(var(--dsh-composer-card-max-width), 100% - 32px) - 44px)", height: "2px", borderRadius: "2px", background: "transparent", overflow: "hidden" },
			set: { display: "inline-flex", alignItems: "center", gap: "6px" },
			input: { width: "64px", padding: "3px 8px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", outline: "none" },
			btn: { padding: "3px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", cursor: "pointer" },
			link: { background: "none", border: "none", padding: 0, color: "var(--dsw-alias-label-secondary)", fontSize: "12px", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" },
			// 价格设置弹层
			modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.32)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 },
			modal: { width: 480, maxWidth: "calc(100vw - 32px)", maxHeight: "72vh", overflowY: "auto", padding: "16px 18px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 14, background: "var(--dsw-alias-bg-overlay)", color: "var(--dsw-alias-label-primary)", boxShadow: "0 12px 40px rgba(0,0,0,.28)", fontSize: 12 },
			modalTitle: { fontWeight: 600, fontSize: 14, marginBottom: 2 },
			modalSub: { fontSize: 11, color: "var(--dsw-alias-label-caption)", marginBottom: 10 },
			modelRow: { display: "flex", alignItems: "center", gap: "6px", padding: "4px 0", borderBottom: "1px solid var(--dsw-alias-border-l1)" },
			modelMeta: { flex: "0 0 108px", minWidth: 0 },
			modelName: { fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			modelProvider: { fontSize: 10, color: "var(--dsw-alias-label-caption)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			priceInput: { width: 54, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: 12, outline: "none", textAlign: "right" },
			nameInput: { flex: "1 1 90px", minWidth: 56, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: 12, outline: "none" },
			providerInput: { flex: "0 0 64px", minWidth: 0, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: 12, outline: "none" },
			addRow: { display: "flex", alignItems: "center", gap: "6px", padding: "8px 0" },
			modalErr: { color: "var(--dsw-alias-state-error-primary)", fontSize: 11, margin: "4px 0" },
			modalActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
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

		// 连续色阶：剩余比例 1→0 时色相 152（绿）→ 0（红）
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

			// 价格设置弹层状态
			var pricesOpenHook = react.useState(false);
			var pricesOpen = pricesOpenHook[0];
			var setPricesOpen = pricesOpenHook[1];
			var pricesDraftHook = react.useState(null);
			var pricesDraft = pricesDraftHook[0];
			var setPricesDraft = pricesDraftHook[1];
			var pricesErrHook = react.useState("");
			var pricesErr = pricesErrHook[0];
			var setPricesErr = pricesErrHook[1];
			var addHook = react.useState({ name: "", provider: "", miss: "", hit: "", out: "" });
			var add = addHook[0];
			var setAdd = addHook[1];

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

			// ---- 价格设置 ----
			var openPrices = async function () {
				setPricesOpen(true);
				setPricesErr("");
				try {
					var r = await window.fetch("/quota/prices").then(function (x) { return x.json(); });
					if (r && r.prices) setPricesDraft(JSON.parse(JSON.stringify(r.prices)));
				} catch (err) { setPricesErr("加载价目表失败"); }
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

			var setModelPrice = function (name, field, value) {
				setPricesDraft(function (prev) {
					var models = Object.assign({}, prev.models);
					var entry = Object.assign({}, models[name]);
					entry[field] = value;
					models[name] = entry;
					return Object.assign({}, prev, { models: models });
				});
			};

			var addModel = function () {
				var name = add.name.trim();
				if (!name) return;
				setPricesDraft(function (prev) {
					var models = Object.assign({}, prev.models);
					models[name] = { provider: add.provider.trim(), inputMiss: add.miss, inputHit: add.hit, output: add.out };
					return Object.assign({}, prev, { models: models, fallback: prev.fallback || name });
				});
				setAdd({ name: "", provider: "", miss: "", hit: "", out: "" });
			};

			var removeModel = function (name) {
				setPricesDraft(function (prev) {
					var models = Object.assign({}, prev.models);
					delete models[name];
					if (Object.keys(models).length === 0) return prev;
					var fallback = prev.fallback === name ? Object.keys(models)[0] : prev.fallback;
					return Object.assign({}, prev, { models: models, fallback: fallback });
				});
			};

			var pricesModal = function () {
				if (!pricesOpen || pricesDraft === null) return null;
				var entries = Object.entries(pricesDraft.models || {});
				return react.createElement("div", { style: S.modalOverlay, onClick: closePrices },
					react.createElement("div", { style: S.modal, onClick: function (e) { e.stopPropagation(); } },
						react.createElement("div", { style: S.modalTitle }, "价格设置"),
						react.createElement("div", { style: S.modalSub }, "单位 " + (pricesDraft.unit || "¥") + " / 每 " + (pricesDraft.per || "1M") + " tokens · 未命中 / 命中 / 输出"),
						entries.map(function (entry) {
							var name = entry[0];
							var p = entry[1];
							return react.createElement("div", { key: name, style: S.modelRow },
								react.createElement("div", { style: S.modelMeta },
									react.createElement("div", { style: S.modelName }, name),
									p.provider ? react.createElement("div", { style: S.modelProvider }, p.provider) : null
								),
								react.createElement("input", { style: S.priceInput, value: String(p.inputMiss), onChange: function (e) { setModelPrice(name, "inputMiss", e.target.value); } }),
								react.createElement("input", { style: S.priceInput, value: String(p.inputHit), onChange: function (e) { setModelPrice(name, "inputHit", e.target.value); } }),
								react.createElement("input", { style: S.priceInput, value: String(p.output), onChange: function (e) { setModelPrice(name, "output", e.target.value); } }),
								react.createElement("button", { style: S.link, onClick: function () { removeModel(name); } }, "删除")
							);
						}),
						react.createElement("div", { style: S.addRow },
							react.createElement("input", { style: S.nameInput, placeholder: "模型名", value: add.name, onChange: function (e) { setAdd(Object.assign({}, add, { name: e.target.value })); } }),
							react.createElement("input", { style: S.providerInput, placeholder: "平台", value: add.provider, onChange: function (e) { setAdd(Object.assign({}, add, { provider: e.target.value })); } }),
							react.createElement("input", { style: S.priceInput, placeholder: "未命中", value: add.miss, onChange: function (e) { setAdd(Object.assign({}, add, { miss: e.target.value })); } }),
							react.createElement("input", { style: S.priceInput, placeholder: "命中", value: add.hit, onChange: function (e) { setAdd(Object.assign({}, add, { hit: e.target.value })); } }),
							react.createElement("input", { style: S.priceInput, placeholder: "输出", value: add.out, onChange: function (e) { setAdd(Object.assign({}, add, { out: e.target.value })); } }),
							react.createElement("button", { style: S.btn, onClick: addModel }, "添加")
						),
						pricesErr ? react.createElement("div", { style: S.modalErr }, pricesErr) : null,
						react.createElement("div", { style: S.modalActions },
							react.createElement("button", { style: S.link, onClick: resetPrices }, "恢复默认"),
							react.createElement("div", { style: { flex: 1 } }),
							react.createElement("button", { style: S.btn, onClick: closePrices }, "取消"),
							react.createElement("button", { style: Object.assign({}, S.btn, { background: "var(--dsw-alias-state-success-primary)", color: "#fff", borderColor: "transparent" }), onClick: savePrices }, "保存")
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

			// 未设置额度：文字行 + 设置控件 + 价格入口，无进度条
			if (state.quota === null || state.quota <= 0) {
				return react.createElement("div", { style: S.wrap },
					react.createElement("div", { style: S.row },
						react.createElement("span", { style: S.text }, react.createElement("strong", { style: S.strong }, spentText)),
						react.createElement("span", { style: S.muted }, "· 未设置额度"),
						react.createElement("div", { style: S.set },
							react.createElement("span", null, unit),
							react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); }, placeholder: "5.00" }),
							react.createElement("button", { style: S.btn, onClick: function () { applyQuota(draft); } }, "设置")
						),
						react.createElement("button", { style: S.link, onClick: openPrices }, "价格"),
						pricesModal()
					)
				);
			}

			var quota = Number(state.quota) || 0;
			var spent = Number(state.spent) || 0;
			var danger = !!state.exhausted || spent >= quota;
			var remaining = Math.max(0, quota - spent);
			// 倒退方式：剩余段右对齐（宽度=剩余比例，从左侧消失）；
			// 灰色痕迹段左对齐（宽度=已消耗比例，随消耗增长）
			var ratio = danger ? 0 : Math.max(0, Math.min(1, remaining / quota));
			var spentRatio = danger ? 0 : Math.max(0, Math.min(1, spent / quota));
			var color = baseColor(ratio, danger);

			var textStyle = danger ? { whiteSpace: "nowrap", color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 } : S.text;
			var textNode = danger
				? react.createElement("span", { style: textStyle }, "额度已用完 " + unit + fmt(spent) + " / " + unit + fmt(quota))
				: react.createElement("span", { style: textStyle },
					react.createElement("strong", { style: S.strong }, spentText),
					" / " + unit + fmt(quota) + " · 剩余 " + unit + fmt(remaining)
				);

			// 剩余段：右对齐彩色渐变 + 极淡流光
			var remainStyle = {
				position: "absolute", right: 0, top: 0, bottom: 0,
				width: (ratio * 100) + "%",
				borderRadius: "0 2px 2px 0",
				backgroundImage: "linear-gradient(90deg, transparent 0 40%, rgba(255,255,255,.35) 50%, transparent 60%), linear-gradient(90deg, color-mix(in srgb, " + color + " 68%, white), " + color + ")",
				backgroundSize: "48px 100%, 100% 100%",
				backgroundRepeat: "repeat-x, no-repeat",
				animation: "quota-meter-flow 2.2s linear infinite",
				transition: "width .5s cubic-bezier(.4,0,.2,1)"
			};
			// 灰色痕迹段：左对齐，随消耗增长
			var spentStyle = {
				position: "absolute", left: 0, top: 0, bottom: 0,
				width: (spentRatio * 100) + "%",
				borderRadius: "2px 0 0 2px",
				background: "rgba(127, 127, 127, 0.3)",
				transition: "width .5s cubic-bezier(.4,0,.2,1)"
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
						: react.createElement("button", { style: S.link, onClick: function () { setDraft(fmt(quota)); setEditing(true); } }, "改额度"),
					react.createElement("button", { style: S.link, onClick: openPrices }, "价格"),
					pricesModal()
				),
				react.createElement("div", { style: S.trackWrap },
					react.createElement("div", { style: trackStyle },
						!danger && react.createElement("div", { style: spentStyle }),
						!danger && react.createElement("div", { style: remainStyle })
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
