let customConfig = [];
let hasIgnoresFile = false;
try {
  require.resolve('./eslint.ignores.cjs');
  hasIgnoresFile = true;
} catch {
  // eslint.ignores.cjs doesn't exist
}

if (hasIgnoresFile) {
  const ignores = require('./eslint.ignores.cjs');
  customConfig = [{ignores}];
}

const firebaseRulesPlugin = require('@firebase/eslint-plugin-security-rules');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');

module.exports = [
  ...customConfig,
  ...require('gts'),
  firebaseRulesPlugin.flatRecommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      'unused-imports': unusedImportsPlugin,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/array-type': ['error', {default: 'array-simple'}],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {accessibility: 'no-public'},
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message:
            'Google TypeScript Style Guide (§ 3.3.2): Do not use default exports; always use named exports.',
        },
      ],
    },
  },
  {
    files: ['vite.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.rules'],
    rules: {
      'prettier/prettier': 'off',
    },
  },
];
