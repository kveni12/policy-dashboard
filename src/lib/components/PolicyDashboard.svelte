<script>
	import * as d3 from 'd3';
	import { tractData, developments, meta } from '$lib/stores/data.svelte.js';
	import {
		getTodTracts,
		getNonTodTracts,
		aggregateDevsByTract,
		filterDevelopments,
		cohortYMeansForPanel,
		computeGroupMean,
		popWeightKey,
		yMetricDisplayKind,
		formatYMetricSummary,
		filterPointsTenSigmaMarginals,
		computeRegression
	} from '$lib/utils/derived.js';
	import { periodCensusBounds, periodDisplayLabel } from '$lib/utils/periods.js';
	import PolicyCohortMap from '$lib/components/PolicyCohortMap.svelte';

	let timePeriod = $state('10_20');
	let todMinStopsPerSqMi = $state(4);
	let nonTodMaxStopsPerSqMi = $state(4);
	let minPopDensity = $state(200);
	let minHuChange = $state(20);

	let minUnitsPerProject = $state(0);
	let minDevMultifamilyRatioPct = $state(0);
	let minDevAffordableRatioPct = $state(0);
	let includeRedevelopment = $state(true);

	const panelConfig = $derived({
		timePeriod,
		minStopsPerSqMi: 0,
		todMinStopsPerSqMi,
		nonTodMaxStopsPerSqMi,
		todTransitModes: { rail: true, commuter_rail: true, bus: true },
		nonTodTransitModes: { rail: true, commuter_rail: true, bus: true },
		todMinAffordableSharePct: 0,
		nonTodMinAffordableSharePct: 0,
		todMinStockIncreasePct: 0,
		nonTodMinStockIncreasePct: 0,
		minPopulation: 0,
		minPopDensity,
		minHuChange,
		minUnitsPerProject,
		minDevMultifamilyRatioPct,
		minDevAffordableRatioPct,
		includeRedevelopment
	});

	const periodLabel = $derived(periodDisplayLabel(timePeriod));
	const periodBounds = $derived(periodCensusBounds(timePeriod));

	const todRows = $derived.by(() => getTodTracts(tractData, panelConfig));
	const nonTodRows = $derived.by(() => getNonTodTracts(tractData, panelConfig));
	const analysisUniverse = $derived.by(() => todRows.length + nonTodRows.length);

	function lookupYMeta(baseKey) {
		return (meta.yVariables ?? []).find((v) => v.key === baseKey) ?? { key: baseKey, label: baseKey };
	}

	function metricSummary(baseKey) {
		const raw = cohortYMeansForPanel(tractData, { ...panelConfig, yVar: baseKey });
		if (!raw) return null;
		const metaRow = lookupYMeta(baseKey);
		const gap = raw.meanTod - raw.meanNonTod;
		return {
			...raw,
			key: baseKey,
			label: metaRow.label ?? baseKey,
			catLabel: metaRow.catLabel ?? '',
			kind: yMetricDisplayKind(metaRow),
			gap,
			fmtGap: formatYMetricSummary(gap, yMetricDisplayKind(metaRow))
		};
	}

	function metricSummaryForPeriod(period, baseKey) {
		const raw = cohortYMeansForPanel(tractData, { ...panelConfig, timePeriod: period, yVar: baseKey });
		if (!raw) return null;
		const metaRow = lookupYMeta(baseKey);
		const kind = yMetricDisplayKind(metaRow);
		const gap = raw.meanTod - raw.meanNonTod;
		return {
			...raw,
			period,
			periodLabel: periodDisplayLabel(period),
			key: baseKey,
			label: metaRow.label ?? baseKey,
			kind,
			gap,
			fmtTod: formatYMetricSummary(raw.meanTod, kind),
			fmtNonTod: formatYMetricSummary(raw.meanNonTod, kind),
			fmtGap: formatYMetricSummary(gap, kind)
		};
	}

	const minoritySummary = $derived.by(() => metricSummary('minority_pct_change'));
	const incomeSummary = $derived.by(() => metricSummary('median_income_change_pct'));
	const drivingSummary = $derived.by(() => metricSummary('drove_alone_pct_change'));
	const commuteSummary = $derived.by(() => metricSummary('avg_travel_time_change'));
	const educationSummary = $derived.by(() => metricSummary('bachelors_pct_change'));

	const periodAnalysis = $derived.by(() =>
		['90_00', '00_10', '10_20', '90_20'].map((period) => ({
			period,
			periodLabel: periodDisplayLabel(period),
			minority: metricSummaryForPeriod(period, 'minority_pct_change'),
			income: metricSummaryForPeriod(period, 'median_income_change_pct'),
			driving: metricSummaryForPeriod(period, 'drove_alone_pct_change'),
			commute: metricSummaryForPeriod(period, 'avg_travel_time_change')
		}))
	);

	const maxPeriodGapMagnitude = $derived.by(() => {
		const vals = periodAnalysis.flatMap((row) => [row.minority?.gap, row.income?.gap]).filter(Number.isFinite);
		return vals.length ? d3.max(vals.map((v) => Math.abs(v))) || 1 : 1;
	});

	function gapBarWidth(v) {
		if (!Number.isFinite(v)) return '0%';
		return `${Math.max(6, (Math.abs(v) / maxPeriodGapMagnitude) * 100)}%`;
	}

	function gapTone(v) {
		if (!Number.isFinite(v)) return 'neutral';
		return v >= 0 ? 'good' : 'warn';
	}

	const highlightCards = $derived.by(() => {
		const cards = [];
		if (minoritySummary) {
			cards.push({
				eyebrow: 'Lead demographic',
				title: 'Racial composition changes differently in TOD tracts',
				summary: `${formatYMetricSummary(minoritySummary.meanTod, minoritySummary.kind)} in TOD versus ${formatYMetricSummary(minoritySummary.meanNonTod, minoritySummary.kind)} in comparison tracts`,
				delta: `${minoritySummary.gap >= 0 ? '+' : ''}${minoritySummary.fmtGap}`,
				tone: minoritySummary.gap >= 0 ? 'warm' : 'cool'
			});
		}
		if (incomeSummary) {
			cards.push({
				eyebrow: 'Lead demographic',
				title: 'Income growth is stronger in TOD tracts',
				summary: `${formatYMetricSummary(incomeSummary.meanTod, incomeSummary.kind)} in TOD versus ${formatYMetricSummary(incomeSummary.meanNonTod, incomeSummary.kind)} in comparison tracts`,
				delta: `${incomeSummary.gap >= 0 ? '+' : ''}${incomeSummary.fmtGap}`,
				tone: 'alert'
			});
		}
		if (drivingSummary) {
			cards.push({
				eyebrow: 'System outcome',
				title: 'Driving alone falls more in TOD tracts',
				summary: `${formatYMetricSummary(drivingSummary.meanTod, drivingSummary.kind)} in TOD versus ${formatYMetricSummary(drivingSummary.meanNonTod, drivingSummary.kind)} in comparison tracts`,
				delta: `${drivingSummary.gap >= 0 ? '+' : ''}${drivingSummary.fmtGap}`,
				tone: 'cool'
			});
		}
		if (commuteSummary) {
			cards.push({
				eyebrow: 'Watchpoint',
				title: 'Commute times also rise more in TOD tracts',
				summary: `${formatYMetricSummary(commuteSummary.meanTod, commuteSummary.kind)} in TOD versus ${formatYMetricSummary(commuteSummary.meanNonTod, commuteSummary.kind)} in comparison tracts`,
				delta: `${commuteSummary.gap >= 0 ? '+' : ''}${commuteSummary.fmtGap}`,
				tone: 'neutral'
			});
		}
		return cards;
	});

	const affShareMap = $derived.by(() => {
		const tractMap = new Map();
		for (const tract of tractData) {
			if (tract.gisjoin) tractMap.set(tract.gisjoin, tract);
		}
		const filteredDevs = filterDevelopments(developments, panelConfig);
		return aggregateDevsByTract(filteredDevs, tractMap, timePeriod);
	});

	const affordabilitySplit = $derived.by(() => {
		const tod = todRows.filter((t) => {
			const agg = affShareMap.get(t.gisjoin);
			return agg && Number.isFinite(agg.affordable_share);
		});
		const median = d3.median(tod, (t) => affShareMap.get(t.gisjoin)?.affordable_share ?? NaN);
		if (!Number.isFinite(median)) {
			return { median: null, high: [], low: [], rows: [] };
		}
		const high = tod.filter((t) => (affShareMap.get(t.gisjoin)?.affordable_share ?? -1) >= median);
		const low = tod.filter((t) => (affShareMap.get(t.gisjoin)?.affordable_share ?? Infinity) < median);
		const weightKey = popWeightKey(timePeriod);
		const rows = ['minority_pct_change', 'median_income_change_pct', 'bachelors_pct_change', 'avg_travel_time_change']
			.map((key) => {
				const metaRow = lookupYMeta(key);
				const yKey = `${key}_${timePeriod}`;
				const kind = yMetricDisplayKind(metaRow);
				const highMean = computeGroupMean(high, yKey, weightKey);
				const lowMean = computeGroupMean(low, yKey, weightKey);
				return {
					key,
					label: metaRow.label ?? key,
					kind,
					highMean,
					lowMean,
					gap: highMean - lowMean
				};
			});
		return { median, high, low, rows };
	});

	const affordabilityRegression = $derived.by(() => {
		const yKey = `minority_pct_change_${timePeriod}`;
		const weightKey = popWeightKey(timePeriod);
		const points = todRows
			.map((tract) => {
				const agg = affShareMap.get(tract.gisjoin);
				const x = agg?.affordable_share;
				const y = tract[yKey];
				const w = tract[weightKey];
				if (!Number.isFinite(x) || !Number.isFinite(Number(y))) return null;
				return { x, y: Number(y), w: Number(w) || 1 };
			})
			.filter(Boolean);
		if (points.length < 3) return null;
		const filtered = filterPointsTenSigmaMarginals(points);
		if (filtered.length < 2) return null;
		return computeRegression(filtered);
	});

	const policymakerNotes = $derived.by(() => {
		const notes = [];
		if (minoritySummary && incomeSummary) {
			notes.push(
				'Use race and income together. Each one alone is incomplete; together they show whether TOD-linked growth looks broadly shared or selectively captured.'
			);
		}
		if (drivingSummary && commuteSummary) {
			notes.push(
				'Separate access from burden. The dashboard suggests TOD may reduce auto dependence without automatically reducing total travel time.'
			);
		}
		if (educationSummary) {
			notes.push(
				`Education also shifts upward in TOD tracts (${formatYMetricSummary(educationSummary.meanTod, educationSummary.kind)} versus ${formatYMetricSummary(educationSummary.meanNonTod, educationSummary.kind)}), which is useful context for interpreting the income pattern.`
			);
		}
		notes.push(
			'These are descriptive cohort comparisons, not causal estimates. Urban form and regional context may explain part of the difference.'
		);
		return notes;
	});

	const mainTakeaway = $derived.by(() => {
		if (!minoritySummary || !incomeSummary || !drivingSummary || !commuteSummary) return null;
		return {
			title: 'Recommended policy framing',
			body:
				'TOD in this dataset looks like a mixed equity story: neighborhoods near transit show stronger travel-behavior gains, but they also show faster income change and continued demographic change. The policy question is how to preserve the mobility payoff while shaping who can remain and benefit.'
		};
	});

	const fmtInt = d3.format(',');
	const fmtPct = d3.format('.1%');
</script>

<section class="policy-dashboard">
		<header class="hero">
			<div class="hero-copy">
				<p class="eyebrow">Policy dashboard</p>
				<h1>Who benefits from TOD, and under what conditions?</h1>
				<p class="lede">
					This view is intentionally built around two lead demographics: <strong>race/ethnicity</strong>
					and <strong>income</strong>. For a policymaker, those are the clearest lenses for judging
					whether TOD is expanding opportunity, concentrating advantage, or doing both at once.
				</p>
			</div>
		<div class="hero-meta">
			<div class="hero-stat">
				<span class="hero-stat-label">Analysis period</span>
				<span class="hero-stat-value">{periodLabel}</span>
			</div>
			<div class="hero-stat">
				<span class="hero-stat-label">TOD tracts</span>
				<span class="hero-stat-value">{fmtInt(todRows.length)}</span>
			</div>
			<div class="hero-stat">
				<span class="hero-stat-label">Control tracts</span>
				<span class="hero-stat-value">{fmtInt(nonTodRows.length)}</span>
			</div>
		</div>
	</header>

		<section class="controls" aria-labelledby="controls-heading">
			<div class="section-head">
				<p class="section-kicker">Comparison design</p>
				<h2 id="controls-heading">Set the TOD and non-TOD cohorts</h2>
			</div>
		<div class="controls-grid">
			<label class="control">
				<span>Time period</span>
				<select bind:value={timePeriod}>
					<option value="90_00">1990–2000</option>
					<option value="00_10">2000–2010</option>
					<option value="10_20">2010–2020</option>
					<option value="90_20">1990–2020</option>
				</select>
			</label>
			<label class="control">
				<span>TOD min stops / mi²</span>
				<input type="number" min="0" step="0.5" bind:value={todMinStopsPerSqMi} />
			</label>
			<label class="control">
				<span>Control max stops / mi²</span>
				<input type="number" min="0" step="0.5" bind:value={nonTodMaxStopsPerSqMi} />
			</label>
			<label class="control">
				<span>Min population density</span>
				<input type="number" min="0" step="100" bind:value={minPopDensity} />
			</label>
			<label class="control">
				<span>Min housing-unit change</span>
				<input type="number" min="0" step="10" bind:value={minHuChange} />
			</label>
		</div>
			<p class="controls-note">
				The page compares {fmtInt(analysisUniverse)} tracts that pass the filters, then separates them into TOD and non-TOD cohorts.
				Summaries are weighted by tract population in {periodBounds.startY} so large neighborhoods matter proportionally.
			</p>
		</section>

		<section class="highlights" aria-labelledby="highlights-heading">
			<div class="section-head">
				<p class="section-kicker">Analysis readout</p>
				<h2 id="highlights-heading">What the current evidence says</h2>
			</div>
		{#if mainTakeaway}
			<div class="takeaway-banner">
				<p class="takeaway-kicker">{mainTakeaway.title}</p>
				<p>{mainTakeaway.body}</p>
			</div>
		{/if}
		<div class="card-grid">
			{#each highlightCards as card (card.title)}
				<article class="highlight-card tone-{card.tone}">
					<p class="card-eyebrow">{card.eyebrow}</p>
					<h3>{card.title}</h3>
					<p class="card-summary">{card.summary}</p>
					<p class="card-delta">{card.delta}</p>
				</article>
			{/each}
		</div>
	</section>

	<section class="period-section" aria-labelledby="period-heading">
		<div class="section-head">
			<p class="section-kicker">Across decades</p>
			<h2 id="period-heading">Check whether the story holds across time</h2>
		</div>
		<p class="section-copy">
			A policymaker should be able to see whether the TOD pattern is stable over time, concentrated in one decade, or mixed. These cards show the TOD-minus-non-TOD gap for the two lead demographics and the two mobility context metrics.
		</p>
		<div class="period-grid">
			{#each periodAnalysis as row (row.period)}
				<article class="period-card">
					<h3>{row.periodLabel}</h3>
					<div class="period-metric">
						<div class="period-label-row">
							<span>Race/ethnicity composition gap</span>
							<strong>{row.minority?.gap >= 0 ? '+' : ''}{row.minority?.fmtGap ?? '—'}</strong>
						</div>
						<div class="gap-track">
							<div class="gap-fill gap-fill--{gapTone(row.minority?.gap)}" style={`width:${gapBarWidth(row.minority?.gap)}`}></div>
						</div>
						<p class="period-detail">{row.minority?.fmtTod ?? '—'} in TOD vs {row.minority?.fmtNonTod ?? '—'} outside TOD</p>
					</div>
					<div class="period-metric">
						<div class="period-label-row">
							<span>Income change gap</span>
							<strong>{row.income?.gap >= 0 ? '+' : ''}{row.income?.fmtGap ?? '—'}</strong>
						</div>
						<div class="gap-track">
							<div class="gap-fill gap-fill--{gapTone(row.income?.gap)}" style={`width:${gapBarWidth(row.income?.gap)}`}></div>
						</div>
						<p class="period-detail">{row.income?.fmtTod ?? '—'} in TOD vs {row.income?.fmtNonTod ?? '—'} outside TOD</p>
					</div>
					<div class="period-mini-grid">
						<div>
							<span class="mini-label">Driving-alone gap</span>
							<strong class="mini-value">{row.driving?.gap >= 0 ? '+' : ''}{row.driving?.fmtGap ?? '—'}</strong>
						</div>
						<div>
							<span class="mini-label">Commute-time gap</span>
							<strong class="mini-value">{row.commute?.gap >= 0 ? '+' : ''}{row.commute?.fmtGap ?? '—'}</strong>
						</div>
					</div>
				</article>
			{/each}
		</div>
	</section>

		<section class="focus-section" aria-labelledby="demographics-heading">
			<div class="section-head">
				<p class="section-kicker">Primary demographics</p>
				<h2 id="demographics-heading">Use race and income as the core story</h2>
			</div>
			<div class="focus-grid">
				<article class="focus-card">
					<p class="focus-label">Demographic 1</p>
					<h3>Race and ethnicity composition</h3>
					<p class="focus-value">{minoritySummary ? formatYMetricSummary(minoritySummary.meanTod, minoritySummary.kind) : '—'}</p>
					<p class="focus-compare">
						TOD average versus {minoritySummary ? formatYMetricSummary(minoritySummary.meanNonTod, minoritySummary.kind) : '—'} in comparison tracts
					</p>
					<p class="focus-body">
						This should be the equity lens in the dashboard. It helps answer whether TOD growth is occurring alongside broader inclusion or alongside demographic narrowing, while still avoiding a simplistic claim that demographic change alone proves displacement.
					</p>
				</article>

				<article class="focus-card">
					<p class="focus-label">Demographic 2</p>
					<h3>Income change</h3>
					<p class="focus-value">{incomeSummary ? formatYMetricSummary(incomeSummary.meanTod, incomeSummary.kind) : '—'}</p>
					<p class="focus-compare">
						TOD average versus {incomeSummary ? formatYMetricSummary(incomeSummary.meanNonTod, incomeSummary.kind) : '—'} in comparison tracts
					</p>
					<p class="focus-body">
						Income is the clearest market-pressure indicator in the current dataset. If income rises faster in TOD tracts, policymakers should ask whether the gains reflect healthy investment, selective capture, or rising barriers to remaining in place.
					</p>
				</article>
			</div>
			<div class="focus-note">
				<p>
					Why not lead with education, driving, or commute time? Because those are supporting signals. Education helps interpret socioeconomic sorting, and mobility outcomes show whether TOD is functioning as intended, but race/ethnicity and income are the strongest starting points for a policymaker deciding how equitable TOD appears to be.
				</p>
			</div>
		</section>

		<section class="map-section" aria-labelledby="map-heading">
			<div class="section-head">
				<p class="section-kicker">Geography</p>
				<h2 id="map-heading">See the comparison groups on the map</h2>
			</div>
			<p class="section-copy">
				This map uses the same cohort rules as the summaries above. It makes the comparison transparent before anyone interprets the results as a statewide average.
			</p>
		<div class="map-shell">
			<PolicyCohortMap panelConfig={panelConfig} />
		</div>
	</section>

		<section class="mobility-section" aria-labelledby="mobility-heading">
			<div class="section-head">
				<p class="section-kicker">System outcomes</p>
				<h2 id="mobility-heading">Pair the demographic story with mobility outcomes</h2>
			</div>
			<div class="tradeoff-grid">
				<article class="tradeoff-card tradeoff-card--good">
					<h3>Potential benefit: less driving alone</h3>
					<p class="tradeoff-value">{drivingSummary ? formatYMetricSummary(drivingSummary.meanTod, drivingSummary.kind) : '—'}</p>
					<p class="tradeoff-copy">
						Compared with {drivingSummary ? formatYMetricSummary(drivingSummary.meanNonTod, drivingSummary.kind) : '—'} in comparison tracts. This is the strongest signal that TOD may be changing travel behavior in the intended direction.
					</p>
				</article>
				<article class="tradeoff-card tradeoff-card--watch">
					<h3>Potential concern: longer commute times</h3>
					<p class="tradeoff-value">{commuteSummary ? formatYMetricSummary(commuteSummary.meanTod, commuteSummary.kind) : '—'}</p>
					<p class="tradeoff-copy">
						Compared with {commuteSummary ? formatYMetricSummary(commuteSummary.meanNonTod, commuteSummary.kind) : '—'} in comparison tracts. Access to transit and total travel burden are related, but they are not the same policy outcome.
					</p>
				</article>
			</div>
		</section>

		<section class="affordability-section" aria-labelledby="affordability-heading">
			<div class="section-head">
				<p class="section-kicker">Policy lever</p>
				<h2 id="affordability-heading">Test affordability as a moderating factor</h2>
			</div>
			<p class="section-copy">
				Within TOD tracts only, this section asks whether places with more affordable development look meaningfully different from places with less. It is framed as a policy lever, not as a proven causal mechanism.
			</p>
		{#if affordabilitySplit.median == null}
			<p class="empty-state">No affordable-share split is available with the current filters.</p>
		{:else}
			<div class="affordability-meta">
				<div>
					<span class="meta-label">Median affordable share</span>
					<span class="meta-value">{fmtPct(affordabilitySplit.median)}</span>
				</div>
				<div>
					<span class="meta-label">Higher-affordability TOD tracts</span>
					<span class="meta-value">{fmtInt(affordabilitySplit.high.length)}</span>
				</div>
				<div>
					<span class="meta-label">Lower-affordability TOD tracts</span>
					<span class="meta-value">{fmtInt(affordabilitySplit.low.length)}</span>
				</div>
			</div>

			<div class="mini-table" role="table" aria-label="Affordable-share comparison inside TOD tracts">
				<div class="mini-table-head" role="row">
					<div role="columnheader">Outcome</div>
					<div role="columnheader">Higher-affordability TOD</div>
					<div role="columnheader">Lower-affordability TOD</div>
				</div>
				{#each affordabilitySplit.rows as row (row.key)}
					<div class="mini-table-row" role="row">
						<div role="cell">{row.label}</div>
						<div role="cell">{formatYMetricSummary(row.highMean, row.kind)}</div>
						<div role="cell">{formatYMetricSummary(row.lowMean, row.kind)}</div>
					</div>
				{/each}
			</div>

				<p class="section-copy section-copy--tight">
					Use this as a directional policy check, not a definitive result. If the relationship is weak, the dashboard should say that clearly rather than over-claim.
					{#if affordabilityRegression}
						For race/ethnicity composition change, the fitted relationship is weak (`R² = {affordabilityRegression.r2.toFixed(2)}`), so affordability should be presented here as a hypothesis worth testing, not as a settled answer.
					{/if}
				</p>
			{/if}
		</section>

		<section class="actions" aria-labelledby="actions-heading">
			<div class="section-head">
				<p class="section-kicker">Policy takeaway</p>
				<h2 id="actions-heading">What this dashboard is designed to help decide</h2>
			</div>
			<div class="actions-grid">
				<div class="action-box">
					<h3>Main question</h3>
					<p>
						Can TOD deliver mobility gains without concentrating neighborhood change among higher-income households or reshaping access inequitably?
					</p>
				</div>
				<div class="action-box">
					<h3>How to frame it</h3>
					<p>
						Lead with race and income together, then show the mobility payoff and the affordability caveat. That structure keeps the dashboard focused on policy tradeoffs instead of isolated statistics.
					</p>
				</div>
				<div class="action-box">
					<h3>What to add next</h3>
					<p>
						Add rent, home value, rent burden, and ethnic subgroup detail next. Those variables would make the equity story much stronger than income change alone.
					</p>
				</div>
			</div>
		<div class="note-list">
			{#each policymakerNotes as note (note)}
				<p>{note}</p>
			{/each}
		</div>
	</section>
</section>

<style>
	.policy-dashboard {
		padding: 32px 24px 72px;
		max-width: 1280px;
		margin: 0 auto;
		display: grid;
		gap: 28px;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.8fr) minmax(280px, 0.9fr);
		gap: 24px;
		padding: 28px;
		border: 1px solid rgba(232, 202, 140, 0.18);
		border-radius: 24px;
		background:
			radial-gradient(circle at top right, rgba(227, 162, 73, 0.22), transparent 34%),
			linear-gradient(135deg, rgba(27, 32, 42, 0.95), rgba(17, 21, 29, 0.98));
		box-shadow: 0 22px 48px rgba(0, 0, 0, 0.28);
	}

	.eyebrow,
	.section-kicker,
	.card-eyebrow,
	.focus-label {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.75rem;
		color: #e7c886;
	}

	.hero h1 {
		font-size: clamp(2rem, 4vw, 3.6rem);
		line-height: 0.98;
		max-width: 12ch;
		margin: 8px 0 14px;
	}

	.lede,
	.section-copy,
	.card-summary,
	.focus-body,
	.tradeoff-copy,
	.controls-note,
	.note-list p,
	.action-box p {
		color: #c7cbd7;
		font-size: 1rem;
	}

	.hero-meta {
		display: grid;
		gap: 14px;
		align-content: start;
	}

	.hero-stat,
	.action-box,
	.focus-card,
	.tradeoff-card,
	.highlight-card,
	.controls,
	.map-shell,
	.affordability-section,
	.mobility-section,
	.period-section,
	.focus-section,
	.highlights,
	.actions,
	.map-section {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 20px;
		background: linear-gradient(180deg, rgba(35, 40, 52, 0.94), rgba(23, 27, 36, 0.94));
	}

	.hero-stat {
		padding: 18px;
		background: rgba(10, 13, 18, 0.34);
	}

	.takeaway-banner {
		margin-bottom: 18px;
		padding: 18px 20px;
		border-radius: 18px;
		background: linear-gradient(90deg, rgba(227, 162, 73, 0.18), rgba(255, 255, 255, 0.03));
		border: 1px solid rgba(227, 162, 73, 0.24);
	}

	.takeaway-kicker {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #e7c886;
		margin-bottom: 6px;
	}

	.hero-stat-label,
	.meta-label {
		display: block;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #9098ac;
	}

	.hero-stat-value,
	.meta-value,
	.card-delta,
	.focus-value,
	.tradeoff-value {
		display: block;
		margin-top: 6px;
		font-size: 1.6rem;
		font-weight: 700;
		color: #f2f4fb;
	}

	.controls,
	.highlights,
	.period-section,
	.focus-section,
	.map-section,
	.mobility-section,
	.affordability-section,
	.actions {
		padding: 24px;
	}

	.section-head {
		margin-bottom: 18px;
	}

	.section-head h2 {
		font-size: 1.6rem;
		margin-top: 4px;
	}

	.controls-grid,
	.card-grid,
	.period-grid,
	.focus-grid,
	.tradeoff-grid,
	.actions-grid,
	.affordability-meta {
		display: grid;
		gap: 16px;
	}

	.controls-grid {
		grid-template-columns: repeat(5, minmax(0, 1fr));
	}

	.control {
		display: grid;
		gap: 8px;
		font-size: 0.92rem;
		color: #d9deea;
	}

	.control input,
	.control select {
		padding: 10px 12px;
		background: rgba(13, 17, 23, 0.64);
		border: 1px solid rgba(255, 255, 255, 0.09);
	}

	.card-grid {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.period-grid {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.highlight-card {
		padding: 20px;
		display: grid;
		gap: 10px;
		min-height: 200px;
	}

	.period-card {
		padding: 20px;
		display: grid;
		gap: 14px;
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 20px;
		background: linear-gradient(180deg, rgba(31, 35, 47, 0.98), rgba(21, 24, 33, 0.98));
	}

	.period-card h3 {
		font-size: 1.2rem;
	}

	.period-metric {
		display: grid;
		gap: 8px;
	}

	.period-label-row,
	.period-mini-grid {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}

	.period-label-row span,
	.mini-label,
	.period-detail {
		color: #aeb6ca;
		font-size: 0.92rem;
	}

	.gap-track {
		height: 10px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.07);
		overflow: hidden;
	}

	.gap-fill {
		height: 100%;
		border-radius: inherit;
	}

	.gap-fill--good {
		background: linear-gradient(90deg, #dba34d, #f3d28f);
	}

	.gap-fill--warn {
		background: linear-gradient(90deg, #e16e5b, #f3aa8a);
	}

	.gap-fill--neutral {
		background: linear-gradient(90deg, #7b859c, #aab2c4);
	}

	.period-mini-grid {
		padding-top: 8px;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
	}

	.mini-value {
		display: block;
		margin-top: 4px;
		color: #f2f4fb;
	}

	.highlight-card h3,
	.focus-card h3,
	.tradeoff-card h3,
	.action-box h3 {
		font-size: 1.15rem;
	}

	.tone-warm {
		border-color: rgba(234, 173, 90, 0.35);
	}

	.tone-alert {
		border-color: rgba(230, 119, 83, 0.38);
	}

	.tone-cool {
		border-color: rgba(103, 173, 235, 0.36);
	}

	.focus-grid,
	.tradeoff-grid,
	.actions-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.focus-card,
	.tradeoff-card,
	.action-box {
		padding: 22px;
		display: grid;
		gap: 10px;
	}

	.focus-compare {
		color: #97a1b8;
	}

	.focus-note {
		margin-top: 16px;
		padding: 16px 18px;
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.04);
		color: #c7cbd7;
	}

	.tradeoff-card--good {
		border-color: rgba(94, 190, 134, 0.35);
	}

	.tradeoff-card--watch {
		border-color: rgba(226, 170, 86, 0.34);
	}

	.map-shell {
		padding: 14px;
	}

	.affordability-meta {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 18px 0;
	}

	.mini-table {
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 16px;
		overflow: hidden;
	}

	.mini-table-head,
	.mini-table-row {
		display: grid;
		grid-template-columns: minmax(220px, 1.5fr) repeat(2, minmax(0, 1fr));
	}

	.mini-table-head {
		background: rgba(255, 255, 255, 0.04);
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #99a3b9;
	}

	.mini-table-head > div,
	.mini-table-row > div {
		padding: 14px 16px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}

	.empty-state {
		padding: 18px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.04);
		color: #c7cbd7;
	}

	.section-copy--tight {
		margin-top: 16px;
	}

	.note-list {
		display: grid;
		gap: 10px;
		margin-top: 18px;
	}

	@media (max-width: 1100px) {
		.hero,
		.controls-grid,
		.card-grid,
		.period-grid,
		.focus-grid,
		.tradeoff-grid,
		.actions-grid,
		.affordability-meta {
			grid-template-columns: 1fr 1fr;
		}

		.hero {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 720px) {
		.policy-dashboard {
			padding: 20px 14px 48px;
		}

		.controls-grid,
		.card-grid,
		.period-grid,
		.focus-grid,
		.tradeoff-grid,
		.actions-grid,
		.affordability-meta,
		.mini-table-head,
		.mini-table-row {
			grid-template-columns: 1fr;
		}

		.hero h1 {
			max-width: none;
		}
	}
</style>
