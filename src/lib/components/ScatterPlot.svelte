<script>
	import { onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import { tractData, developments, meta } from '$lib/stores/data.svelte.js';
	import {
		buildFilteredData,
		getScatterXValue,
		computeWeightedRegression,
		filterPointsTenSigmaMarginals,
		getNonTodTracts,
		getTodTracts,
		popWeightKey
	} from '$lib/utils/derived.js';
	import { periodCensusBounds } from '$lib/utils/periods.js';
	import { splitChartTitle } from '$lib/utils/chartTitles.js';

	let { panelState, domainOverride = null } = $props();

	let containerEl = $state(null);
	let tooltip = $state({ visible: false, x: 0, y: 0, lines: [] });

	const marginLeft = 60;
	const marginRight = 20;
	const marginBottom = 50;
	/** non-TOD OLS line color (contrasts with TOD accent in light/dark). */
	const REG_NON_TOD_STROKE = '#D3D3D3';
	const innerWidth = 500;
	const innerHeight = 350;

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
			trim: panelState.trimOutliers,
			showNT: panelState.showNonTodScatter,
			domSync: domainOverride ? 'on' : 'off',
			domX: domainOverride?.xDomain,
			domY: domainOverride?.yDomain
		})
	);

	let lastPlotKey = $state('');

	function styleDots(root, hoveredId, selectedSet) {
		root.selectAll('circle.scatter-dot')
			.attr('r', (d) => {
				const base = d.dotR ?? 4;
				return d.tract.gisjoin === hoveredId ? Math.min(base * 1.38, 9) : base;
			})
			.attr('fill', (d) =>
				selectedSet.has(d.tract.gisjoin) ? 'var(--cat-a)' : 'var(--accent)'
			)
			.attr('opacity', (d) => (d.tract.gisjoin === hoveredId ? 1 : 0.5))
			.attr('stroke', (d) =>
				d.tract.gisjoin === hoveredId ? 'var(--text)' : 'none'
			)
			.attr('stroke-width', (d) => (d.tract.gisjoin === hoveredId ? 1.5 : 0));
	}

	function styleNonTodDots(root, hoveredId) {
		root.selectAll('circle.scatter-dot-nontod')
			.attr('r', (d) => {
				const base = d.dotR ?? 3.5;
				return d.tract.gisjoin === hoveredId ? Math.min(base * 1.32, 8) : base;
			})
			.attr('opacity', (d) => (d.tract.gisjoin === hoveredId ? 0.92 : 0.5))
			.attr('stroke', (d) => (d.tract.gisjoin === hoveredId ? 'var(--text)' : 'none'))
			.attr('stroke-width', (d) => (d.tract.gisjoin === hoveredId ? 1.25 : 0));
	}

	$effect(() => {
		void plotKey;
		if (!containerEl) return;
		if (plotKey === lastPlotKey) return;
		lastPlotKey = plotKey;

		const tp = panelState.timePeriod;
		const xBase = panelState.xVar;
		const yBase = panelState.yVar;
		const hoveredId = panelState.hoveredTract;
		const selectedSet = panelState.selectedTracts;
		const yKey = `${yBase}_${tp}`;
		const wKey = popWeightKey(tp);

		const root = d3.select(containerEl);
		root.selectAll('*').remove();

		const { filteredTracts, devAgg } = buildFilteredData(tractData, developments, panelState);
		const todTracts = getTodTracts(tractData, panelState);

		const points = [];
		for (const t of todTracts) {
			const rawY = t[yKey];
			if (rawY == null) continue;
			const xVal = getScatterXValue(t, t.gisjoin, xBase, devAgg, tp);
			const yVal = Number(rawY);
			if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
				const w = Math.max(Number(t[wKey]) || 0, 1);
				points.push({ tract: t, x: xVal, y: yVal, w });
			}
		}

		// Non-TOD control cohort (see FilterPanel): disjoint from TOD where both definitions apply.
		const nonTodTracts = getNonTodTracts(tractData, panelState);
		const nonTodPoints = [];
		for (const t of nonTodTracts) {
			const rawY = t[yKey];
			if (rawY == null) continue;
			const xVal = getScatterXValue(t, t.gisjoin, xBase, devAgg, tp);
			const yVal = Number(rawY);
			if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
				const w = Math.max(Number(t[wKey]) || 0, 1);
				nonTodPoints.push({ tract: t, x: xVal, y: yVal, w });
			}
		}

		// WLS uses ±10σ marginal outlier screen; all TOD / non-TOD points stay plotted (weights preserved).
		const pointsForReg = filterPointsTenSigmaMarginals(points);
		const nonTodPointsForReg = filterPointsTenSigmaMarginals(nonTodPoints);
		const nonTodReg =
			nonTodPointsForReg.length >= 2
				? computeWeightedRegression(nonTodPointsForReg)
				: { slope: NaN, intercept: NaN, r2: 0 };

		if (points.length === 0) {
			const pe = root.append('p').attr('class', 'scatter-empty');
			pe.append('span').text('No TOD tracts with data for this combination.');
			pe.append('br');
			pe.append('span').text(
				`(${todTracts.length} TOD tracts pass cohort filters; ${filteredTracts.length} in TOD ∪ non-TOD).`
			);
			return;
		}

		// Sqrt scale so dot *area* scales ~linearly with population (subtle radius range).
		const wAll = [...points, ...nonTodPoints].map((d) => d.w);
		const wMin = d3.min(wAll) ?? 1;
		const wMax = d3.max(wAll) ?? 1;
		const rScale = d3
			.scaleSqrt()
			.domain(wMin === wMax ? [Math.max(wMin * 0.9, 1), wMax * 1.1 + 1] : [wMin, wMax])
			.range([2.7, 5.4]);
		for (const p of points) p.dotR = rScale(p.w);
		for (const p of nonTodPoints) p.dotR = rScale(p.w);

		const { startY } = periodCensusBounds(tp);
		const popFmt = d3.format(',.0f');

		const xLabel = meta.xVariables?.find((v) => v.key === xBase)?.label ?? xBase;
		const yLabel = meta.yVariables?.find((v) => v.key === yBase)?.label ?? yBase;

		let xDomain, yDomain;

		if (domainOverride?.xDomain) {
			xDomain = domainOverride.xDomain;
			yDomain = domainOverride.yDomain;
		} else if (panelState.trimOutliers && points.length > 2) {
			// Exclude >10-sigma outliers, then fit axes to the remaining data
			const xVals = points.map((d) => d.x);
			const yVals = points.map((d) => d.y);
			const xMu = d3.mean(xVals), xSd = Math.sqrt(d3.variance(xVals) || 0);
			const yMu = d3.mean(yVals), ySd = Math.sqrt(d3.variance(yVals) || 0);
			const xIn = xSd > 0 ? xVals.filter((v) => v >= xMu - 10 * xSd && v <= xMu + 10 * xSd) : xVals;
			const yIn = ySd > 0 ? yVals.filter((v) => v >= yMu - 10 * ySd && v <= yMu + 10 * ySd) : yVals;
			xDomain = xIn.length > 0 ? d3.extent(xIn) : d3.extent(xVals);
			yDomain = yIn.length > 0 ? d3.extent(yIn) : d3.extent(yVals);
		} else {
			xDomain = d3.extent(points, (d) => d.x);
			yDomain = d3.extent(points, (d) => d.y);
		}

		const xScale = d3.scaleLinear()
			.domain(xDomain[0] === undefined ? [0, 1] : xDomain).nice()
			.range([0, innerWidth]);
		const yScale = d3.scaleLinear()
			.domain(yDomain[0] === undefined ? [0, 1] : yDomain).nice()
			.range([innerHeight, 0]);

		const { slope, intercept, r2 } =
			pointsForReg.length >= 2
				? computeWeightedRegression(pointsForReg)
				: { slope: NaN, intercept: NaN, r2: 0 };

		const showNonTodReg =
			panelState.showNonTodScatter &&
			nonTodPointsForReg.length >= 2 &&
			Number.isFinite(nonTodReg.slope) &&
			Number.isFinite(nonTodReg.intercept);

		const titleFull = `${yLabel} vs ${xLabel} (TOD analysis tracts)`;
		const scatterTitleLines = splitChartTitle(titleFull, 44);
		const titleAnchorX = marginLeft + innerWidth / 2;
		const firstTitleBaseline = 22;
		// Legend block: caption row, then pop + regression side-by-side (two reg columns if TOD + non-TOD).
		const legendCaptionH = 22;
		const popLegendRowH = 28;
		const regLegendColH = 10 + 4 * 12 + 6;
		const hasTodReg =
			pointsForReg.length >= 2 && Number.isFinite(slope) && Number.isFinite(intercept);
		const nRegCols = (hasTodReg ? 1 : 0) + (showNonTodReg ? 1 : 0);
		const regBlockH = nRegCols > 0 ? regLegendColH : 0;
		const legendBlockH = legendCaptionH + Math.max(popLegendRowH, regBlockH) + 8;
		const titleBlockBottom = firstTitleBaseline + 8 + scatterTitleLines.length * 16;
		const legendY0 = titleBlockBottom + 6;
		const legendContentY = legendY0 + legendCaptionH;
		const chartOffsetTop = legendY0 + legendBlockH + 6;
		const width = marginLeft + innerWidth + marginRight;
		const height = chartOffsetTop + innerHeight + marginBottom;

		const svg = root.append('svg')
			.attr('viewBox', `0 0 ${width} ${height}`)
			.attr('width', '100%').attr('height', 'auto')
			.attr('preserveAspectRatio', 'xMidYMid meet')
			.style('display', 'block');

		const plotTitle = svg
			.append('text')
			.attr('x', titleAnchorX)
			.attr('y', firstTitleBaseline)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--text)')
			.attr('font-size', '13px')
			.attr('font-weight', '600');
		scatterTitleLines.forEach((line, i) => {
			const ts = plotTitle.append('tspan').attr('x', titleAnchorX).text(line);
			if (i > 0) ts.attr('dy', '1.15em');
		});

		// Full-width caption above the side-by-side legend row (keeps plot area left-aligned, not clipped right).
		svg
			.append('text')
			.attr('class', 'scatter-legend-caption')
			.attr('x', marginLeft)
			.attr('y', legendY0 + 10)
			.attr('fill', 'var(--text-muted)')
			.attr('font-size', '9px')
			.text(`Tract population (${startY}): dot area ∝ pop; fit = pop-weighted WLS`);

		// Population / dot-size legend (left column; regression legend(s) to the right, same row).
		const rLo = rScale(wMin);
		const rHi = rScale(wMax);
		const popLeg = svg
			.append('g')
			.attr('class', 'scatter-pop-legend')
			.attr('transform', `translate(${marginLeft}, ${legendContentY})`)
			.attr('pointer-events', 'none');
		const cyPop = 14;
		popLeg
			.append('circle')
			.attr('cx', rLo)
			.attr('cy', cyPop)
			.attr('r', rLo)
			.attr('fill', '#94a3b8')
			.attr('opacity', 0.55);
		popLeg
			.append('text')
			.attr('x', rLo * 2 + 8)
			.attr('y', cyPop + 3)
			.attr('fill', 'var(--text-muted)')
			.attr('font-size', '9px')
			.text(popFmt(wMin));
		const xHi = 108;
		popLeg
			.append('circle')
			.attr('cx', xHi + rHi)
			.attr('cy', cyPop)
			.attr('r', rHi)
			.attr('fill', '#94a3b8')
			.attr('opacity', 0.55);
		popLeg
			.append('text')
			.attr('x', xHi + rHi * 2 + 8)
			.attr('y', cyPop + 3)
			.attr('fill', 'var(--text-muted)')
			.attr('font-size', '9px')
			.text(popFmt(wMax));

		// Regression legend sits to the right of the dot-size swatches (fits viewBox width 580).
		const regLegendColW = 158;
		const popLegendReserve = 186;
		const legendRegX = marginLeft + popLegendReserve;
		const legRoot = svg
			.append('g')
			.attr('class', 'scatter-reg-legend')
			.attr('transform', `translate(${legendRegX}, ${legendContentY})`)
			.attr('pointer-events', 'none');

		const chart = svg.append('g')
			.attr('transform', `translate(${marginLeft},${chartOffsetTop})`);

		chart.append('g').attr('transform', `translate(0,${innerHeight})`)
			.call(d3.axisBottom(xScale).ticks(8))
			.call((g) => g.selectAll('path,line').attr('stroke', 'var(--border)'))
			.call((g) => g.selectAll('text').attr('fill', 'var(--text-muted)'));

		chart.append('g')
			.call(d3.axisLeft(yScale).ticks(8))
			.call((g) => g.selectAll('path,line').attr('stroke', 'var(--border)'))
			.call((g) => g.selectAll('text').attr('fill', 'var(--text-muted)'));

		chart.append('text').attr('x', innerWidth / 2).attr('y', innerHeight + 42)
			.attr('text-anchor', 'middle').attr('fill', 'var(--text-muted)')
			.attr('font-size', '12px').text(xLabel);
		chart.append('text').attr('transform', 'rotate(-90)')
			.attr('x', -innerHeight / 2).attr('y', -44)
			.attr('text-anchor', 'middle').attr('fill', 'var(--text-muted)')
			.attr('font-size', '12px').text(yLabel);

		const [d0, d1] = xScale.domain();

		const regLinesG = chart.append('g').attr('class', 'scatter-reg-lines').attr('pointer-events', 'none');

		// TOD OLS — solid accent, heavy stroke (draw first so non-TOD can read on top in legend only; lines don't overlap much)
		if (pointsForReg.length >= 2 && Number.isFinite(slope) && Number.isFinite(intercept)) {
			regLinesG
				.append('line')
				.attr('class', 'scatter-reg-line-tod')
				.attr('x1', xScale(d0))
				.attr('y1', yScale(slope * d0 + intercept))
				.attr('x2', xScale(d1))
				.attr('y2', yScale(slope * d1 + intercept))
				.attr('stroke', 'var(--accent)')
				.attr('stroke-width', 2.75)
				.attr('stroke-linecap', 'round');
		}

		// non-TOD OLS — contrasting stroke, dashed (only when grey points shown)
		if (showNonTodReg) {
			const ns = nonTodReg.slope;
			const ni = nonTodReg.intercept;
			regLinesG
				.append('line')
				.attr('class', 'scatter-reg-line-nontod')
				.attr('x1', xScale(d0))
				.attr('y1', yScale(ns * d0 + ni))
				.attr('x2', xScale(d1))
				.attr('y2', yScale(ns * d1 + ni))
				.attr('stroke', REG_NON_TOD_STROKE)
				.attr('stroke-width', 2.75)
				.attr('stroke-dasharray', '10 5')
				.attr('stroke-linecap', 'round');
		}

		const brush = d3.brush()
			.extent([[0, 0], [innerWidth, innerHeight]])
			.on('end', (event) => {
				if (!event.selection) return;
				const [[bx0, by0], [bx1, by1]] = event.selection;
				const xMin = Math.min(xScale.invert(bx0), xScale.invert(bx1));
				const xMax = Math.max(xScale.invert(bx0), xScale.invert(bx1));
				const yMin = Math.min(yScale.invert(by0), yScale.invert(by1));
				const yMax = Math.max(yScale.invert(by0), yScale.invert(by1));
				const next = new Set(panelState.selectedTracts);
				for (const d of points) {
					if (d.x >= xMin && d.x <= xMax && d.y >= yMin && d.y <= yMax) {
						next.add(d.tract.gisjoin);
					}
				}
				panelState.selectedTracts = next;
				brushG.call(brush.move, null);
			});

		const brushG = chart.append('g').attr('class', 'scatter-brush').call(brush);
		brushG.selectAll('.selection').attr('stroke', 'var(--accent)').attr('fill', 'var(--accent)');
		brushG.select('.overlay').attr('cursor', 'crosshair');

		// non-TOD layer after brush so circles receive hover (brush overlay sits below).
		if (panelState.showNonTodScatter && nonTodPoints.length > 0) {
			const ntG = chart.append('g').attr('class', 'scatter-nontod');
			ntG
				.selectAll('circle')
				.data(nonTodPoints, (d) => d.tract.gisjoin)
				.join('circle')
				.attr('class', 'scatter-dot-nontod')
				.attr('cx', (d) => xScale(d.x))
				.attr('cy', (d) => yScale(d.y))
				.attr('r', (d) => d.dotR ?? 3.5)
				.attr('fill', '#94a3b8')
				.attr('opacity', 0.5)
				.style('cursor', 'pointer')
				.on('mouseenter', function (event, d) {
					panelState.setHovered(d.tract.gisjoin);
					const fmt = d3.format('.2f');
					const name =
						d.tract.county && String(d.tract.county) !== 'County Name'
							? String(d.tract.county)
							: d.tract.gisjoin;
					tooltip = {
						visible: true,
						x: event.clientX,
						y: event.clientY,
						lines: [
							{ bold: true, text: name },
							{ bold: false, text: 'non-TOD (control)' },
							{ bold: false, text: `${xLabel}: ${fmt(d.x)}` },
							{ bold: false, text: `${yLabel}: ${fmt(d.y)}` },
							{ bold: false, text: `Pop (${startY}): ${popFmt(d.w)}` }
						]
					};
				})
				.on('mousemove', (event) => {
					tooltip = { ...tooltip, x: event.clientX, y: event.clientY };
				})
				.on('mouseleave', () => {
					panelState.setHovered(null);
					tooltip = { ...tooltip, visible: false };
				})
				.on('click', (event, d) => {
					event.stopPropagation();
					panelState.toggleTract(d.tract.gisjoin);
				});
		}

		const dotG = chart.append('g').attr('pointer-events', 'all');
		dotG.selectAll('circle')
			.data(points, (d) => d.tract.gisjoin)
			.join('circle')
			.attr('class', 'scatter-dot')
			.attr('cx', (d) => xScale(d.x))
			.attr('cy', (d) => yScale(d.y))
			.attr('r', (d) => d.dotR ?? 4)
			.style('cursor', 'pointer')
			.on('mouseenter', function (event, d) {
				panelState.setHovered(d.tract.gisjoin);
				const fmt = d3.format('.2f');
				const name = d.tract.county && String(d.tract.county) !== 'County Name'
					? String(d.tract.county) : d.tract.gisjoin;
				tooltip = {
					visible: true, x: event.clientX, y: event.clientY,
					lines: [
						{ bold: true, text: name },
						{ bold: false, text: `${xLabel}: ${fmt(d.x)}` },
						{ bold: false, text: `${yLabel}: ${fmt(d.y)}` },
						{ bold: false, text: `Pop (${startY}): ${popFmt(d.w)}` }
					]
				};
			})
			.on('mousemove', (event) => {
				tooltip = { ...tooltip, x: event.clientX, y: event.clientY };
			})
			.on('mouseleave', () => {
				panelState.setHovered(null);
				tooltip = { ...tooltip, visible: false };
			})
			.on('click', (event, d) => {
				event.stopPropagation();
				panelState.toggleTract(d.tract.gisjoin);
			});

		const slopeFmt = d3.format('.4f');
		/**
		 * Regression legend column: swatch left of left-aligned text. ``colIndex`` places
		 * TOD and non-TOD columns side-by-side when both are shown (shorter overall height).
		 */
		function addRegLegendEntry(stroke, dash, lines, colIndex) {
			const g = legRoot
				.append('g')
				.attr('transform', `translate(${colIndex * regLegendColW}, 0)`);
			const midY = 11;
			const swatchX1 = 0;
			const swatchX2 = 22;
			const textX = 30;

			const ln = g
				.append('line')
				.attr('x1', swatchX1)
				.attr('y1', midY)
				.attr('x2', swatchX2)
				.attr('y2', midY)
				.attr('stroke', stroke)
				.attr('stroke-width', 2.5)
				.attr('stroke-linecap', 'round');
			if (dash) ln.attr('stroke-dasharray', dash);

			const tx = g
				.append('text')
				.attr('x', textX)
				.attr('y', midY)
				.attr('text-anchor', 'start')
				.attr('dominant-baseline', 'middle')
				.attr('fill', 'var(--text)')
				.attr('font-size', '10px')
				.attr('font-weight', '600');
			lines.forEach((line, i) => {
				tx.append('tspan')
					.attr('x', textX)
					.attr('dy', i === 0 ? 0 : '1.14em')
					.text(line);
			});
		}

		let regCol = 0;
		if (hasTodReg) {
			const nLines = [
				'TOD WLS (pop-weighted)',
				`slope = ${slopeFmt(slope)} (\u0394y / \u0394x)`,
				`R\u00b2 ${d3.format('.2f')(r2)}`,
				`n = ${pointsForReg.length}${pointsForReg.length < points.length ? ` (\u226410\u03c3 of ${points.length})` : ''}`
			];
			addRegLegendEntry('var(--accent)', null, nLines, regCol++);
		}
		if (showNonTodReg) {
			addRegLegendEntry(REG_NON_TOD_STROKE, '10 5', [
				'non-TOD WLS (pop-weighted)',
				`slope = ${slopeFmt(nonTodReg.slope)} (\u0394y / \u0394x)`,
				`R\u00b2 ${d3.format('.2f')(nonTodReg.r2)}`,
				`n = ${nonTodPointsForReg.length}${nonTodPointsForReg.length < nonTodPoints.length ? ` (\u226410\u03c3 of ${nonTodPoints.length})` : ''}`
			], regCol++);
		}

		styleDots(root, hoveredId, selectedSet);
		styleNonTodDots(root, hoveredId);
	});

	$effect(() => {
		const hoveredId = panelState.hoveredTract;
		const selectedSet = panelState.selectedTracts;
		void selectedSet.size;
		if (!containerEl) return;
		const root = d3.select(containerEl);
		styleDots(root, hoveredId, selectedSet);
		styleNonTodDots(root, hoveredId);
	});

	onDestroy(() => {
		if (containerEl) d3.select(containerEl).selectAll('*').remove();
		lastPlotKey = '';
	});
</script>

<div class="scatter-wrap">
	<div class="scatter-controls">
		<label class="trim-toggle" title="Axes: when on, exclude &gt;10σ on each margin from domain. WLS lines use the same ±10σ screen on X and Y (population-weighted).">
			<input type="checkbox" bind:checked={panelState.trimOutliers} />
			<span>Trim axis to exclude &gt;10&sigma; outliers (WLS uses ±10&sigma; fit)</span>
		</label>
		<label class="trim-toggle" title="Grey points use the non-TOD control cohort from Census tract filtering">
			<input type="checkbox" bind:checked={panelState.showNonTodScatter} />
			<span>Show non-TOD points (grey)</span>
		</label>
	</div>
	<div class="scatter-root" bind:this={containerEl}></div>
	{#if tooltip.visible}
		<div class="scatter-tooltip" style:left="{tooltip.x + 12}px" style:top="{tooltip.y + 12}px">
			{#each tooltip.lines as line, i (i)}
				<p class:tooltip-bold={line.bold}>{line.text}</p>
			{/each}
		</div>
	{/if}
</div>

<style>
	.scatter-wrap {
		position: relative;
		width: 100%;
		background: transparent;
	}
	.scatter-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		margin-top: 12px;
		margin-bottom: 16px;
		padding: 10px 8px 4px;
		justify-content: flex-end;
		align-items: center;
	}
	.trim-toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.6875rem;
		line-height: 1.2;
		color: var(--text-muted);
		cursor: pointer;
	}
	.trim-toggle input { accent-color: var(--accent); margin: 0; }
	:global(.scatter-wrap .scatter-empty) {
		margin: 0;
		padding: 20px;
		font-size: 0.875rem;
		color: var(--text-muted);
		line-height: 1.45;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.scatter-root {
		width: 100%;
		min-height: 200px;
	}
	.scatter-tooltip {
		position: fixed;
		z-index: 20;
		max-width: 280px;
		padding: 8px 10px;
		font-size: 0.75rem;
		line-height: 1.35;
		color: var(--text);
		pointer-events: none;
		background: color-mix(in srgb, var(--bg, #111) 92%, transparent);
		border: 1px solid var(--border);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
	}
	.scatter-tooltip p { margin: 0; }
	.scatter-tooltip p + p { margin-top: 4px; }
	.tooltip-bold { font-weight: 600; color: var(--text); }
	:global(.scatter-brush .selection) { fill-opacity: 0.12; }
</style>
