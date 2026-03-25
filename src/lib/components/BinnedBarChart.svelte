<script>
	import { onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import { tractData, developments, meta } from '$lib/stores/data.svelte.js';
	import {
		buildFilteredData,
		getScatterXValue,
		computeBins,
		computeBinnedMomentsForRows,
		getNonTodTracts,
		getTodTracts,
		popWeightKey
	} from '$lib/utils/derived.js';
	import { splitChartTitle } from '$lib/utils/chartTitles.js';

	let { panelState, domainOverride = null } = $props();

	let containerEl = $state(null);

	const marginLeft = 60;
	const marginRight = 20;
	const marginBottom = 92;
	const innerWidth = 500;
	const innerHeight = 300;
	const width = marginLeft + innerWidth + marginRight;

	const plotKey = $derived(
		JSON.stringify({
			tp: panelState.timePeriod,
			x: panelState.xVar,
			y: panelState.yVar,
			n: tractData.length,
			dn: developments.length,
			stops: panelState.minStopsPerSqMi,
			nonTodMax: panelState.nonTodMaxStopsPerSqMi,
			todModes: panelState.todTransitModes,
			nonTodModes: panelState.nonTodTransitModes,
			devMin: panelState.minUnitsPerProject,
			devMfPct: panelState.minDevMultifamilyRatioPct,
			devAffPct: panelState.minDevAffordableRatioPct,
			redev: panelState.includeRedevelopment,
			minPop: panelState.minPopulation,
			minDens: panelState.minPopDensity,
			minHU: panelState.minHuChange,
			todMin: panelState.todMinStopsPerSqMi,
			todAffPct: panelState.todMinAffordableSharePct,
			nonTodAffPct: panelState.nonTodMinAffordableSharePct,
			todStockPct: panelState.todMinStockIncreasePct,
			nonTodStockPct: panelState.nonTodMinStockIncreasePct,
			showCtrlBars: panelState.showNonTodBinnedBars,
			domSync: domainOverride ? 'on' : 'off',
			domY: domainOverride?.yDomain
		})
	);

	let lastPlotKey = $state('');

	$effect(() => {
		void plotKey;
		if (!containerEl) return;
		if (plotKey === lastPlotKey) return;
		lastPlotKey = plotKey;

		const tp = panelState.timePeriod;
		const xBase = panelState.xVar;
		const yBase = panelState.yVar;
		const yKey = `${yBase}_${tp}`;

		const root = d3.select(containerEl);
		root.selectAll('*').remove();

		const { filteredTracts, devAgg } = buildFilteredData(tractData, developments, panelState);
		const todTracts = getTodTracts(tractData, panelState);

		const wKey = popWeightKey(tp);
		const rows = [];
		for (const t of todTracts) {
			const rawY = t[yKey];
			if (rawY == null) continue;
			const xVal = getScatterXValue(t, t.gisjoin, xBase, devAgg, tp);
			const yVal = Number(rawY);
			if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
				rows.push({ tract: t, x: xVal, y: yVal, w: Number(t[wKey]) || 1 });
			}
		}

		const bins = computeBins(rows, 5);

		const xLabel = meta.xVariables?.find((v) => v.key === xBase)?.label ?? xBase;
		const yLabel = meta.yVariables?.find((v) => v.key === yBase)?.label ?? yBase;
		const mainTitle = `${yLabel} by ${xLabel} (TOD analysis tracts, pop-weighted bins)`;
		const titleLines = splitChartTitle(mainTitle, 44);
		const titleAnchorX = marginLeft + innerWidth / 2;
		/** Baseline of the first title line (px from top of SVG). */
		const firstTitleBaseline = 26;
		const subtitleY = firstTitleBaseline + 8 + titleLines.length * 16;
		const chartOffsetTop = subtitleY + 22;

		if (bins.length === 0) {
			const p = root.append('p').attr('class', 'binned-empty');
			p.append('span').text('No TOD tract data in range for this binning.');
			p.append('br');
			p.append('span').text(
				`(${todTracts.length} TOD tracts pass cohort filters; ${filteredTracts.length} in TOD ∪ non-TOD).`
			);
			return;
		}

		const showCtrlBars = panelState.showNonTodBinnedBars;
		const nonTodTracts = getNonTodTracts(tractData, panelState);
		const controlRows = [];
		for (const t of nonTodTracts) {
			const rawY = t[yKey];
			if (rawY == null) continue;
			const xVal = getScatterXValue(t, t.gisjoin, xBase, devAgg, tp);
			const yVal = Number(rawY);
			if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
				controlRows.push({ tract: t, x: xVal, y: yVal, w: Number(t[wKey]) || 1 });
			}
		}

		const ctrlMoments = showCtrlBars ? computeBinnedMomentsForRows(controlRows, bins) : null;

		let domainLo, domainHi;
		if (domainOverride?.yDomain) {
			[domainLo, domainHi] = domainOverride.yDomain;
		} else {
			const yLow = d3.min(bins, (d) => d.yMean - d.ySE) ?? 0;
			const yHigh = d3.max(bins, (d) => d.yMean + d.ySE) ?? 0;
			let lo = Math.min(0, yLow);
			let hi = Math.max(0, yHigh);
			if (showCtrlBars && ctrlMoments) {
				for (const c of ctrlMoments) {
					if (!Number.isFinite(c.yMean)) continue;
					lo = Math.min(lo, c.yMean - (c.ySE || 0));
					hi = Math.max(hi, c.yMean + (c.ySE || 0));
				}
			}
			domainLo = lo;
			domainHi = hi;
		}
		if (domainLo === domainHi) {
			domainLo -= 1;
			domainHi += 1;
		}

		const x0 = d3
			.scaleBand()
			.domain(bins.map((d) => d.binLabel))
			.range([0, innerWidth])
			.padding(showCtrlBars ? 0.2 : 0.22);

		const x1 = d3
			.scaleBand()
			.domain(['tod', 'nonTod'])
			.range([0, x0.bandwidth()])
			.padding(showCtrlBars ? 0.1 : 0);

		const yScale = d3.scaleLinear().domain([domainLo, domainHi]).nice().range([innerHeight, 0]);

		const height = chartOffsetTop + innerHeight + marginBottom;

		const svg = root.append('svg')
			.attr('viewBox', `0 0 ${width} ${height}`)
			.attr('width', '100%').attr('height', 'auto')
			.attr('preserveAspectRatio', 'xMidYMid meet')
			.style('display', 'block');

		const titleText = svg
			.append('text')
			.attr('x', titleAnchorX)
			.attr('y', firstTitleBaseline)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--text)')
			.attr('font-size', '13px')
			.attr('font-weight', '600');
		titleLines.forEach((line, i) => {
			const ts = titleText.append('tspan').attr('x', titleAnchorX).text(line);
			if (i > 0) ts.attr('dy', '1.15em');
		});

		svg.append('text')
			.attr('x', titleAnchorX)
			.attr('y', subtitleY)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--text-muted)')
			.attr('font-size', '10px')
			.text(
				showCtrlBars
					? 'Non-TOD control bars use the same X bin edges (tracts outside bins omitted).'
					: 'Bins from TOD X quantiles only.'
			);

		const chart = svg.append('g').attr('transform', `translate(${marginLeft},${chartOffsetTop})`);

		if (showCtrlBars) {
			const leg = chart.append('g').attr('transform', `translate(${innerWidth - 108}, -4)`);
			leg.append('rect').attr('width', 8).attr('height', 8).attr('fill', 'var(--accent)').attr('rx', 1);
			leg.append('text').attr('x', 11).attr('y', 8).attr('fill', 'var(--text-muted)').attr('font-size', '9px').text('TOD');
			leg.append('rect').attr('y', 12).attr('width', 8).attr('height', 8).attr('fill', '#94a3b8').attr('rx', 1);
			leg.append('text').attr('x', 11).attr('y', 20).attr('fill', 'var(--text-muted)').attr('font-size', '9px').text('non-TOD');
		}

		// Zero line
		const y0 = yScale(0);
		if (Number.isFinite(y0) && y0 >= 0 && y0 <= innerHeight) {
			chart
				.append('line')
				.attr('x1', 0)
				.attr('x2', innerWidth)
				.attr('y1', y0)
				.attr('y2', y0)
				.attr('stroke', 'var(--border)')
				.attr('stroke-dasharray', '5 4')
				.attr('stroke-opacity', 0.9)
				.attr('pointer-events', 'none');
		}

		function barGeomTod(d) {
			const xb = x0(d.binLabel);
			if (!showCtrlBars) return { x: xb, w: x0.bandwidth() };
			return { x: xb + (x1('tod') ?? 0), w: x1.bandwidth() };
		}

		function barGeomCtrl(d) {
			const xb = x0(d.binLabel);
			return { x: xb + (x1('nonTod') ?? 0), w: x1.bandwidth() };
		}

		function centerTod(d) {
			const g = barGeomTod(d);
			return g.x + g.w / 2;
		}

		function centerCtrl(d) {
			const g = barGeomCtrl(d);
			return g.x + g.w / 2;
		}

		chart
			.selectAll('rect.binned-bar-tod')
			.data(bins)
			.join('rect')
			.attr('class', 'binned-bar-tod')
			.attr('x', (d) => barGeomTod(d).x)
			.attr('width', (d) => barGeomTod(d).w)
			.attr('y', (d) => Math.min(yScale(0), yScale(d.yMean)))
			.attr('height', (d) => Math.abs(yScale(d.yMean) - yScale(0)))
			.attr('fill', 'var(--accent)')
			.attr('rx', 2)
			.attr('ry', 2)
			.style('cursor', 'default')
			.on('mouseenter', function () {
				d3.select(this)
					.attr('fill', 'color-mix(in srgb, var(--accent) 75%, white)')
					.attr('stroke', 'var(--text-muted)')
					.attr('stroke-width', 1.5);
			})
			.on('mouseleave', function () {
				d3.select(this).attr('fill', 'var(--accent)').attr('stroke', 'none').attr('stroke-width', 0);
			});

		if (showCtrlBars && ctrlMoments) {
			chart
				.selectAll('rect.binned-bar-ctrl')
				.data(bins.map((b, i) => ({ bin: b, i, c: ctrlMoments[i] })))
				.join('rect')
				.attr('class', 'binned-bar-ctrl')
				.attr('x', (d) => barGeomCtrl(d.bin, d.i).x)
				.attr('width', (d) => barGeomCtrl(d.bin, d.i).w)
				.attr('y', (d) =>
					Number.isFinite(d.c.yMean)
						? Math.min(yScale(0), yScale(d.c.yMean))
						: yScale(0)
				)
				.attr('height', (d) =>
					Number.isFinite(d.c.yMean) ? Math.abs(yScale(d.c.yMean) - yScale(0)) : 0
				)
				.attr('fill', '#94a3b8')
				.attr('rx', 2)
				.attr('ry', 2)
				.attr('opacity', (d) => (d.c.count > 0 ? 0.92 : 0))
				.style('cursor', 'default')
				.on('mouseenter', function (_event, d) {
					if (d.c.count === 0) return;
					d3.select(this)
						.attr('fill', 'color-mix(in srgb, #94a3b8 80%, white)')
						.attr('stroke', 'var(--text-muted)')
						.attr('stroke-width', 1.5);
				})
				.on('mouseleave', function (_event, d) {
					if (d.c.count === 0) return;
					d3.select(this).attr('fill', '#94a3b8').attr('stroke', 'none').attr('stroke-width', 0);
				});
		}

		const capW = 4;
		const errG = chart.append('g').attr('pointer-events', 'none');

		errG
			.selectAll('line.err-cap-hi-tod')
			.data(bins)
			.join('line')
			.attr('class', 'err-cap-hi-tod')
			.attr('stroke', 'var(--text-muted)')
			.attr('stroke-width', 1)
			.attr('x1', (d) => centerTod(d) - capW)
			.attr('x2', (d) => centerTod(d) + capW)
			.attr('y1', (d) => yScale(d.yMean + d.ySE))
			.attr('y2', (d) => yScale(d.yMean + d.ySE));

		errG
			.selectAll('line.err-cap-lo-tod')
			.data(bins)
			.join('line')
			.attr('class', 'err-cap-lo-tod')
			.attr('stroke', 'var(--text-muted)')
			.attr('stroke-width', 1)
			.attr('x1', (d) => centerTod(d) - capW)
			.attr('x2', (d) => centerTod(d) + capW)
			.attr('y1', (d) => yScale(d.yMean - d.ySE))
			.attr('y2', (d) => yScale(d.yMean - d.ySE));

		errG
			.selectAll('line.err-stem-tod')
			.data(bins)
			.join('line')
			.attr('class', 'err-stem-tod')
			.attr('stroke', 'var(--text-muted)')
			.attr('stroke-width', 1)
			.attr('x1', (d) => centerTod(d))
			.attr('x2', (d) => centerTod(d))
			.attr('y1', (d) => yScale(d.yMean + d.ySE))
			.attr('y2', (d) => yScale(d.yMean - d.ySE));

		if (showCtrlBars && ctrlMoments) {
			const ctrlErr = bins.map((b, i) => ({ bin: b, i, c: ctrlMoments[i] })).filter((d) => d.c.count > 0);

			errG
				.selectAll('line.err-cap-hi-ctrl')
				.data(ctrlErr)
				.join('line')
				.attr('stroke', 'var(--text-muted)')
				.attr('stroke-width', 1)
				.attr('x1', (d) => centerCtrl(d.bin) - capW)
				.attr('x2', (d) => centerCtrl(d.bin) + capW)
				.attr('y1', (d) => yScale(d.c.yMean + d.c.ySE))
				.attr('y2', (d) => yScale(d.c.yMean + d.c.ySE));

			errG
				.selectAll('line.err-cap-lo-ctrl')
				.data(ctrlErr)
				.join('line')
				.attr('stroke', 'var(--text-muted)')
				.attr('stroke-width', 1)
				.attr('x1', (d) => centerCtrl(d.bin) - capW)
				.attr('x2', (d) => centerCtrl(d.bin) + capW)
				.attr('y1', (d) => yScale(d.c.yMean - d.c.ySE))
				.attr('y2', (d) => yScale(d.c.yMean - d.c.ySE));

			errG
				.selectAll('line.err-stem-ctrl')
				.data(ctrlErr)
				.join('line')
				.attr('stroke', 'var(--text-muted)')
				.attr('stroke-width', 1)
				.attr('x1', (d) => centerCtrl(d.bin))
				.attr('x2', (d) => centerCtrl(d.bin))
				.attr('y1', (d) => yScale(d.c.yMean + d.c.ySE))
				.attr('y2', (d) => yScale(d.c.yMean - d.c.ySE));
		}

		chart.append('g').attr('transform', `translate(0,${innerHeight})`)
			.call(d3.axisBottom(x0))
			.call((g) => g.selectAll('path,line').attr('stroke', 'var(--border)'))
			.call((g) => g.selectAll('text').attr('fill', 'var(--text-muted)'))
			.selectAll('text')
			.attr('transform', 'rotate(-35)').style('text-anchor', 'end')
			.attr('dx', '-0.35em').attr('dy', '0.15em');

		chart.append('g')
			.call(d3.axisLeft(yScale).ticks(8))
			.call((g) => g.selectAll('path,line').attr('stroke', 'var(--border)'))
			.call((g) => g.selectAll('text').attr('fill', 'var(--text-muted)'));

		// Bin counts / population under the axis (stacked lines — avoids covering bars).
		const popFmt = d3.format('~s');
		const binMetaY = innerHeight + 20;
		const binMeta = chart.append('g').attr('class', 'bin-binmeta').attr('pointer-events', 'none');

		function appendStackedBinMeta(cx, lineStrs) {
			const te = binMeta
				.append('text')
				.attr('x', cx)
				.attr('y', binMetaY)
				.attr('text-anchor', 'middle')
				.attr('fill', 'var(--text-muted)')
				.attr('font-size', '7.5px')
				.attr('font-family', 'var(--font-mono, monospace)');
			lineStrs.forEach((line, li) => {
				te.append('tspan')
					.attr('x', cx)
					.attr('dy', li === 0 ? 0 : '1.14em')
					.text(line);
			});
		}

		for (let i = 0; i < bins.length; i++) {
			const b = bins[i];
			const c = ctrlMoments?.[i];
			if (showCtrlBars) {
				const todLines = ['TOD', `n=${b.count}`];
				if (b.totalPop > 0) todLines.push(`pop=${popFmt(b.totalPop)}`);
				appendStackedBinMeta(centerTod(b), todLines);
				const ctrlLines = ['ctrl', `n=${c?.count ?? 0}`];
				if (c && c.totalPop > 0) ctrlLines.push(`pop=${popFmt(c.totalPop)}`);
				appendStackedBinMeta(centerCtrl(b), ctrlLines);
			} else {
				const lines = [`n=${b.count}`];
				if (b.totalPop > 0) lines.push(`pop=${popFmt(b.totalPop)}`);
				appendStackedBinMeta(centerTod(b), lines);
			}
		}

		chart.append('text').attr('x', innerWidth / 2).attr('y', innerHeight + 78)
			.attr('text-anchor', 'middle').attr('fill', 'var(--text-muted)')
			.attr('font-size', '12px').text(`${xLabel} (bin range)`);

		chart.append('text').attr('transform', 'rotate(-90)')
			.attr('x', -innerHeight / 2).attr('y', -44)
			.attr('text-anchor', 'middle').attr('fill', 'var(--text-muted)')
			.attr('font-size', '12px').text(yLabel);
	});

	onDestroy(() => {
		if (containerEl) d3.select(containerEl).selectAll('*').remove();
		lastPlotKey = '';
	});
</script>

<div class="binned-bar-wrap">
	<div class="bar-controls">
		<label class="bar-toggle" title="Grey bars: non-TOD control cohort, same X bin edges as TOD">
			<input type="checkbox" bind:checked={panelState.showNonTodBinnedBars} />
			<span>Show non-TOD bars (per bin)</span>
		</label>
	</div>
	<div class="binned-bar-root" bind:this={containerEl}></div>
</div>

<style>
	.binned-bar-wrap {
		min-height: 260px;
		width: 100%;
	}
	.bar-controls {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
		padding: 2px 6px 4px;
	}
	.bar-toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.6875rem;
		line-height: 1.2;
		color: var(--text-muted);
		cursor: pointer;
	}
	.bar-toggle input {
		accent-color: var(--accent);
		margin: 0;
	}
	.binned-bar-root {
		width: 100%;
	}
	:global(.binned-bar-wrap .binned-empty) {
		margin: 0;
		padding: 20px;
		font-size: 0.875rem;
		color: var(--text-muted);
		max-width: 100%;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
</style>
