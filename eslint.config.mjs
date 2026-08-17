export default [
	{
		ignores: [
			"node_modules/**",
			"target/**",
			"docs/openclaw/**",
			"inf-Coding/**",
			"Labyrinth_*/**",
			"external/**",
			"backups/**",
			".openclaw/**",
			".venv/**",
			".claude/**",
		],
	},
	{
		files: ["scripts/**/*.js"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				Buffer: "readonly",
				console: "readonly",
				process: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
			},
		},
		rules: {
			"no-unused-vars": [
				"warn",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
		},
	},
];
