/**
 * Split a long chart title into one or two lines at word boundaries so SVG text
 * does not run past the plot width on narrow viewports.
 *
 * Parameters
 * ----------
 * text : string
 * maxLine : number
 *     Target maximum characters on the first line; second line may be longer.
 *
 * Returns
 * -------
 * string[]
 *     One or two non-empty lines.
 */
export function splitChartTitle(text, maxLine = 46) {
	const t = String(text).trim();
	if (t.length <= maxLine) return [t];
	let cut = t.lastIndexOf(' ', maxLine);
	if (cut < maxLine * 0.35) {
		const forward = t.indexOf(' ', maxLine);
		cut = forward > 0 ? forward : cut;
	}
	if (cut <= 0) {
		return [t.slice(0, maxLine).trimEnd(), t.slice(maxLine).trim() || t.slice(maxLine)];
	}
	const a = t.slice(0, cut).trim();
	const b = t.slice(cut + 1).trim();
	return b.length === 0 ? [a] : [a, b];
}
