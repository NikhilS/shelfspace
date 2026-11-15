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

const CLIENT_FIRESTORE_BAN_PATHS = [
  {
    name: 'firebase/firestore',
    message:
      'Direct client Firestore SDK imports are forbidden (Evergreen Golden Rule). Route all data access through tRPC procedures.',
  },
  {
    name: '@firebase/firestore',
    message:
      'Direct client Firestore SDK imports are forbidden (Evergreen Golden Rule). Route all data access through tRPC procedures.',
  },
];

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
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {checksVoidReturn: {attributes: false}},
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/array-type': ['error', {default: 'array-simple'}],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {accessibility: 'no-public'},
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: {
            regex: '^I[A-Z]',
            match: false,
          },
        },
        {
          selector: 'typeParameter',
          format: ['PascalCase'],
          custom: {
            regex: '^T[A-Z]',
            match: false,
          },
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message:
            'Google TypeScript Style Guide (§ 3.3.2): Do not use default exports; always use named exports.',
        },
        {
          selector:
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type="ArrowFunctionExpression"]',
          message:
            'Google TypeScript Style Guide (§ 5.2): Prefer named function declarations (`export function foo(...)`) over exported arrow functions.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: CLIENT_FIRESTORE_BAN_PATHS,
        },
      ],
    },
  },
  {
    // Client-Server Isolation: browser code must never import server modules or firebase-admin
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      'src/server/**',
      'src/lib/trpc.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...CLIENT_FIRESTORE_BAN_PATHS,
            {
              name: 'firebase-admin',
              message:
                'Browser code must never import firebase-admin. Keep Admin SDK usage inside src/server/.',
            },
          ],
          patterns: [
            {
              group: [
                'firebase-admin/*',
                '**/server/**',
                '../server/**',
                './server/**',
                '@/server/**',
              ],
              message:
                'Client-Server Boundary Violation: Browser modules must not import from src/server/**. Share contracts via src/types/, src/schemas/, or src/constants/.',
            },
          ],
        },
      ],
    },
  },
  {
    // Provider Barrel Encapsulation: consumers outside metadata/catalog packages must use index.ts barrels
    files: ['src/server/**/*.ts', 'src/server/**/*.tsx'],
    ignores: [
      'src/server/services/metadata/**',
      'src/server/services/catalog/**',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: CLIENT_FIRESTORE_BAN_PATHS,
          patterns: [
            {
              group: [
                '**/services/metadata/providers/*',
                '**/services/catalog/providers/*',
              ],
              message:
                'Barrel Encapsulation: Import metadata and catalog providers through their package index.ts barrel or registry rather than deep provider files.',
            },
          ],
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
