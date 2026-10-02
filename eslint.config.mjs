import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'release/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    // Les extensions d'exemple sont du CommonJS chargé par l'hôte de plugins, pas du code
    // de l'application : elles ont leurs propres globales.
    files: ['examples/plugins/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { exports: 'writable', module: 'writable', require: 'readonly', console: 'readonly' }
    }
  }
)
