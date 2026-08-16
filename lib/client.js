// 会话额度监控（Client 半部）— 浏览器 bundle（ModuleLoader 格式）
// 数据通道：fetch Host 半部的 /quota HTTP 接口。
// UI：
//   - 输入框正上方一行：消耗文字 + 「改额度」+「设置」（价格，弹层）
//   - 2px 细进度条：剩余额度倒退（右对齐、左侧消失），已消耗灰色痕迹 +
//     剩余彩色渐变流光，颜色随剩余比例连续渐变；覆盖输入框卡片顶边框线
//   - 价格设置弹层：定价模式化（per-token 恒价 / per-token-tod 峰谷），
//     持久化到 host JSON 文件
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
			// 2px 细条轨道
			trackWrap: { display: "flex", justifyContent: "center", width: "100%" },
			track: { position: "relative", width: "calc(min(var(--dsh-composer-card-max-width), 100% - 32px) - 44px)", height: "2px", borderRadius: "2px", background: "transparent", overflow: "hidden" },
			set: { display: "inline-flex", alignItems: "center", gap: "6px" },
			input: { width: "64px", padding: "3px 8px", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", outline: "none" },
			btn: { padding: "3px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", cursor: "pointer" },
			link: { background: "none", border: "none", padding: 0, color: "var(--dsw-alias-label-secondary)", fontSize: "12px", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" },
			// 价格设置弹层（harness 设计语言：token 化，浅深色自适应）
			modalOverlay: { position: "fixed", inset: 0, background: "var(--dsw-alias-bg-mask-2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 },
			modal: { width: 540, maxWidth: "calc(100vw - 32px)", maxHeight: "74vh", overflowY: "auto", padding: "16px 18px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 12, background: "var(--dsw-alias-bg-overlay)", color: "var(--dsw-alias-label-primary)", boxShadow: "0 12px 40px rgba(0,0,0,.28)", fontSize: 12 },
			modalTitle: { fontWeight: 600, fontSize: 15, marginBottom: 2, color: "var(--dsw-alias-label-primary)" },
			modalSub: { fontSize: 11, lineHeight: 1.5, color: "var(--dsw-alias-label-caption)", marginBottom: 12 },
			modelBlock: { padding: "8px 0", borderBottom: "1px solid var(--dsw-alias-border-l2)" },
			modelRowHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
			modelMeta: { flex: "1 1 auto", minWidth: 0 },
			modelName: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			modelProvider: { fontSize: 10, color: "var(--dsw-alias-label-caption)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			pill: { display: "inline-block", marginLeft: 6, fontSize: 10, lineHeight: "14px", padding: "0 6px", borderRadius: 999, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)", verticalAlign: "middle" },
			priceRow: { display: "flex", alignItems: "center", gap: "6px", padding: "2px 0" },
			priceLabel: { flex: "0 0 34px", fontSize: 11, color: "var(--dsw-alias-label-caption)" },
			priceInput: { width: 56, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", fontSize: 12, outline: "none", textAlign: "right" },
			todRow: { display: "flex", alignItems: "center", gap: 4, padding: "2px 0", marginTop: 2 },
			todLabel: { flex: "0 0 34px", fontSize: 11, color: "var(--dsw-alias-label-caption)" },
			todSep: { fontSize: 10, color: "var(--dsw-alias-label-tertiary)" },
			tinyInput: { width: 34, padding: "1px 4px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", fontSize: 11, outline: "none", textAlign: "center" },
			tzInput: { flex: "1 1 110px", minWidth: 70, padding: "1px 6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", fontSize: 11, outline: "none" },
			addRow: { display: "flex", alignItems: "center", gap: "6px", padding: "8px 0", flexWrap: "wrap" },
			nameInput: { flex: "0 1 110px", minWidth: 56, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", fontSize: 12, outline: "none" },
			providerInput: { flex: "0 1 70px", minWidth: 0, padding: "2px 6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "var(--dsw-alias-bg-layer-3)", color: "var(--dsw-alias-label-primary)", fontSize: 12, outline: "none" },
			btnPrimary: { padding: "4px 14px", border: "none", borderRadius: 8, background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", fontSize: 12, cursor: "pointer" },
			modalErr: { color: "var(--dsw-alias-state-error-primary)", fontSize: 11, margin: "4px 0" },
			modalActions: { display: "flex", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--dsw-alias-border-l2)" },
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
			var addHook = react.useState({ name: "", provider: "", miss: "", hit: "", out: "", tod: false, peakMiss: "", peakHit: "", peakOut: "", tz: "Asia/Shanghai", p0s: "9", p0e: "12", p1s: "14", p1e: "18" });
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

			// 通用价格字段更新：key 形如 "inputMiss"（恒价）或 "default.inputMiss"/"peak.inputMiss"（峰谷）
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
			};

			// 一组三档价格输入行（label 为空表示恒价模式单组）
			var priceInputs = function (name, group, label) {
				var keyOf = function (f) { return group ? group + "." + f : f; };
				var entry = pricesDraft.models[name];
				var p = group ? (entry.prices[group] || {}) : entry.prices;
				return react.createElement("div", { style: S.priceRow },
					react.createElement("span", { style: S.priceLabel }, label || ""),
					react.createElement("input", { style: S.priceInput, value: p.inputMiss == null ? "" : String(p.inputMiss), onChange: function (e) { setModelField(name, keyOf("inputMiss"), e.target.value); } }),
					react.createElement("input", { style: S.priceInput, value: p.inputHit == null ? "" : String(p.inputHit), onChange: function (e) { setModelField(name, keyOf("inputHit"), e.target.value); } }),
					react.createElement("input", { style: S.priceInput, value: p.output == null ? "" : String(p.output), onChange: function (e) { setModelField(name, keyOf("output"), e.target.value); } })
				);
			};

			var pricesModal = function () {
				if (!pricesOpen || pricesDraft === null) return null;
				var entries = Object.entries(pricesDraft.models || {});
				var addPriceRow = function (label, v1, v2, v3, setV1, setV2, setV3) {
					return react.createElement("div", { style: S.priceRow },
						react.createElement("span", { style: S.priceLabel }, label || ""),
						react.createElement("input", { style: S.priceInput, placeholder: "未命中", value: v1, onChange: function (e) { setV1(e.target.value); } }),
						react.createElement("input", { style: S.priceInput, placeholder: "命中", value: v2, onChange: function (e) { setV2(e.target.value); } }),
						react.createElement("input", { style: S.priceInput, placeholder: "输出", value: v3, onChange: function (e) { setV3(e.target.value); } })
					);
				};
				// 峰谷模型的高峰时段编辑行（每模型自己的时段规则）
				var todRow = function (name, m) {
					var tod = Object.assign({ tz: "Asia/Shanghai", peak: [[9, 12], [14, 18]] }, m.tod || {});
					var peak = tod.peak || [];
					var w0 = peak[0] || [9, 12];
					var w1 = peak[1] || [14, 18];
					var numInput = function (key, v) {
						return react.createElement("input", { style: S.tinyInput, value: String(v), onChange: function (e) { setTodField(name, key, e.target.value); } });
					};
					return react.createElement("div", { style: S.todRow },
						react.createElement("span", { style: S.todLabel }, "高峰"),
						numInput("0s", w0[0]),
						react.createElement("span", { style: S.todSep }, "–"),
						numInput("0e", w0[1]),
						numInput("1s", w1[0]),
						react.createElement("span", { style: S.todSep }, "–"),
						numInput("1e", w1[1]),
						react.createElement("input", { style: S.tzInput, value: tod.tz || "", onChange: function (e) { setTodField(name, "tz", e.target.value); } })
					);
				};
				// 添加时的时段输入行（绑定 add 状态）
				var addTodRow = function () {
					var bind = function (k) { return function (e) { setAdd(Object.assign({}, add, (_b = {}, _b[k] = e.target.value, _b))); }; };
					return react.createElement("div", { style: S.todRow },
						react.createElement("span", { style: S.todLabel }, "高峰"),
						react.createElement("input", { style: S.tinyInput, value: add.p0s, onChange: bind("p0s") }),
						react.createElement("span", { style: S.todSep }, "–"),
						react.createElement("input", { style: S.tinyInput, value: add.p0e, onChange: bind("p0e") }),
						react.createElement("input", { style: S.tinyInput, value: add.p1s, onChange: bind("p1s") }),
						react.createElement("span", { style: S.todSep }, "–"),
						react.createElement("input", { style: S.tinyInput, value: add.p1e, onChange: bind("p1e") }),
						react.createElement("input", { style: S.tzInput, value: add.tz, onChange: bind("tz") })
					);
				};
				return react.createElement("div", { style: S.modalOverlay, onClick: closePrices },
					react.createElement("div", { style: S.modal, onClick: function (e) { e.stopPropagation(); } },
						react.createElement("div", { style: S.modalTitle }, "价格设置"),
						react.createElement("div", { style: S.modalSub }, "单位 " + (pricesDraft.unit || "¥") + " / 每 " + (pricesDraft.per || "1M") + " tokens · 未命中 / 命中 / 输出。勾选「峰谷价」的模型按自己的高峰时段（时区 + 区间）计价，如 DeepSeek：北京时间 9–12、14–18 为高峰。"),
						entries.map(function (entry) {
							var name = entry[0];
							var m = entry[1];
							var tod = m.pricing === "per-token-tod";
							return react.createElement("div", { key: name, style: S.modelBlock },
								react.createElement("div", { style: S.modelRowHead },
									react.createElement("div", { style: S.modelMeta },
										react.createElement("div", { style: S.modelName },
											name,
											tod ? react.createElement("span", { style: S.pill }, "峰谷") : null
										),
										m.provider ? react.createElement("div", { style: S.modelProvider }, m.provider) : null
									),
									react.createElement("button", { style: S.link, onClick: function () { removeModel(name); } }, "删除")
								),
								tod
									? react.createElement(react.Fragment, null,
										priceInputs(name, "default", "空闲"),
										priceInputs(name, "peak", "高峰"),
										todRow(name, m)
									)
									: priceInputs(name, null, null)
							);
						}),
						react.createElement("div", { style: S.addRow },
							react.createElement("input", { style: S.nameInput, placeholder: "模型名", value: add.name, onChange: function (e) { setAdd(Object.assign({}, add, { name: e.target.value })); } }),
							react.createElement("input", { style: S.providerInput, placeholder: "平台", value: add.provider, onChange: function (e) { setAdd(Object.assign({}, add, { provider: e.target.value })); } }),
							react.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--dsw-alias-label-caption)", whiteSpace: "nowrap" } },
								react.createElement("input", { type: "checkbox", checked: !!add.tod, onChange: function (e) { setAdd(Object.assign({}, add, { tod: e.target.checked })); } }),
								"峰谷价"
							)
						),
						react.createElement("div", { style: S.addRow },
							add.tod
								? react.createElement(react.Fragment, null,
									addPriceRow("空闲", add.miss, add.hit, add.out,
										function (v) { setAdd(Object.assign({}, add, { miss: v })); },
										function (v) { setAdd(Object.assign({}, add, { hit: v })); },
										function (v) { setAdd(Object.assign({}, add, { out: v })); }),
									addPriceRow("高峰", add.peakMiss, add.peakHit, add.peakOut,
										function (v) { setAdd(Object.assign({}, add, { peakMiss: v })); },
										function (v) { setAdd(Object.assign({}, add, { peakHit: v })); },
										function (v) { setAdd(Object.assign({}, add, { peakOut: v })); }),
									addTodRow()
								)
								: addPriceRow("", add.miss, add.hit, add.out,
									function (v) { setAdd(Object.assign({}, add, { miss: v })); },
									function (v) { setAdd(Object.assign({}, add, { hit: v })); },
									function (v) { setAdd(Object.assign({}, add, { out: v })); }),
							react.createElement("button", { style: S.btn, onClick: addModel }, "添加")
						),
						pricesErr ? react.createElement("div", { style: S.modalErr }, pricesErr) : null,
						react.createElement("div", { style: S.modalActions },
							react.createElement("button", { style: S.link, onClick: resetPrices }, "恢复默认"),
							react.createElement("div", { style: { flex: 1 } }),
							react.createElement("button", { style: S.btn, onClick: closePrices }, "取消"),
							react.createElement("button", { style: S.btnPrimary, onClick: savePrices }, "保存")
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
