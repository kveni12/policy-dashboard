<script>
	import { tractData, developments, meta } from '$lib/stores/data.svelte.js';
	import {
		filterTractsByTract,
		getTodTracts,
		getNonTodTracts,
		aggregateDevsByTract,
		computeRegression,
		filterPointsTenSigmaMarginals,
		filterDevelopments,
		cohortYMeansForPanel,
		computeGroupMean,
		popWeightKey,
		yMetricDisplayKind,
		formatYMetricSummary,
		transitModeUiLabel
	} from '$lib/utils/derived.js';
	import { periodDisplayLabel, periodCensusBounds } from '$lib/utils/periods.js';
	import PolicyCohortMap from '$lib/components/PolicyCohortMap.svelte';
	import * as d3 from 'd3';

	let timePeriod = $state('10_20');
	let todMinStopsPerSqMi = $state(4);
	let nonTodMaxStopsPerSqMi = $state(4);
	let todMinAffordableSharePct = $state(0);
	let nonTodMinAffordableSharePct = $state(0);
	let todMinStockIncreasePct = $state(0);
	let nonTodMinStockIncreasePct = $state(0);
	let todTransitModes = $state({ rail: true, commuter_rail: true, bus: true });
	let nonTodTransitModes = $state({ rail: true, commuter_rail: true, bus: true });

	let minStopsPerSqMi = $state(0);
	let minPopulation = $state(0);
	// Match dashboard createPanelState() tract-universe defaults.
	let minPopDensity = $state(200);
	let minHuChange = $state(20);

	/** MassBuilds project filters (same semantics as the main dashboard). */
	let minUnitsPerProject = $state(0);
	let minDevMultifamilyRatioPct = $state(0);
	let minDevAffordableRatioPct = $state(0);
	let includeRedevelopment = $state(true);

	/**
	 * How to split TOD tracts into high- vs. low-affordable-share groups for the additional comparison block.
	 * ``median``: ≥ median vs. &lt; median. ``custom``: high ≥ high min %, low &lt; low max % (non-overlapping bands).
	 */
	let affShareSplitMode = $state('median');
	/** Custom: affordable share of new development (0–1 scale) must be ≥ this percent to count as “high”. */
	let affHighMinPct = $state(20);
	/** Custom: share must be &lt; this percent to count as “low”. Require high min &gt; low max so bands don’t overlap. */
	let affLowMaxPct = $state(10);

	const panelConfig = $derived({
		timePeriod,
		minStopsPerSqMi,
		todMinStopsPerSqMi,
		nonTodMaxStopsPerSqMi,
		todTransitModes,
		nonTodTransitModes,
		todMinAffordableSharePct,
		nonTodMinAffordableSharePct,
		todMinStockIncreasePct,
		nonTodMinStockIncreasePct,
		minPopulation,
		minPopDensity,
		minHuChange,
		minUnitsPerProject,
		minDevMultifamilyRatioPct,
		minDevAffordableRatioPct,
		includeRedevelopment
	});

	/** Recompute cohort means when any cohort / universe input changes (matches dashboard). */
	const cohortComparisonKey = $derived(JSON.stringify(panelConfig));

	/**
	 * Population-weighted TOD vs non-TOD means for every scatter Y-axis metric (same logic as the dashboard cohort summary).
	 */
	const cohortRowsByY = $derived.by(() => {
		void cohortComparisonKey;
		void meta.yVariables?.length;
		const rows = [];
		for (const v of meta.yVariables ?? []) {
			const raw = cohortYMeansForPanel(tractData, { ...panelConfig, yVar: v.key });
			if (!raw) continue;
			const kind = yMetricDisplayKind(v);
			rows.push({
				key: v.key,
				label: v.label ?? v.key,
				catLabel: v.catLabel ?? 'Outcomes',
				fmtTod: formatYMetricSummary(raw.meanTod, kind),
				fmtCtrl: formatYMetricSummary(raw.meanNonTod, kind),
				nTod: raw.nTod,
				nNonTod: raw.nNonTod,
				nTodWithY: raw.nTodWithY,
				nNonTodWithY: raw.nNonTodWithY,
				weightLabel: raw.weightLabel
			});
		}
		return rows;
	});

	const periodLabel = $derived(periodDisplayLabel(timePeriod));

	function toggleTodMode(key) {
		todTransitModes = { ...todTransitModes, [key]: !todTransitModes[key] };
	}

	function toggleNonTodMode(key) {
		nonTodTransitModes = { ...nonTodTransitModes, [key]: !nonTodTransitModes[key] };
	}

	const fmtPP = d3.format('.1f');
	const fmtPct = d3.format('.1f');
	const fmtR2 = d3.format('.2f');

	function toneForSignedMetric(v) {
		if (!Number.isFinite(v)) return 'neutral';
		if (v > 0) return 'success';
		if (v < 0) return 'danger';
		return 'neutral';
	}

	function meanFinite(tracts, key) {
		const vals = tracts.map((t) => t[key]).filter(Number.isFinite);
		if (!vals.length) return null;
		return d3.mean(vals);
	}

	function fmtMetric(v, unit) {
		if (!Number.isFinite(v)) return '\u2014';
		return unit === 'pp' ? `${fmtPP(v)} pp` : `${fmtPct(v)}%`;
	}

	const rows = $derived.by(() => filterTractsByTract(tractData, panelConfig));

	const todRows = $derived.by(() => getTodTracts(tractData, panelConfig));

	const nonTodRows = $derived.by(() => getNonTodTracts(tractData, panelConfig));

	// Affordable-share splits and regression use the same filtered MassBuilds set as the dashboard dev metrics.
	const affShareMap = $derived.by(() => {
		const tractMap = new Map();
		for (const t of tractData) if (t.gisjoin) tractMap.set(t.gisjoin, t);
		const filteredDevs = filterDevelopments(developments, panelConfig);
		return aggregateDevsByTract(filteredDevs, tractMap, timePeriod);
	});

	/** TOD tracts with filtered MassBuilds affordable-share data; split into high / low per user rules. */
	const affSplitCohorts = $derived.by(() => {
		void cohortComparisonKey;
		void affShareSplitMode;
		void affHighMinPct;
		void affLowMaxPct;
		const tod = todRows;
		const todAff = tod.filter((t) => {
			const agg = affShareMap.get(t.gisjoin);
			return agg && Number.isFinite(agg.affordable_share);
		});
		const getAffShare = (t) => affShareMap.get(t.gisjoin)?.affordable_share ?? NaN;
		let hiAff = [];
		let loAff = [];
		let splitDescription = '';
		if (affShareSplitMode === 'median') {
			const medAff = d3.median(todAff, getAffShare);
			if (Number.isFinite(medAff)) {
				hiAff = todAff.filter((t) => getAffShare(t) >= medAff);
				loAff = todAff.filter((t) => getAffShare(t) < medAff);
				splitDescription = `median affordable share (${(medAff * 100).toFixed(1)}%): high \u2265 median, low &lt; median`;
			}
		} else {
			const hiTh = Math.min(100, Math.max(0, Number(affHighMinPct) || 0)) / 100;
			const loTh = Math.min(100, Math.max(0, Number(affLowMaxPct) || 0)) / 100;
			if (hiTh > loTh) {
				hiAff = todAff.filter((t) => getAffShare(t) >= hiTh);
				loAff = todAff.filter((t) => getAffShare(t) < loTh);
				splitDescription = `high \u2265${affHighMinPct}% vs. low &lt;${affLowMaxPct}% (tracts between these cutoffs are excluded)`;
			} else {
				splitDescription =
					'set \u201chigh\u201d minimum above \u201clow\u201d maximum to define non-overlapping groups';
			}
		}
		const customBandsValid = affShareSplitMode === 'median' || affHighMinPct > affLowMaxPct;
		return {
			todAff,
			hiAff,
			loAff,
			splitDescription,
			customBandsValid
		};
	});

	const affSplitComparisonKey = $derived(
		`${cohortComparisonKey}|${affShareSplitMode}|${affHighMinPct}|${affLowMaxPct}`
	);

	/** Population-weighted means for every Y: high vs. low affordable-share TOD tracts (mirrors main outcomes block). */
	const affSplitRowsByY = $derived.by(() => {
		void affSplitComparisonKey;
		void meta.yVariables?.length;
		const { hiAff, loAff, customBandsValid } = affSplitCohorts;
		if (!customBandsValid) return [];
		const tp = timePeriod;
		const weightKey = popWeightKey(tp);
		const { startY } = periodCensusBounds(tp);
		const weightLabel = `population in ${startY} (start of selected period)`;
		const rows = [];
		for (const v of meta.yVariables ?? []) {
			const yKey = `${v.key}_${tp}`;
			const meanHi = computeGroupMean(hiAff, yKey, weightKey);
			const meanLo = computeGroupMean(loAff, yKey, weightKey);
			const kind = yMetricDisplayKind(v);
			const nHiWithY = hiAff.filter(
				(t) => t[yKey] != null && Number.isFinite(Number(t[yKey]))
			).length;
			const nLoWithY = loAff.filter(
				(t) => t[yKey] != null && Number.isFinite(Number(t[yKey]))
			).length;
			rows.push({
				key: v.key,
				label: v.label ?? v.key,
				catLabel: v.catLabel ?? 'Outcomes',
				fmtHi: formatYMetricSummary(meanHi, kind),
				fmtLo: formatYMetricSummary(meanLo, kind),
				nHi: hiAff.length,
				nLo: loAff.length,
				nHiWithY,
				nLoWithY,
				weightLabel
			});
		}
		return rows;
	});

	const keyFindings = $derived.by(() => {
		const tp = timePeriod;
		const tk = `transit_pct_change_${tp}`;

		const tod = todRows;
		const nonTod = nonTodRows;

		const todAff = tod.filter((t) => {
			const agg = affShareMap.get(t.gisjoin);
			return agg && Number.isFinite(agg.affordable_share);
		});

		const rail = rows.filter((t) => t.has_rail === true);
		const noRail = rows.filter((t) => t.has_rail !== true);
		const railT = meanFinite(rail, tk);
		const noRailT = meanFinite(noRail, tk);

		const cards = [];

		if (rail.length && noRail.length && Number.isFinite(railT) && Number.isFinite(noRailT)) {
			const gap = railT - noRailT;
			cards.push({
				id: 'rail-transit',
				title: 'Transit commute share change (rapid transit vs. no rapid transit access)',
				value: fmtMetric(railT, 'pp'),
				compare: `vs ${fmtMetric(noRailT, 'pp')} in tracts without rapid transit (subway/light rail) access`,
				blurb:
					gap > 0.1
						? 'Tracts near rapid transit posted larger average gains in transit commuting\u2014service quality and land use likely reinforce one another, but this is descriptive, not causal.'
						: gap < -0.1
							? 'Tracts without rapid transit access saw stronger average transit commute share gains\u2014bus and multimodal networks still shape mode choice across the state.'
							: 'Average transit commute share changes were similar for tracts with vs. without rapid transit access\u2014mode shifts depend on corridor context beyond a single flag.',
				tone: toneForSignedMetric(railT)
			});
		}

		return { cards, nTracts: rows.length, nTod: tod.length, nNonTod: nonTod.length, todAffN: todAff.length };
	});

	const regressionNote = $derived.by(() => {
		const mk = `minority_pct_change_${timePeriod}`;
		const tod = todRows;
		const points = tod
			.map((t) => {
				const agg = affShareMap.get(t.gisjoin);
				const x = agg?.affordable_share;
				const y = t[mk];
				return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
			})
			.filter(Boolean);
		if (points.length < 3) return null;
		const fitted = filterPointsTenSigmaMarginals(points);
		if (fitted.length < 2) return null;
		const { slope, r2 } = computeRegression(fitted);
		return { n: fitted.length, nTotal: points.length, slope, r2 };
	});

	const recommendations = [
		'Inclusionary zoning mandates near transit stations',
		'Anti-displacement protections (right to return, tenant opportunity-to-purchase)',
		'Community land trusts in TOD zones',
		'Affordable housing trust fund contributions tied to market-rate TOD permits',
		'MBTA Communities Act compliance guidance \u2014 not just zoning, but how to zone'
	];
</script>

<section class="policy-page" aria-labelledby="policy-title">
	<header class="hero">
		<h1 id="policy-title">Policy Insights: TOD &amp; Demographic Change in Massachusetts</h1>
		<p class="subtitle">
			Data-driven findings to inform equitable transit-oriented development policy
		</p>
	</header>

	<!-- ── Filters ─────────────────────────────────────────── -->
	<div class="filter-bar">
		<fieldset class="filter-group">
			<legend class="filter-legend">Time period</legend>
			<select class="filter-select" bind:value={timePeriod}>
				<option value="90_00">1990–2000</option>
				<option value="00_10">2000–2010</option>
				<option value="10_20">2010–2020</option>
				<option value="90_20">1990–2020</option>
			</select>
		</fieldset>

		<fieldset class="filter-group filter-group--census-wide">
			<legend class="filter-legend">Census tract filtering</legend>
			<p class="filter-sub">Overall (all views)</p>
			<div class="filter-row">
				<label class="filter-field" title="Minimum population">
					<span class="filter-label">Pop.</span>
					<input type="number" min="0" step="100" bind:value={minPopulation} />
				</label>
				<label class="filter-field" title="Min pop density (per mi²)">
					<span class="filter-label">Pop/mi²</span>
					<input type="number" min="0" step="100" bind:value={minPopDensity} />
				</label>
				<label class="filter-field" title="Min HU change (census)">
					<span class="filter-label">ΔHU</span>
					<input type="number" min="0" step="10" bind:value={minHuChange} />
				</label>
				<label class="filter-field" title="Min stops/mi² (analysis universe)">
					<span class="filter-label">Min stops</span>
					<input type="number" min="0" step="0.5" bind:value={minStopsPerSqMi} />
				</label>
			</div>
			<div class="policy-cohort-grid">
				<div class="policy-cohort">
					<p class="filter-sub">Non-TOD (control)</p>
					<label class="filter-field" title="Max stops/mi² for control cohort; 0 = no ceiling">
						<span class="filter-label">Max stops</span>
						<input type="number" min="0" step="0.5" bind:value={nonTodMaxStopsPerSqMi} />
					</label>
					<label class="filter-field" title="Min MassBuilds affordable share (%) for control cohort; 0 = off">
						<span class="filter-label">Min aff. %</span>
						<input type="number" min="0" max="100" step="1" bind:value={nonTodMinAffordableSharePct} />
					</label>
					<div class="filter-chips">
						{#each Object.keys(nonTodTransitModes) as key (key)}
							<button
								type="button"
								class="chip"
								class:active={nonTodTransitModes[key]}
								onclick={() => toggleNonTodMode(key)}
							>
								{transitModeUiLabel(key)}
							</button>
						{/each}
					</div>
				</div>
				<div class="policy-cohort">
					<p class="filter-sub">TOD (analyzing)</p>
					<label class="filter-field" title="Min stops/mi² to count as TOD; 0 = any stop">
						<span class="filter-label">Min TOD</span>
						<input type="number" min="0" step="0.5" bind:value={todMinStopsPerSqMi} />
					</label>
					<label class="filter-field" title="Min MassBuilds affordable share (%) for TOD cohort; 0 = off">
						<span class="filter-label">Min aff. %</span>
						<input type="number" min="0" max="100" step="1" bind:value={todMinAffordableSharePct} />
					</label>
					<label
						class="filter-field"
						title="Min housing stock increase (%): tract new units ÷ census HU at period start; 0 = off"
					>
						<span class="filter-label">Min Δstock %</span>
						<input type="number" min="0" step="0.1" bind:value={todMinStockIncreasePct} />
					</label>
					<div class="filter-chips">
						{#each Object.keys(todTransitModes) as key (key)}
							<button
								type="button"
								class="chip"
								class:active={todTransitModes[key]}
								onclick={() => toggleTodMode(key)}
							>
								{transitModeUiLabel(key)}
							</button>
						{/each}
					</div>
				</div>
			</div>
		</fieldset>

		<fieldset class="filter-group filter-group--dev-wide">
			<legend class="filter-legend">Development filters</legend>
			<p class="filter-hint">
				Which MassBuilds projects count toward <strong>affordable-share</strong> splits and the regression note
				below. Cohort definitions and census Y means still use tract fields only; TOD / non-TOD
				&ldquo;min aff. %&rdquo; and &ldquo;min Δstock %&rdquo; use full-tract MassBuilds totals (same as the
				dashboard), not these per-project filters.
			</p>
			<div class="filter-row filter-row--dev">
				<label
					class="filter-field"
					title="Exclude individual projects below this unit count"
				>
					<span class="filter-label">Min units / proj.</span>
					<input type="number" min="0" step="1" bind:value={minUnitsPerProject} />
				</label>
				<label
					class="filter-field"
					title="Each project must have at least this share of units in small + large multifamily. 0 = off."
				>
					<span class="filter-label">Min MF ratio (%)</span>
					<input
						type="number"
						min="0"
						max="100"
						step="1"
						bind:value={minDevMultifamilyRatioPct}
					/>
				</label>
				<label class="filter-field" title="Each project must have at least this affordable unit share. 0 = off.">
					<span class="filter-label">Min aff. ratio (%)</span>
					<input
						type="number"
						min="0"
						max="100"
						step="1"
						bind:value={minDevAffordableRatioPct}
					/>
				</label>
			</div>
			<label class="filter-check">
				<input type="checkbox" bind:checked={includeRedevelopment} />
				<span>Include redevelopment</span>
			</label>
		</fieldset>
	</div>

	<!-- ── Cohort geography (matches filters above) ───────────────── -->
	<section class="section section--cohort-map" aria-labelledby="cohort-map-heading">
		<h2 id="cohort-map-heading" class="section-title">TOD vs. non-TOD tracts on the map</h2>
		<p class="section-lead">
			Each tract is colored by the same TOD and non-TOD (control) rules as the tables below. Tracts that pass overall
			filters but match neither cohort appear in slate; tracts that fail overall filters stay subdued.
		</p>
		<PolicyCohortMap panelConfig={panelConfig} />
	</section>

	<!-- ── TOD vs control: all Y outcomes (dashboard-style) ── -->
	<section class="section" aria-labelledby="outcomes-heading">
		<h2 id="outcomes-heading" class="section-title">TOD vs. non-TOD outcomes</h2>
		<p class="section-lead">
			Population-weighted means for every dashboard outcome metric ({periodLabel}), using the same cohort rules as
			the main analysis panel ({keyFindings.nTracts.toLocaleString()} tracts after filters;
			{keyFindings.nTod.toLocaleString()} TOD, {keyFindings.nNonTod.toLocaleString()} non-TOD).
			{#if todMinStopsPerSqMi > 0}
				TOD: &ge;{todMinStopsPerSqMi} stops/mi² (plus TOD mode toggles). Non-TOD control: max stops/mi² when set
				(&gt;0).
			{:else}
				TOD: at least one MBTA stop in the buffer (plus TOD mode toggles). Non-TOD control excludes tracts that
				also meet the TOD definition.
			{/if}
			{#if cohortRowsByY[0]}
				Means weighted by tract {cohortRowsByY[0].weightLabel} (same as the dashboard bar chart).
			{/if}
		</p>

		{#if cohortRowsByY.length === 0}
			<div class="empty-card" role="status">
				<p>No tract statistics are available yet. Load dashboard data to populate comparisons.</p>
			</div>
		{:else}
			<div class="outcome-comparison-list">
				{#each cohortRowsByY as row, i (row.key)}
					{#if i === 0 || cohortRowsByY[i - 1].catLabel !== row.catLabel}
						<h3 class="outcome-cat-heading">{row.catLabel}</h3>
					{/if}
					<div
						class="cohort-summary policy-cohort-block"
						role="group"
						aria-label="{row.label}: population-weighted TOD vs non-TOD means"
					>
						<p class="cohort-summary-heading">{row.label}</p>
						<div class="cohort-summary-grid">
							<div class="cohort-pill cohort-pill--tod">
								<span class="cohort-pill-label">TOD (analysis)</span>
								<span class="cohort-pill-value">{row.fmtTod}</span>
								<span class="cohort-pill-n">
									{row.nTodWithY} / {row.nTod} tracts with data
								</span>
							</div>
							<div class="cohort-pill cohort-pill--ctrl">
								<span class="cohort-pill-label">non-TOD (control)</span>
								<span class="cohort-pill-value">{row.fmtCtrl}</span>
								<span class="cohort-pill-n">
									{row.nNonTodWithY} / {row.nNonTod} tracts with data
								</span>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- ── Additional comparisons ─────────────────────────── -->
	<section class="section" aria-labelledby="findings-heading">
		<h2 id="findings-heading" class="section-title">Additional comparisons</h2>

		<div class="aff-split-block">
			<h3 class="subsection-title">TOD: high vs. low affordable development share</h3>
			<p class="section-lead section-lead--tight">
				Among TOD tracts with MassBuilds affordable-share data under your development filters (
				{affSplitCohorts.todAff.length.toLocaleString()} tracts), compare population-weighted outcome means
				({periodLabel}) for a <strong>high</strong> vs. <strong>low</strong> affordable-share group.
			</p>

			<fieldset class="aff-split-controls">
				<legend class="aff-split-legend">Split definition</legend>
				<div class="aff-split-mode-row">
					<label class="aff-split-radio">
						<input type="radio" bind:group={affShareSplitMode} name="aff-split-mode" value="median" />
						<span>Median split</span>
					</label>
					<label class="aff-split-radio">
						<input type="radio" bind:group={affShareSplitMode} name="aff-split-mode" value="custom" />
						<span>Custom % cutoffs</span>
					</label>
				</div>
				{#if affShareSplitMode === 'custom'}
					<div class="aff-split-threshold-row">
						<label class="filter-field aff-split-field" title="TOD tract counts as high if affordable share of new units ≥ this %">
							<span class="filter-label">High: min. share (%)</span>
							<input type="number" min="0" max="100" step="1" bind:value={affHighMinPct} />
						</label>
						<label class="filter-field aff-split-field" title="TOD tract counts as low if affordable share &lt; this % (must be less than high min)">
							<span class="filter-label">Low: below (%)</span>
							<input type="number" min="0" max="100" step="1" bind:value={affLowMaxPct} />
						</label>
					</div>
					{#if affHighMinPct <= affLowMaxPct}
						<p class="aff-split-warn" role="status">
							Set the high minimum <strong>above</strong> the low cutoff so the two groups do not overlap.
						</p>
					{/if}
				{/if}
				<p class="aff-split-meta">
					<strong>Current rule:</strong>
					{affSplitCohorts.splitDescription}
					· High <code class="aff-split-code">{affSplitCohorts.hiAff.length}</code> tracts, low
					<code class="aff-split-code">{affSplitCohorts.loAff.length}</code> tracts.
				</p>
			</fieldset>

			{#if !affSplitCohorts.customBandsValid}
				<div class="empty-card" role="status">
					<p>Adjust the custom cutoffs to view comparisons.</p>
				</div>
			{:else if affSplitCohorts.hiAff.length === 0 || affSplitCohorts.loAff.length === 0}
				<div class="empty-card" role="status">
					<p>
						No tracts in one or both groups with the current split. Try different filters, development rules,
						or cutoffs.
					</p>
				</div>
			{:else if affSplitRowsByY.length === 0}
				<div class="empty-card" role="status">
					<p>No outcome metrics loaded.</p>
				</div>
			{:else}
				<p class="section-lead section-lead--tight aff-split-weight-note">
					Means weighted by tract {affSplitRowsByY[0].weightLabel} (same as the TOD vs. non-TOD block above).
				</p>
				<div class="outcome-comparison-list">
					{#each affSplitRowsByY as row, i (row.key)}
						{#if i === 0 || affSplitRowsByY[i - 1].catLabel !== row.catLabel}
							<h3 class="outcome-cat-heading">{row.catLabel}</h3>
						{/if}
						<div
							class="cohort-summary policy-cohort-block"
							role="group"
							aria-label="{row.label}: high vs. low affordable-share TOD means"
						>
							<p class="cohort-summary-heading">{row.label}</p>
							<div class="cohort-summary-grid">
								<div class="cohort-pill cohort-pill--high-aff">
									<span class="cohort-pill-label">High aff. share (TOD)</span>
									<span class="cohort-pill-value">{row.fmtHi}</span>
									<span class="cohort-pill-n">
										{row.nHiWithY} / {row.nHi} tracts with data
									</span>
								</div>
								<div class="cohort-pill cohort-pill--low-aff">
									<span class="cohort-pill-label">Low aff. share (TOD)</span>
									<span class="cohort-pill-value">{row.fmtLo}</span>
									<span class="cohort-pill-n">
										{row.nLoWithY} / {row.nLo} tracts with data
									</span>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if keyFindings.cards.length > 0}
			<h3 class="subsection-title subsection-title--follow">Other descriptive splits</h3>
			<p class="section-lead section-lead--tight">
				Simple <strong>unweighted</strong> tract averages (not population-weighted) for quick context.
			</p>
			<div class="findings-grid">
				{#each keyFindings.cards as card (card.id)}
					<article class="finding-card tone-{card.tone}">
						<h3 class="finding-title">{card.title}</h3>
						<p class="finding-value">{card.value}</p>
						<p class="finding-compare">{card.compare}</p>
						<p class="finding-blurb">{card.blurb}</p>
					</article>
				{/each}
			</div>
		{/if}
	</section>

	<section class="section" aria-labelledby="rec-heading">
		<h2 id="rec-heading" class="section-title">Policy recommendations</h2>
		<ul class="rec-list">
			{#each recommendations as item, i (i)}
				<li class="rec-item">
					<span class="rec-icon" aria-hidden="true">
						<svg viewBox="0 0 24 24" width="20" height="20" fill="none">
							<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" />
							<path
								d="M8 12l2.5 2.5L16 9"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</span>
					<span class="rec-text">{item}</span>
				</li>
			{/each}
		</ul>
	</section>

	<footer class="method-footer">
		<h2 class="method-title">Methodology note</h2>
		<p>
			These statistics summarize tract-level changes from American Community Survey and decennial inputs
			processed for this dashboard; variable definitions follow the chart metadata catalog ({meta.yVariables
				?.length ?? 0} outcome metrics configured). Patterns are <strong>descriptive correlations</strong> across
			space and time—they do not establish that transit investment, zoning, or development <em>caused</em> demographic
			outcomes. Omitted variables (regional job growth, school quality, prior redevelopment, etc.) can confound
			simple comparisons.
		</p>
		{#if regressionNote}
			<p class="method-reg">
				Among TOD tracts with affordable-share data (<code>n = {regressionNote.n}</code>
				{#if regressionNote.n < regressionNote.nTotal}
					after dropping points outside &plusmn;10&sigma; on affordable share and on minority share change (marginal),
					of <code>{regressionNote.nTotal}</code> with data
				{/if}), an ordinary least-squares line of minority share change on affordable share of new development
				({periodLabel}) has slope
				<code>{fmtPP(regressionNote.slope)}</code> percentage points per unit affordable share and
				<code>R² = {fmtR2(regressionNote.r2)}</code>—a reminder that single-variable fits explain limited variance.
			</p>
		{/if}
	</footer>
</section>

<style>
	.policy-page {
		max-width: 72rem;
		margin: 0 auto;
		padding: 28px 18px 56px;
		display: flex;
		flex-direction: column;
		gap: 36px;
		background: var(--bg);
		min-height: 100%;
	}

	.hero {
		padding-bottom: 8px;
		border-bottom: 1px solid var(--border);
	}

	h1 {
		font-size: clamp(1.35rem, 2.5vw, 1.85rem);
		font-weight: 700;
		color: var(--text);
		letter-spacing: -0.02em;
		line-height: 1.2;
	}

	.subtitle {
		margin-top: 10px;
		font-size: 1rem;
		color: var(--text-muted);
		line-height: 1.55;
		max-width: 44rem;
	}

	/* ── Filter bar ──────────────────────────────────────── */
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		padding: 14px 16px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.filter-group {
		border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
		border-radius: var(--radius-sm);
		padding: 6px 10px 8px;
		margin: 0;
		min-width: 0;
	}

	.filter-group--census-wide {
		flex: 1 1 100%;
		min-width: min(100%, 28rem);
	}

	.filter-group--dev-wide {
		flex: 1 1 100%;
		min-width: min(100%, 36rem);
	}

	.filter-hint {
		font-size: 0.6875rem;
		line-height: 1.45;
		color: var(--text-muted);
		margin: 0 0 8px;
		max-width: 48rem;
	}

	.filter-row--dev {
		margin-bottom: 6px;
	}

	.filter-check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.75rem;
		color: var(--text-muted);
		cursor: pointer;
		margin: 0;
	}

	.filter-check input {
		accent-color: var(--accent);
		margin: 0;
	}

	.filter-sub {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin: 6px 0 4px;
	}

	.policy-cohort-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 10px;
		margin-top: 4px;
	}

	@media (min-width: 640px) {
		.policy-cohort-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.policy-cohort {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 6px 8px;
		background: color-mix(in srgb, var(--bg-panel) 85%, var(--bg-card));
	}

	.filter-legend {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		padding: 0 4px;
	}

	.filter-select {
		font-size: 0.8125rem;
		padding: 4px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-panel);
		color: var(--text);
	}

	.filter-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: flex-end;
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.filter-field input {
		width: 5.5rem;
	}

	.filter-label {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.filter-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.chip {
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--bg-panel);
		color: var(--text-muted);
		font-size: 0.7rem;
		text-transform: capitalize;
		cursor: pointer;
	}

	.chip.active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
	}

	/* ── Findings ─────────────────────────────────────────── */
	.section-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 8px;
	}

	.section-lead {
		font-size: 0.875rem;
		color: var(--text-muted);
		line-height: 1.55;
		margin-bottom: 18px;
		max-width: 52rem;
	}

	.section-lead--tight {
		margin-bottom: 10px;
	}

	.subsection-title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 6px;
		line-height: 1.3;
	}

	.subsection-title--follow {
		margin-top: 28px;
	}

	.aff-split-block {
		margin-bottom: 8px;
	}

	.aff-split-controls {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 10px 12px 12px;
		margin: 0 0 16px;
		background: color-mix(in srgb, var(--bg-panel) 70%, var(--bg-card));
	}

	.aff-split-legend {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		padding: 0 2px;
	}

	.aff-split-mode-row {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 18px;
		margin: 8px 0 10px;
	}

	.aff-split-radio {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-muted);
		cursor: pointer;
	}

	.aff-split-radio input {
		accent-color: var(--accent);
		margin: 0;
	}

	.aff-split-threshold-row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 8px;
	}

	.aff-split-field.filter-field input {
		width: 5rem;
	}

	.aff-split-warn {
		font-size: 0.8125rem;
		color: var(--danger);
		margin: 0 0 8px;
		line-height: 1.4;
	}

	.aff-split-meta {
		font-size: 0.8125rem;
		color: var(--text-muted);
		line-height: 1.45;
		margin: 0;
		max-width: 48rem;
	}

	.aff-split-code {
		font-family: var(--font-mono, monospace);
		font-size: 0.85em;
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		color: var(--text);
	}

	.aff-split-weight-note {
		margin-top: 4px;
	}

	/* Dashboard-aligned TOD vs control blocks (matches AnalysisPanel cohort summary). */
	.outcome-comparison-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.outcome-cat-heading {
		margin: 20px 0 4px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}

	.outcome-comparison-list .outcome-cat-heading:first-child {
		margin-top: 0;
	}

	.policy-cohort-block {
		margin: 0;
	}

	.cohort-summary {
		padding: 8px 10px 9px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.cohort-summary-heading {
		margin: 0 0 6px;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		line-height: 1.25;
	}

	.cohort-summary-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	@media (max-width: 520px) {
		.cohort-summary-grid {
			grid-template-columns: 1fr;
		}
	}

	.cohort-pill {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		min-width: 0;
	}

	.cohort-pill--tod {
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-panel));
		border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
	}

	.cohort-pill--ctrl {
		background: color-mix(in srgb, #64748b 8%, var(--bg-panel));
		border-color: color-mix(in srgb, #64748b 28%, var(--border));
	}

	.cohort-pill-label {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.cohort-pill-value {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		line-height: 1.2;
	}

	.cohort-pill--tod .cohort-pill-value {
		color: var(--accent);
	}

	.cohort-pill--ctrl .cohort-pill-value {
		color: #64748b;
	}

	.cohort-pill--high-aff {
		background: color-mix(in srgb, #059669 10%, var(--bg-panel));
		border-color: color-mix(in srgb, #059669 32%, var(--border));
	}

	.cohort-pill--high-aff .cohort-pill-value {
		color: #059669;
	}

	.cohort-pill--low-aff {
		background: color-mix(in srgb, #78716c 10%, var(--bg-panel));
		border-color: color-mix(in srgb, #78716c 30%, var(--border));
	}

	.cohort-pill--low-aff .cohort-pill-value {
		color: #57534e;
	}

	.cohort-pill-n {
		font-size: 0.625rem;
		color: var(--text-muted);
		line-height: 1.2;
	}

	.empty-card {
		padding: 20px;
		background: var(--bg-panel);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.findings-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 14px;
	}

	@media (min-width: 640px) {
		.findings-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1100px) {
		.findings-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}

	.finding-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 16px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		border-left: 4px solid var(--accent);
	}

	.finding-card.tone-success {
		border-left-color: var(--success);
	}

	.finding-card.tone-danger {
		border-left-color: var(--danger);
	}

	.finding-card.tone-neutral {
		border-left-color: var(--accent);
	}

	.finding-title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-muted);
		line-height: 1.35;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.finding-value {
		font-size: 1.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		line-height: 1.1;
		letter-spacing: -0.02em;
	}

	.finding-compare {
		font-size: 0.8125rem;
		color: var(--accent);
		font-weight: 500;
	}

	.finding-blurb {
		font-size: 0.875rem;
		color: var(--text-muted);
		line-height: 1.5;
		margin-top: 4px;
	}

	/* ── Recommendations ──────────────────────────────────── */
	.rec-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.rec-item {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		font-size: 0.9375rem;
		color: var(--text);
		line-height: 1.45;
	}

	.rec-icon {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--success);
	}

	.rec-text {
		flex: 1;
	}

	/* ── Methodology ──────────────────────────────────────── */
	.method-footer {
		padding: 20px 18px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.method-title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--accent);
		margin-bottom: 10px;
	}

	.method-footer p {
		font-size: 0.8125rem;
		color: var(--text-muted);
		line-height: 1.6;
	}

	.method-footer p + p {
		margin-top: 10px;
	}

	.method-reg {
		padding-top: 4px;
	}

	.method-footer code {
		font-family: var(--font-mono, monospace);
		font-size: 0.8em;
		color: var(--text);
		background: var(--bg-card);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
	}
</style>
