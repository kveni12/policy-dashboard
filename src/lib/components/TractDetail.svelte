<script>
	/**
	 * Tract detail cards: joins ``panelState.selectedTracts`` to ``tractData`` rows and surfaces
	 * period-aware census / development / transit fields plus a D3 stacked race composition mini-chart.
	 */
	import * as d3 from 'd3';
	import { tractData, developments, meta } from '$lib/stores/data.svelte.js';
	import {
		filterTractsByTract,
		buildFilteredData,
		getScatterXValue,
		tractStopsDensityForDisplay,
		developmentAffordableUnitsCapped
	} from '$lib/utils/derived.js';
	import { periodCensusBounds } from '$lib/utils/periods.js';

	let { panelState } = $props();

	/** Aggregate development stats per tract per decade, plus 1990–2020 window from completion year. */
	const devByTractDecade = $derived.by(() => {
		const m = new Map();
		for (const d of developments) {
			const key = `${d.gisjoin}_${d.decade}`;
			if (!m.has(key)) {
				m.set(key, { new_units: 0, new_affordable: 0, multifam: 0 });
			}
			const agg = m.get(key);
			agg.new_units += d.hu;
			agg.new_affordable += developmentAffordableUnitsCapped(d);
			agg.multifam += d.smmultifam + d.lgmultifam;

			// Long census window: completions 1990–2020 (excludes 2021+ still tagged 10_20)
			const y = d.completion_year;
			if (y != null && y >= 1990 && y <= 2020) {
				const k90 = `${d.gisjoin}_90_20`;
				if (!m.has(k90)) {
					m.set(k90, { new_units: 0, new_affordable: 0, multifam: 0 });
				}
				const a90 = m.get(k90);
				a90.new_units += d.hu;
				a90.new_affordable += developmentAffordableUnitsCapped(d);
				a90.multifam += d.smmultifam + d.lgmultifam;
			}
		}
		return m;
	});

	const selectedList = $derived([...panelState.selectedTracts]);

	/** All tracts currently passing census tract filters (for select-all). */
	const filteredGisjoins = $derived.by(() => {
		return filterTractsByTract(tractData, panelState).map((t) => t.gisjoin);
	});

	function selectAllFiltered() {
		panelState.selectAll(filteredGisjoins);
	}

	/**
	 * Development aggregation under current panel filters — matches scatter X-axis sourcing.
	 */
	const panelDevAgg = $derived.by(() => {
		return buildFilteredData(tractData, developments, panelState).devAgg;
	});

	/** Y-axis variables grouped like the Time & Axes control (for readable inspection lists). */
	const groupedYVars = $derived.by(() => {
		const groups = [];
		const seen = new Set();
		for (const v of meta.yVariables ?? []) {
			if (!seen.has(v.cat)) {
				seen.add(v.cat);
				groups.push({ cat: v.cat, catLabel: v.catLabel, vars: [] });
			}
			groups.find((g) => g.cat === v.cat)?.vars.push(v);
		}
		return groups;
	});

	/** Aggregate summary of all selected tracts. */
	const aggregate = $derived.by(() => {
		if (selectedList.length < 2) return null;
		const { startY, endY, tag } = periodCensusBounds(panelState.timePeriod);
		const byGj = new Map();
		for (const t of tractData) if (t.gisjoin) byGj.set(t.gisjoin, t);

		let popStart = 0, popEnd = 0, huStart = 0, huEnd = 0;
		let totalNewUnits = 0, totalAffordable = 0, totalMultifam = 0;
		const yVals = {};
		let tractCount = 0;

		for (const gid of selectedList) {
			const t = byGj.get(gid);
			if (!t) continue;
			tractCount++;
			popStart += Number(t[`pop_${startY}`]) || 0;
			popEnd += Number(t[`pop_${endY}`]) || 0;
			huStart += Number(t[`total_hu_${startY}`]) || 0;
			huEnd += Number(t[`total_hu_${endY}`]) || 0;

			const devKey = `${gid}_${tag}`;
			const da = devByTractDecade.get(devKey);
			if (da) {
				totalNewUnits += da.new_units;
				totalAffordable += da.new_affordable;
				totalMultifam += da.multifam;
			}

			for (const yv of meta.yVariables ?? []) {
				const key = `${yv.key}_${tag}`;
				const val = Number(t[key]);
				if (Number.isFinite(val)) {
					if (!yVals[key]) yVals[key] = [];
					yVals[key].push(val);
				}
			}
		}

		const yMeans = {};
		for (const [k, arr] of Object.entries(yVals)) {
			yMeans[k] = d3.mean(arr);
		}

		/** Per X metric: sum for unit counts, mean otherwise (aligned with per-tract scatter values). */
		const xStats = {};
		const devAgg = panelDevAgg;
		for (const xv of meta.xVariables ?? []) {
			const vals = [];
			for (const gid of selectedList) {
				const tr = byGj.get(gid);
				const xVal = getScatterXValue(tr, gid, xv.key, devAgg, panelState.timePeriod);
				if (Number.isFinite(xVal)) vals.push(xVal);
			}
			if (vals.length === 0) {
				xStats[xv.key] = null;
				continue;
			}
			const useSum = xv.key === 'new_units' || xv.key === 'new_affordable';
			xStats[xv.key] = useSum ? d3.sum(vals) : d3.mean(vals);
		}

		return {
			tractCount,
			popStart, popEnd,
			huStart, huEnd,
			huChange: huEnd - huStart,
			totalNewUnits, totalAffordable, totalMultifam,
			yMeans,
			xStats
		};
	});

	const tractByGisjoin = $derived.by(() => {
		const m = new Map();
		for (const t of tractData) {
			m.set(t.gisjoin, t);
		}
		return m;
	});

	const period = $derived(periodCensusBounds(panelState.timePeriod));

	/**
	 * @param {unknown} v
	 * @returns {string}
	 */
	function fmtInt(v) {
		if (v == null || Number.isNaN(Number(v))) return '—';
		return d3.format(',.0f')(Number(v));
	}

	/**
	 * @param {object | null | undefined} tract
	 * @returns {string}
	 */
	function fmtStopsPerSqMi(tract) {
		const d = tractStopsDensityForDisplay(tract);
		return d !== null ? d3.format(',.1f')(d) : '\u2014';
	}

	/**
	 * @param {unknown} v
	 * @returns {string}
	 */
	function fmtMoney(v) {
		if (v == null || Number.isNaN(Number(v))) return '—';
		return d3.format('$,.0f')(Number(v));
	}

	/**
	 * @param {unknown} v
	 * @returns {string}
	 */
	function fmtPctVal(v) {
		if (v == null || Number.isNaN(Number(v))) return '—';
		return `${Number(v).toFixed(1)}%`;
	}

	/**
	 * @param {unknown} v
	 * @returns {string}
	 */
	function fmtPP(v) {
		if (v == null || Number.isNaN(Number(v))) return '—';
		const n = Number(v);
		const sign = n > 0 ? '+' : '';
		return `${sign}${n.toFixed(1)} pp`;
	}

	/**
	 * @param {unknown} v
	 * @returns {string}
	 */
	function fmtPctChange(v) {
		if (v == null || Number.isNaN(Number(v))) return '—';
		const n = Number(v);
		const sign = n > 0 ? '+' : '';
		return `${sign}${n.toFixed(1)}%`;
	}

	/**
	 * @param {unknown} v
	 * @returns {string}
	 */
	function fmtShare(v) {
		if (v == null || Number.isNaN(Number(v))) return '—';
		return `${(Number(v) * 100).toFixed(1)}%`;
	}

	/**
	 * @param {unknown} v
	 * @returns {string}
	 */
	function fmtBool(v) {
		if (v == null) return '—';
		return v ? 'Yes' : 'No';
	}

	/**
	 * Format a scatter Y-axis field using the same unit conventions as chart metadata labels.
	 *
	 * Parameters
	 * ----------
	 * yKey : string
	 *     Base key from ``meta.yVariables`` (no period suffix).
	 * v : unknown
	 *     Raw numeric value from ``tract[`${yKey}_${tag}`]``.
	 *
	 * Returns
	 * -------
	 * string
	 */
	function formatYAxisValue(yKey, v) {
		if (v == null || !Number.isFinite(Number(v))) return '—';
		if (yKey === 'pop_change_pct' || yKey === 'median_income_change_pct') return fmtPctChange(v);
		if (yKey === 'avg_travel_time_change') return `${Number(v).toFixed(1)} min`;
		return fmtPP(v);
	}

	/**
	 * Format a scatter X-axis field (development aggregates under current filters).
	 *
	 * Parameters
	 * ----------
	 * xKey : string
	 *     Key from ``meta.xVariables``.
	 * v : unknown
	 *     Value from ``getScatterXValue`` / aggregate ``xStats``.
	 *
	 * Returns
	 * -------
	 * string
	 */
	function formatXAxisValue(xKey, v) {
		if (v == null || !Number.isFinite(Number(v))) return '—';
		if (xKey === 'census_hu_change') return fmtInt(v);
		if (xKey === 'pct_stock_increase') return fmtPctChange(v);
		if (xKey === 'multifam_share' || xKey === 'affordable_share') return fmtShare(v);
		return fmtInt(v);
	}

	const raceKeys = ['white', 'black', 'asian', 'other'];
	const raceColors = ['#c5cad8', '#8b7bff', '#e8a54b', '#5dbb7a'];

	/**
	 * D3 stacked horizontal bars for two census years (start / end of period).
	 *
	 * Parameters
	 * ----------
	 * node : HTMLElement
	 * params : {{ tract: object, startY: string, endY: string }}
	 *
	 * Returns
	 * -------
	 * import('svelte/action').ActionReturn
	 */
	function raceComposition(node, params) {
		let ro;

		function draw() {
			const { tract, startY, endY } = params;
			d3.select(node).selectAll('*').remove();

			const w = Math.max(node.clientWidth || 0, 160);
			const rowH = 12;
			const gap = 6;
			const labelH = 14;
			const legendH = 14;
			const svgH = labelH + rowH + gap + labelH + rowH + 6 + legendH;

			const svg = d3
				.select(node)
				.append('svg')
				.attr('width', w)
				.attr('height', svgH)
				.attr('role', 'img')
				.attr('aria-label', `Racial composition ${startY} vs ${endY}`);

			const rows = [startY, endY].map((y) => {
				const white = +tract[`white_${y}`] || 0;
				const black = +tract[`black_${y}`] || 0;
				const asian = +tract[`asian_${y}`] || 0;
				const other = +tract[`other_race_${y}`] || 0;
				const sum = white + black + asian + other;
				const k = sum ? 1 / sum : 0;
				return {
					year: y,
					white: white * k,
					black: black * k,
					asian: asian * k,
					other: other * k
				};
			});

			const stack = d3.stack().keys(raceKeys);
			const layers = stack(rows);

			layers.forEach((layer, li) => {
				const fill = raceColors[li];
				layer.forEach((seg, ri) => {
					const x0 = seg[0] * w;
					const x1 = seg[1] * w;
					const bw = Math.max(0, x1 - x0);
					if (bw < 0.25) return;
					const yTop = ri === 0 ? labelH : labelH + rowH + gap + labelH;
					svg
						.append('rect')
						.attr('x', x0)
						.attr('y', yTop)
						.attr('width', bw)
						.attr('height', rowH)
						.attr('fill', fill)
						.attr('opacity', 0.92);
				});
			});

			[startY, endY].forEach((y, ri) => {
				const yTop = ri === 0 ? 0 : labelH + rowH + gap;
				svg
					.append('text')
					.attr('x', 0)
					.attr('y', yTop + 11)
					.attr('fill', 'var(--text-muted)')
					.attr('font-size', '10px')
					.text(y);
			});

			const abbrev = { white: 'W', black: 'B', asian: 'A', other: 'O' };
			const legY = labelH + rowH + gap + labelH + rowH + 10;
			const leg = svg.append('g').attr('transform', `translate(0,${legY})`);
			const slot = w / 4;
			raceKeys.forEach((k, i) => {
				const lx = i * slot;
				leg
					.append('rect')
					.attr('x', lx)
					.attr('y', 0)
					.attr('width', 7)
					.attr('height', 7)
					.attr('fill', raceColors[i]);
				leg
					.append('text')
					.attr('x', lx + 10)
					.attr('y', 6)
					.attr('fill', 'var(--text-muted)')
					.attr('font-size', '9px')
					.text(abbrev[k]);
			});
		}

		draw();
		ro = new ResizeObserver(() => draw());
		ro.observe(node);

		return {
			update(newParams) {
				params = newParams;
				draw();
			},
			destroy() {
				ro.disconnect();
				d3.select(node).selectAll('*').remove();
			}
		};
	}
</script>

<div class="tract-detail" data-meta-y-vars={meta.yVariables?.length ?? 0}>
	<div class="head">
		<h3 class="title">Selected tracts ({selectedList.length})</h3>
		<div class="head-actions">
			<button type="button" class="action-btn" onclick={selectAllFiltered}
				title="Select all {filteredGisjoins.length} tracts that pass current filters">
				Select all ({filteredGisjoins.length})
			</button>
			{#if selectedList.length > 0}
				<button type="button" class="action-btn clear" onclick={() => panelState.clearSelection()}>
					Clear
				</button>
			{/if}
		</div>
	</div>

	{#if selectedList.length === 0}
		<p class="empty">Click tracts on the map or scatterplot to see details here.</p>
	{:else}
		<div class="scroll">
			{#if aggregate}
				<article class="card aggregate-card">
					<header class="card-head">
						<div>
							<div class="tract-id">Aggregate ({aggregate.tractCount} tracts)</div>
						</div>
						<div class="period-pill">{period.startY}–{period.endY}</div>
					</header>
					<table class="metrics">
						<thead><tr><th scope="col">Metric</th><th scope="col" class="num">{period.startY}</th><th scope="col" class="num">{period.endY}</th></tr></thead>
						<tbody>
							<tr><td>Population</td><td class="num">{fmtInt(aggregate.popStart)}</td><td class="num">{fmtInt(aggregate.popEnd)}</td></tr>
							<tr><td>Housing units</td><td class="num">{fmtInt(aggregate.huStart)}</td><td class="num">{fmtInt(aggregate.huEnd)}</td></tr>
							{#if aggregate.huStart > 0}
								<tr>
									<td>HU change (census)</td>
									<td colspan="2" class="num">{fmtInt(aggregate.huChange)} ({fmtPctChange((aggregate.huChange / aggregate.huStart) * 100)})</td>
								</tr>
							{/if}
						</tbody>
					</table>
					<section class="axis-inspection">
						<h4 class="subhead">X-axis variables (aggregate)</h4>
						<p class="axis-note">
							Full labels from chart metadata. Census net HU change is from decennial counts (not
							MassBuilds). New units and new affordable (MassBuilds) are summed across the
							selection; other MassBuilds X metrics are means of per-tract scatter values under
							current development filters.
						</p>
						<table class="axis-metrics">
							<thead>
								<tr>
									<th scope="col">Metric</th>
									<th scope="col" class="num">Value</th>
								</tr>
							</thead>
							<tbody>
								{#each meta.xVariables ?? [] as xv (xv.key)}
									<tr>
										<td class="axis-metric-label">{xv.label}</td>
										<td class="num">{formatXAxisValue(xv.key, aggregate.xStats[xv.key])}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</section>
					<section class="axis-inspection">
						<h4 class="subhead">Y-axis variables — mean ({period.tag.replace('_', '–')})</h4>
						<p class="axis-note">
							All tract-level change fields available on the scatter Y axis, with full metadata
							labels.
						</p>
						{#each groupedYVars as group (group.cat)}
							<h5 class="axis-group-title">{group.catLabel}</h5>
							<table class="axis-metrics">
								<thead>
									<tr>
										<th scope="col">Metric</th>
										<th scope="col" class="num">Mean</th>
									</tr>
								</thead>
								<tbody>
									{#each group.vars as yv (yv.key)}
										<tr>
											<td class="axis-metric-label">{yv.label}</td>
											<td class="num">
												{formatYAxisValue(yv.key, aggregate.yMeans[`${yv.key}_${period.tag}`])}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/each}
					</section>
					<section class="dev">
						<h4 class="subhead">Development totals ({period.tag.replace('_', '–')})</h4>
						<ul class="dev-grid">
							<li><span class="lbl">New units (MassBuilds)</span><span class="val">{fmtInt(aggregate.totalNewUnits)}</span></li>
							<li><span class="lbl">New affordable</span><span class="val">{fmtInt(aggregate.totalAffordable)}</span></li>
							<li><span class="lbl">Affordable share</span><span class="val">{aggregate.totalNewUnits ? fmtShare(aggregate.totalAffordable / aggregate.totalNewUnits) : '—'}</span></li>
							<li><span class="lbl">Multifamily share</span><span class="val">{aggregate.totalNewUnits ? fmtShare(aggregate.totalMultifam / aggregate.totalNewUnits) : '—'}</span></li>
						</ul>
					</section>
				</article>
			{/if}

			{#if selectedList.length <= 10}
			{#each selectedList as gid (gid)}
				{@const t = tractByGisjoin.get(gid)}
				<article class="card">
					{#if !t}
						<p class="missing">No tract data for <span class="mono">{gid}</span>.</p>
					{:else}
						<header class="card-head">
							<div>
								<div class="tract-id mono">{t.gisjoin}</div>
								<div class="county">{t.county ?? '—'}</div>
							</div>
							<div class="period-pill">{period.startY}–{period.endY}</div>
						</header>

						<table class="metrics">
							<thead>
								<tr>
									<th scope="col">Metric</th>
									<th scope="col" class="num">{period.startY}</th>
									<th scope="col" class="num">{period.endY}</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td>Population</td>
									<td class="num">{fmtInt(t[`pop_${period.startY}`])}</td>
									<td class="num">{fmtInt(t[`pop_${period.endY}`])}</td>
								</tr>
								<tr>
									<td>Minority %</td>
									<td class="num">{fmtPctVal(t[`minority_pct_${period.startY}`])}</td>
									<td class="num">{fmtPctVal(t[`minority_pct_${period.endY}`])}</td>
								</tr>
								<tr>
									<td>Housing units</td>
									<td class="num">{fmtInt(t[`total_hu_${period.startY}`])}</td>
									<td class="num">{fmtInt(t[`total_hu_${period.endY}`])}</td>
								</tr>
								{#if t[`total_hu_${period.startY}`] != null && t[`total_hu_${period.endY}`] != null}
									<tr>
										<td>HU change (census)</td>
										<td colspan="2" class="num">
											{fmtInt(t[`total_hu_${period.endY}`] - t[`total_hu_${period.startY}`])} ({fmtPctChange(((t[`total_hu_${period.endY}`] - t[`total_hu_${period.startY}`]) / t[`total_hu_${period.startY}`]) * 100)})
										</td>
									</tr>
								{/if}
								<tr>
									<td>Owner-occupied %</td>
									<td class="num">{fmtPctVal(t[`owner_pct_${period.startY}`])}</td>
									<td class="num">{fmtPctVal(t[`owner_pct_${period.endY}`])}</td>
								</tr>
								<tr>
									<td>Median income</td>
									<td class="num">{fmtMoney(t[`median_income_${period.startY}`])}</td>
									<td class="num">{fmtMoney(t[`median_income_${period.endY}`])}</td>
								</tr>
							</tbody>
						</table>

						<section class="axis-inspection">
							<h4 class="subhead">X-axis variables (tract)</h4>
							<p class="axis-note">
								Census net HU change uses decennial housing stock; MassBuilds metrics use filtered
								developments (same as scatter).
							</p>
							<table class="axis-metrics">
								<thead>
									<tr>
										<th scope="col">Metric</th>
										<th scope="col" class="num">Value</th>
									</tr>
								</thead>
								<tbody>
									{#each meta.xVariables ?? [] as xv (xv.key)}
										<tr>
											<td class="axis-metric-label">{xv.label}</td>
											<td class="num">
												{formatXAxisValue(
													xv.key,
													getScatterXValue(t, t.gisjoin, xv.key, panelDevAgg, panelState.timePeriod)
												)}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</section>

						<section class="axis-inspection">
							<h4 class="subhead">Y-axis variables ({period.tag.replace('_', '–')})</h4>
							<p class="axis-note">All census tract change metrics selectable as scatter Y.</p>
							{#each groupedYVars as group (group.cat)}
								<h5 class="axis-group-title">{group.catLabel}</h5>
								<table class="axis-metrics">
									<thead>
										<tr>
											<th scope="col">Metric</th>
											<th scope="col" class="num">Value</th>
										</tr>
									</thead>
									<tbody>
										{#each group.vars as yv (yv.key)}
											<tr>
												<td class="axis-metric-label">{yv.label}</td>
												<td class="num">
													{formatYAxisValue(yv.key, t[`${yv.key}_${period.tag}`])}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							{/each}
						</section>

						{@const devKey = `${t.gisjoin}_${period.tag}`}
						{@const devAgg = devByTractDecade.get(devKey)}
						<section class="dev">
							<h4 class="subhead">Development ({period.tag.replace('_', '–')})</h4>
							<ul class="dev-grid">
								<li>
									<span class="lbl">New units</span>
									<span class="val">{fmtInt(devAgg?.new_units)}</span>
								</li>
								<li>
									<span class="lbl">New affordable</span>
									<span class="val">{fmtInt(devAgg?.new_affordable)}</span>
								</li>
								<li>
									<span class="lbl">Affordable share</span>
									<span class="val">{devAgg?.new_units ? fmtShare(devAgg.new_affordable / devAgg.new_units) : '—'}</span>
								</li>
								<li>
									<span class="lbl">Multifamily share</span>
									<span class="val">{devAgg?.new_units ? fmtShare(devAgg.multifam / devAgg.new_units) : '—'}</span>
								</li>
							</ul>
						</section>

						<section class="transit">
							<h4 class="subhead">Transit access</h4>
							<ul class="transit-row">
								<li>
									<span class="lbl">Stops in tract</span>
									<span class="val">{fmtInt(t.transit_stops)}</span>
								</li>
								<li>
									<span class="lbl">Stops / mi²</span>
									<span class="val">{fmtStopsPerSqMi(t)}</span>
								</li>
								<li>
									<span class="lbl">Rapid transit</span>
									<span class="val">{fmtBool(t.has_rail)}</span>
								</li>
								<li>
									<span class="lbl">Commuter rail</span>
									<span class="val">{fmtBool(t.has_commuter_rail)}</span>
								</li>
								<li>
									<span class="lbl">Area (mi²)</span>
									<span class="val">{t.area_sq_mi != null ? d3.format('.3f')(t.area_sq_mi) : '—'}</span>
								</li>
							</ul>
						</section>

						<section class="race">
							<h4 class="subhead">Racial composition (share of tract pop.)</h4>
							<div
								class="race-host"
								use:raceComposition={{ tract: t, startY: period.startY, endY: period.endY }}
							></div>
						</section>
					{/if}
				</article>
			{/each}
			{:else}
				<p class="overflow-note">Individual tract cards are hidden when more than 10 tracts are selected. See aggregate summary above.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tract-detail {
		padding: 10px 12px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	.head-actions {
		display: flex;
		gap: 6px;
	}

	.title {
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.action-btn {
		padding: 4px 10px;
		font-size: 0.72rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-panel);
		color: var(--accent);
		cursor: pointer;
		white-space: nowrap;
	}

	.action-btn:hover {
		background: var(--bg-hover);
	}

	.action-btn.clear {
		color: var(--text-muted);
	}

	.aggregate-card {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 5%, var(--bg-panel));
	}

	.overflow-note {
		font-size: 0.8rem;
		color: var(--text-muted);
		font-style: italic;
		padding: 4px 0;
	}

	.empty {
		font-size: 0.875rem;
		color: var(--text-muted);
	}

	.scroll {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: min(420px, 55vh);
		overflow-y: auto;
		padding-right: 2px;
	}

	.card {
		padding: 10px 12px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
	}

	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 10px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border);
	}

	.tract-id {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text);
	}

	.county {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-top: 2px;
	}

	.period-pill {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 3px 8px;
		background: color-mix(in srgb, var(--bg-card) 70%, transparent);
		flex-shrink: 0;
	}

	.mono {
		font-family: var(--font-mono);
	}

	.missing {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}

	.metrics {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.75rem;
		margin-bottom: 10px;
	}

	.metrics th,
	.metrics td {
		padding: 4px 6px;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
	}

	.metrics th {
		text-align: left;
		color: var(--text-muted);
		font-weight: 600;
	}

	.metrics .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.subhead {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin-bottom: 6px;
	}

	.axis-inspection,
	.dev,
	.transit,
	.race {
		margin-top: 10px;
	}

	.axis-note {
		font-size: 0.68rem;
		color: var(--text-muted);
		line-height: 1.35;
		margin: 0 0 8px;
	}

	.axis-group-title {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-muted);
		margin: 10px 0 6px;
	}

	.axis-group-title:first-of-type {
		margin-top: 0;
	}

	.axis-metrics {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.72rem;
		margin-bottom: 4px;
	}

	.axis-metrics th,
	.axis-metrics td {
		padding: 4px 6px;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
		vertical-align: top;
	}

	.axis-metrics th {
		text-align: left;
		color: var(--text-muted);
		font-weight: 600;
	}

	.axis-metric-label {
		hyphens: auto;
		word-break: break-word;
		padding-right: 8px;
		line-height: 1.3;
	}

	.dev-grid {
		list-style: none;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 10px;
		font-size: 0.75rem;
	}

	.transit-row {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		font-size: 0.75rem;
	}

	.dev-grid li,
	.transit-row li {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.lbl {
		color: var(--text-muted);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.val {
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.race-host {
		width: 100%;
		min-height: 52px;
	}

	.race-host :global(svg) {
		display: block;
		max-width: 100%;
	}
</style>
