import { defineConfig } from 'oxlint'

export default defineConfig({
	ignorePatterns: ['dist/**', 'coverage/**'],
	plugins: ['typescript', 'unicorn', 'oxc'],
	categories: {
		correctness: 'error',
	},
	rules: {},
	env: {
		builtin: true,
	},
})
