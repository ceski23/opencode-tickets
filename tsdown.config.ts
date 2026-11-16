import solid from 'rolldown-plugin-solid'
import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: ['./src/tui.tsx'],
	outDir: './dist',
	format: ['esm'],
	fixedExtension: false,
	platform: 'node',
	target: 'es2022',
	dts: true,
	clean: true,
	sourcemap: false,
	minify: false,
	deps: {
		// Bundle only the theme helper; all other dependencies stay external.
		onlyBundle: ['@opencode/theme'],
		// `effect` is a host runtime module pulled in by the bundled theme code.
		neverBundle: ['effect'],
	},
	plugins: [
		solid({
			solid: {
				moduleName: '@opentui/solid',
				generate: 'universal',
			},
		}),
	],
})
