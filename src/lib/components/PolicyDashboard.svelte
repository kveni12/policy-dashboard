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

	const minoritySummary = $derived.by(() => metricSummary('minority_pct_change'));
	const incomeSummary = $derived.by(() => metricSummary('median_income_change_pct'));
	const drivingSummary = $derived.by(() => metricSummary('drove_alone_pct_change'));
	const commuteSummary = $derived.by(() => metricSummary('avg_travel_time_change'));
	const educationSummary = $derived.by(() => metricSummary('bachelors_pct_change'));

	const highlightCards = $derived.by(() => {
		const cards = [];
		if (minoritySummary) {
			cards.push({
				eyebrow: 'Equity signal',
				title: 'Minority share grew slightly more in TOD tracts',
				summary: `${formatYMetricSummary(minoritySummary.meanTod, minoritySummary.kind)} in TOD vs ${formatYMetricSummary(minoritySummary.meanNonTod, minoritySummary.kind)} in non-TOD`,
				delta: `${minoritySummary.gap >= 0 ? '+' : ''}${minoritySummary.fmtGap}`,
				tone: minoritySummary.gap >= 0 ? 'warm' : 'cool'
			});
		}
		if (incomeSummary) {
			cards.push({
				eyebrow: 'Economic shift',
				title: 'Income growth is much stronger in TOD tracts',
				summary: `${formatYMetricSummary(incomeSummary.meanTod, incomeSummary.kind)} in TOD vs ${formatYMetricSummary(incomeSummary.meanNonTod, incomeSummary.kind)} in non-TOD`,
				delta: `${incomeSummary.gap >= 0 ? '+' : ''}${incomeSummary.fmtGap}`,
				tone: 'alert'
			});
		}
		if (drivingSummary) {
			cards.push({
				eyebrow: 'Mobility benefit',
				title: 'Driving alone falls more in TOD tracts',
				summary: `${formatYMetricSummary(drivingSummary.meanTod, drivingSummary.kind)} in TOD vs ${formatYMetricSummary(drivingSummary.meanNonTod, drivingSummary.kind)} in non-TOD`,
				delta: `${drivingSummary.gap >= 0 ? '+' : ''}${drivingSummary.fmtGap}`,
				tone: 'cool'
			});
		}
		if (commuteSummary) {
			cards.push({
				eyebrow: 'Tradeoff',
				title: 'Commute times also rise more in TOD tracts',
				summary: `${formatYMetricSummary(commuteSummary.meanTod, commuteSummary.kind)} in TOD vs ${formatYMetricSummary(commuteSummary.meanNonTod, commuteSummary.kind)} in non-TOD`,
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
				'TOD appears to coincide with both rising diversity and rising incomes, so the dashboard should frame growth and displacement risk together rather than treat them as opposites.'
			);
		}
		if (drivingSummary && commuteSummary) {
			notes.push(
				'TOD tracts show the expected mobility gain on driving, but not a universal time-saving effect. That helps policymakers talk about transit access and commute burden as separate outcomes.'
			);
		}
		if (educationSummary) {
			notes.push(
				`Education increases also run higher in TOD tracts (${formatYMetricSummary(educationSummary.meanTod, educationSummary.kind)} vs ${formatYMetricSummary(educationSummary.meanNonTod, educationSummary.kind)}), which reinforces the socioeconomic sorting story.`
			);
		}
		notes.push(
			'These are descriptive comparisons across tracts, not causal estimates. Some of the pattern may reflect Boston-area urban tracts versus less urban places.'
		);
		return notes;
	});

	const fmtInt = d3.format(',');
	const fmtPct = d3.format('.1%');
</script>

<section class="policy-dashboard">
	<header class="hero">
		<div class="hero-copy">
			<p class="eyebrow">Policymaker briefing</p>
			<h1>TOD, race, and income change in Massachusetts</h1>
			<p class="lede">
				This dashboard narrows the story to two core demographics: <strong>racial composition</strong>
				and <strong>economic status</strong>. The point is not just whether TOD builds housing, but
				who appears to benefit, who may be pressured, and what tradeoffs show up alongside the gains.
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
			<p class="section-kicker">Scope</p>
			<h2 id="controls-heading">Choose the comparison</h2>
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
			The current setup compares {fmtInt(analysisUniverse)} tracts that pass the filters and then splits them into TOD and non-TOD cohorts.
			Means are weighted by tract population in {periodBounds.startY}.
		</p>
	</section>

	<section class="highlights" aria-labelledby="highlights-heading">
		<div class="section-head">
			<p class="section-kicker">Headline findings</p>
			<h2 id="highlights-heading">What a policymaker should notice first</h2>
		</div>
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

	<section class="focus-section" aria-labelledby="demographics-heading">
		<div class="section-head">
			<p class="section-kicker">Demographic focus</p>
			<h2 id="demographics-heading">Lead with race and income</h2>
		</div>
		<div class="focus-grid">
			<article class="focus-card">
				<p class="focus-label">Demographic 1</p>
				<h3>Minority share change</h3>
				<p class="focus-value">{minoritySummary ? formatYMetricSummary(minoritySummary.meanTod, minoritySummary.kind) : '—'}</p>
				<p class="focus-compare">
					TOD average versus {minoritySummary ? formatYMetricSummary(minoritySummary.meanNonTod, minoritySummary.kind) : '—'} in non-TOD tracts
				</p>
				<p class="focus-body">
					Your current data supports a careful equity story: TOD tracts are not showing obvious minority decline on average. If anything, minority share rises slightly more in TOD places, which pushes against a simple “TOD always displaces minorities” narrative.
				</p>
			</article>

			<article class="focus-card">
				<p class="focus-label">Demographic 2</p>
				<h3>Median income change</h3>
				<p class="focus-value">{incomeSummary ? formatYMetricSummary(incomeSummary.meanTod, incomeSummary.kind) : '—'}</p>
				<p class="focus-compare">
					TOD average versus {incomeSummary ? formatYMetricSummary(incomeSummary.meanNonTod, incomeSummary.kind) : '—'} in non-TOD tracts
				</p>
				<p class="focus-body">
					The stronger income growth is the warning sign. TOD areas may be becoming more attractive and more expensive at the same time, which means policymakers should pair transit investment with affordability and anti-displacement tools.
				</p>
			</article>
		</div>
	</section>

	<section class="map-section" aria-labelledby="map-heading">
		<div class="section-head">
			<p class="section-kicker">Geography</p>
			<h2 id="map-heading">Where the cohorts are</h2>
		</div>
		<p class="section-copy">
			This map uses the same rules as the summaries above. It helps separate genuine TOD-like tracts from the comparison group before anyone reads the results as statewide averages.
		</p>
		<div class="map-shell">
			<PolicyCohortMap panelConfig={panelConfig} />
		</div>
	</section>

	<section class="mobility-section" aria-labelledby="mobility-heading">
		<div class="section-head">
			<p class="section-kicker">Benefit and tradeoff</p>
			<h2 id="mobility-heading">Mobility outcomes to pair with the demographic story</h2>
		</div>
		<div class="tradeoff-grid">
			<article class="tradeoff-card tradeoff-card--good">
				<h3>Driving falls more in TOD tracts</h3>
				<p class="tradeoff-value">{drivingSummary ? formatYMetricSummary(drivingSummary.meanTod, drivingSummary.kind) : '—'}</p>
				<p class="tradeoff-copy">
					Compared with {drivingSummary ? formatYMetricSummary(drivingSummary.meanNonTod, drivingSummary.kind) : '—'} in non-TOD tracts. This is the cleanest “TOD is doing TOD things” signal in the dashboard.
				</p>
			</article>
			<article class="tradeoff-card tradeoff-card--watch">
				<h3>Commute time still rises more in TOD tracts</h3>
				<p class="tradeoff-value">{commuteSummary ? formatYMetricSummary(commuteSummary.meanTod, commuteSummary.kind) : '—'}</p>
				<p class="tradeoff-copy">
					Compared with {commuteSummary ? formatYMetricSummary(commuteSummary.meanNonTod, commuteSummary.kind) : '—'} in non-TOD tracts. Transit access does not automatically mean shorter trips, especially in larger job markets.
				</p>
			</article>
		</div>
	</section>

	<section class="affordability-section" aria-labelledby="affordability-heading">
		<div class="section-head">
			<p class="section-kicker">Affordability lens</p>
			<h2 id="affordability-heading">Does more affordable TOD look different?</h2>
		</div>
		<p class="section-copy">
			Within TOD tracts only, the dashboard splits places with affordable-share data into a high-affordability half and a low-affordability half, based on the median affordable share of new units.
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
				This is best used as a directional check, not a strong claim. In your own notes, the affordability relationships looked mostly flat, and the regression here tells a similar story.
				{#if affordabilityRegression}
					For minority-share change, the fitted relationship is weak (`R² = {affordabilityRegression.r2.toFixed(2)}`).
				{/if}
			</p>
		{/if}
	</section>

	<section class="actions" aria-labelledby="actions-heading">
		<div class="section-head">
			<p class="section-kicker">Policy use</p>
			<h2 id="actions-heading">How to present this to a policymaker</h2>
		</div>
		<div class="actions-grid">
			<div class="action-box">
				<h3>Main message</h3>
				<p>
					TOD is associated with lower driving and higher neighborhood change. The question is not whether TOD should happen, but how to keep the benefits while reducing exclusionary pressure.
				</p>
			</div>
			<div class="action-box">
				<h3>Best framing</h3>
				<p>
					Lead with race and income together. Saying only “minority share increases” can sound reassuring, while saying only “income rises” can sound alarmist. Putting them side by side is more honest.
				</p>
			</div>
			<div class="action-box">
				<h3>Recommended next variables</h3>
				<p>
					Add rent, home value, rent burden, and ethnic subgroup breakdowns next. Those are the clearest missing pieces if you want a stronger displacement story.
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

	.highlight-card {
		padding: 20px;
		display: grid;
		gap: 10px;
		min-height: 200px;
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
