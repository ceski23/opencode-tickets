import { defineConfig } from 'oxfmt'

export default defineConfig({
	arrowParens: 'avoid',
	bracketSameLine: false,
	bracketSpacing: true,
	endOfLine: 'lf',
	jsxSingleQuote: false,
	objectWrap: 'preserve',
	printWidth: 120,
	semi: false,
	quoteProps: 'as-needed',
	singleAttributePerLine: true,
	singleQuote: true,
	tabWidth: 4,
	trailingComma: 'all',
	useTabs: true,
	ignorePatterns: ['.opencode/tickets', 'bun.lock', 'CHANGELOG.md'],
	sortImports: {
		newlinesBetween: false,
		groups: [['side_effect'], ['builtin'], ['external'], ['internal'], ['parent'], ['sibling'], ['index']],
	},
	sortPackageJson: false,
})
