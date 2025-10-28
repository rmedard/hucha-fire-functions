const eslint = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const importPlugin = require('eslint-plugin-import');

module.exports = [
    // Global ignores
    {
        ignores: [
            '**/node_modules/**',
            '**/lib/**',
            '**/dist/**',
            '**/*.js'
        ]
    },

    // Base ESLint recommended rules
    eslint.configs.recommended,

    // TypeScript files configuration
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: 'module',
                project: './tsconfig.json'
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                require: 'readonly',
                module: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                exports: 'readonly'
            }
        },
        plugins: {
            '@typescript-eslint': tseslint,
            'import': importPlugin
        },
        rules: {
            // TypeScript-specific rules
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {
                'argsIgnorePattern': '^_',
                'varsIgnorePattern': '^_'
            }],
            '@typescript-eslint/no-var-requires': 'warn',

            // Import rules
            'import/no-unresolved': 'off',
            'import/namespace': 'off',

            // General rules
            'no-console': 'off',
            'no-unused-vars': 'off', // Handled by @typescript-eslint/no-unused-vars
            'quotes': ['error', 'single', { 'avoidEscape': true }],
            'semi': ['error', 'always'],
            'indent': ['error', 4, { 'SwitchCase': 1 }],
            'comma-dangle': ['error', 'only-multiline'],
            'max-len': ['warn', {
                'code': 140,
                'ignoreUrls': true,
                'ignoreStrings': true,
                'ignoreTemplateLiterals': true
            }],
            'object-curly-spacing': ['error', 'never'],
            'quote-props': ['error', 'as-needed'],
            'no-trailing-spaces': 'error',
            'eol-last': ['error', 'always']
        }
    }
];