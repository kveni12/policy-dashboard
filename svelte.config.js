import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		paths: {
			// GitHub Pages project site: set BASE_PATH=/repo-name in CI. Must start with /, no trailing /.
			base: (() => {
				if (process.argv.includes('dev')) return '';
				const b = String(process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '');
				return b && b.startsWith('/') ? b : '';
			})(),
		},
	},
};

export default config;
