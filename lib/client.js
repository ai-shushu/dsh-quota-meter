// 会话额度监控（Client 半部）— 浏览器 bundle（ModuleLoader 格式）
// 数据通道：fetch Host 半部的 /quota HTTP 接口。
// UI：
//   - 输入框上方一行：消耗文字 + 「改额度」+「价格」（同一行，文字链接）
//   - 2px 细进度条：覆盖在输入框卡片顶部边框线位置（gap 0），只覆盖直线段
//     （宽 = 卡片宽 - 2×22px）；黑色剩余（label-primary，右对齐倒退）+
//     浅灰消耗痕迹 + 中性流光；耗尽整条红（state-error-primary）——黑白极简
//   - 价格弹层 = 官方 Modal（mask-1+blur、radius 24、border-inverted、
//     bg-layer-2、胶囊按钮、表单字段规范）
//   - 耗尽提示 = 官方 Modal 风格对话框
// 与 cordis.patch.yml 中本 bundle 的行 id 保持一致（quota-meter）。
window.__ModuleLoader__.load({
	id: "quota-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// 注入流光动画 keyframes（bundle 加载时执行一次；中性色高光）
		if (typeof document !== "undefined" && !document.getElementById("quota-meter-flow")) {
			var flowStyle = document.createElement("style");
			flowStyle.id = "quota-meter-flow";
			flowStyle.textContent = "@keyframes quota-meter-flow { from { background-position: 0 0, 0 0; } to { background-position: 48px 0, 0 0; } }";
			document.head.appendChild(flowStyle);
		}

		var S = {
			// ── 输入框上方的额度条（覆盖卡片顶部边框线的细条 + 文字行）──
			wrap: { position: "relative", zIndex: 2, width: "100%" },
			// 文字行：消耗文字 + 改额度 + 价格（同一行，nowrap 居中）
			row: { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", maxWidth: "var(--dsh-composer-card-max-width)", margin: "0 auto", padding: "5px 16px 7px", fontSize: "12px", lineHeight: "1.4", color: "var(--dsw-alias-label-secondary)", whiteSpace: "nowrap" },
			text: { whiteSpace: "nowrap" },
			strong: { color: "var(--dsw-alias-label-primary)", fontWeight: 600, fontVariantNumeric: "tabular-nums" },
			// 2px 细条轨道：宽 = 卡片宽 - 2×22px（只覆盖直线段），透明背景；
			// 着色 = 黑色剩余（右对齐倒退）+ 浅灰消耗痕迹；danger 整条红
			trackWrap: { display: "flex", justifyContent: "center", width: "100%" },
			track: { position: "relative", width: "calc(min(var(--dsh-composer-card-max-width), 100% - 32px) - 44px)", height: "2px", borderRadius: "2px", background: "transparent", overflow: "hidden" },
			remain: { position: "absolute", right: 0, top: 0, bottom: 0, borderRadius: "2px", background: "var(--dsw-alias-label-primary)", transition: "width .4s ease" },
			spent: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "2px 0 0 2px", background: "rgba(127, 127, 127, 0.3)", transition: "width .4s ease" },
			set: { display: "inline-flex", alignItems: "center", gap: "6px" },
			// 表单输入（GoalBar objectiveInput 规格）
			input: { height: "26px", padding: "0 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", lineHeight: "20px", outline: "none", width: "64px" },
			link: { background: "none", border: "none", padding: 0, color: "var(--dsw-alias-label-secondary)", fontSize: "12px", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: "2px" },
			// 按钮（Button 组件规格：胶囊；sm = h28/r14/pad10）
			btnSm: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, height: "28px", padding: "0 10px", border: "none", borderRadius: "14px", background: "transparent", color: "var(--dsw-alias-label-primary)", fontSize: "12px", lineHeight: "18px", cursor: "pointer" },
			btnPrimarySm: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, height: "28px", padding: "0 12px", border: "none", borderRadius: "14px", background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", fontSize: "12px", lineHeight: "18px", cursor: "pointer" },
			btnOutlineSm: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, height: "28px", padding: "0 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "14px", background: "transparent", color: "var(--dsw-alias-label-primary)", fontSize: "12px", lineHeight: "18px", cursor: "pointer" },

			// ── 价格设置 Modal（官方 Modal 规范）──
			modalRoot: { position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" },
			mask: { position: "absolute", inset: 0, background: "var(--dsw-alias-bg-mask-1)", backdropFilter: "var(--dsw-mask-blur)" },
			dialog: { position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: "16px", width: "min(460px, 100%)", maxHeight: "80vh", overflowY: "auto", padding: "0 0 20px", border: "1px solid var(--dsw-alias-border-inverted)", borderRadius: "24px", background: "var(--dsw-alias-bg-layer-2)", boxShadow: "var(--dsw-shadow-lv3)", fontSize: "13px", lineHeight: "20px", color: "var(--dsw-alias-label-secondary)" },
			header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "22px 14px 12px 24px" },
			title: { margin: 0, fontSize: "16px", lineHeight: "24px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
			close: { flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", border: "none", borderRadius: "8px", background: "transparent", cursor: "pointer", color: "var(--dsw-alias-label-secondary)", fontSize: "14px" },
			body: { padding: "0 24px", display: "flex", flexDirection: "column" },
			modalSub: { fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)", margin: "0 0 4px" },
			// 模型条目
			modelBlock: { padding: "10px 0", borderTop: "1px solid var(--dsw-alias-border-l2)" },
			modelHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
			modelName: { flex: "1 1 auto", minWidth: 0, fontSize: "13px", fontWeight: 500, color: "var(--dsw-alias-label-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
			modelProvider: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" },
			pill: { flex: "none", fontSize: "10px", lineHeight: "14px", padding: "0 6px", borderRadius: "999px", background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)" },
			priceRow: { display: "flex", alignItems: "center", gap: 6, padding: "3px 0" },
			priceLabel: { flex: "0 0 34px", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
			priceInput: { height: "24px", width: 56, padding: "0 6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", outline: "none", textAlign: "right", fontVariantNumeric: "tabular-nums" },
			todRow: { display: "flex", alignItems: "center", gap: 4, padding: "3px 0" },
			todLabel: { flex: "0 0 34px", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" },
			todSep: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" },
			tinyInput: { height: "24px", width: 34, padding: "0 4px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", outline: "none", textAlign: "center", fontVariantNumeric: "tabular-nums" },
			tzInput: { flex: "1 1 110px", minWidth: 70, height: "24px", padding: "0 6px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "12px", outline: "none" },
			addRow: { display: "flex", alignItems: "center", gap: 6, padding: "6px 0", flexWrap: "wrap" },
			nameInput: { flex: "0 1 110px", minWidth: 56, height: "26px", padding: "0 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", outline: "none" },
			providerInput: { flex: "0 1 72px", minWidth: 0, height: "26px", padding: "0 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", outline: "none" },
			modalErr: { color: "var(--dsw-alias-state-error-primary)", fontSize: "12px", margin: "4px 0" },
			modalActions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: "auto", padding: "12px 24px 0", borderTop: "1px solid var(--dsw-alias-border-l2)" },

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
			};

			// 一组三档价格输入行
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
				return react.createElement("div", { style: S.modalRoot, onClick: closePrices },
					react.createElement("div", { style: S.mask }),
					react.createElement("div", { style: S.dialog, onClick: function (e) { e.stopPropagation(); } },
						react.createElement("div", { style: S.header },
							react.createElement("h2", { style: S.title }, "价格设置"),
							react.createElement("button", { style: S.close, onClick: closePrices }, "✕")
						),
						react.createElement("div", { style: S.body },
							react.createElement("p", { style: S.modalSub }, "单位 " + (pricesDraft.unit || "¥") + " / 每 " + (pricesDraft.per || "1M") + " tokens · 未命中 / 命中 / 输出。勾选「峰谷价」的模型按自己的高峰时段计价（如 DeepSeek：北京时间 9–12、14–18 为高峰）。"),
							entries.map(function (entry) {
								var name = entry[0];
								var m = entry[1];
								var tod = m.pricing === "per-token-tod";
								return react.createElement("div", { key: name, style: S.modelBlock },
									react.createElement("div", { style: S.modelHead },
										react.createElement("span", { style: S.modelName }, name),
										tod ? react.createElement("span", { style: S.pill }, "峰谷") : null,
										m.provider ? react.createElement("span", { style: S.modelProvider }, m.provider) : null,
										react.createElement("button", { style: S.btnSm, onClick: function () { removeModel(name); } }, "删除")
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
								react.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", whiteSpace: "nowrap" } },
									react.createElement("input", { type: "checkbox", checked: !!add.tod, onChange: function (e) { setAdd(Object.assign({}, add, { tod: e.target.checked })); } }),
									"峰谷价"
								),
								react.createElement("button", { style: S.btnOutlineSm, onClick: addModel }, "添加")
							),
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

			// 未设置额度：文字行 + 设置控件 + 价格入口（无进度条）
			if (state.quota === null || state.quota <= 0) {
				return react.createElement("div", { style: S.wrap },
					react.createElement("div", { style: S.row },
						react.createElement("span", { style: S.text },
							react.createElement("strong", { style: S.strong }, spentText),
							" · 未设置额度"
						),
						react.createElement("div", { style: S.set },
							react.createElement("span", { style: { fontSize: "13px", color: "var(--dsw-alias-label-secondary)" } }, unit),
							react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); }, placeholder: "5.00" }),
							react.createElement("button", { style: S.btnPrimarySm, onClick: function () { applyQuota(draft); } }, "设置")
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
			var ratio = danger ? 0 : Math.max(0, Math.min(1, remaining / quota));
			var spentRatio = danger ? 0 : Math.max(0, Math.min(1, spent / quota));

			var textNode = danger
				? react.createElement("span", { style: Object.assign({}, S.text, { color: "var(--dsw-alias-state-error-primary)", fontWeight: 600 }) },
					"额度已用完 " + unit + fmt(spent) + " / " + unit + fmt(quota)
				)
				: react.createElement("span", { style: S.text },
					react.createElement("strong", { style: S.strong }, spentText),
					" / " + unit + fmt(quota) + " · 剩余 " + unit + fmt(remaining)
				);

			// 细条：黑色剩余（右对齐倒退、极淡流光）+ 浅灰消耗痕迹；danger 整条红
			var remainStyle = Object.assign({}, S.remain, {
				width: (ratio * 100) + "%",
				backgroundImage: "linear-gradient(90deg, transparent 0 40%, rgba(255,255,255,.25) 50%, transparent 60%), linear-gradient(90deg, color-mix(in srgb, var(--dsw-alias-label-primary) 82%, transparent), var(--dsw-alias-label-primary))",
				backgroundSize: "48px 100%, 100% 100%",
				backgroundRepeat: "repeat-x, no-repeat",
				animation: "quota-meter-flow 2.2s linear infinite"
			});
			var spentStyle = Object.assign({}, S.spent, { width: (spentRatio * 100) + "%" });
			var trackStyle = Object.assign({}, S.track);
			if (danger) trackStyle.background = "color-mix(in srgb, var(--dsw-alias-state-error-primary) 25%, transparent)";

			return react.createElement("div", { style: Object.assign({}, S.wrap, { marginBottom: "-8px" }) },
				react.createElement("div", { style: S.row },
					textNode,
					editing
						? react.createElement("div", { style: S.set },
							react.createElement("span", { style: { fontSize: "13px", color: "var(--dsw-alias-label-secondary)" } }, unit),
							react.createElement("input", { style: S.input, value: draft, onChange: function (e) { setDraft(e.target.value); } }),
							react.createElement("button", { style: S.btnPrimarySm, onClick: function () { applyQuota(draft); } }, "确认")
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
					id: "quota-meter",
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
