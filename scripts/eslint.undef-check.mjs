import js from '@eslint/js'
import globals from 'globals'
import { Linter } from 'eslint'

const linter = new Linter({ configType: 'flat' })

const code = await import('fs').then(fs =>
  fs.promises.readFile(new URL('../video-server/index.js', import.meta.url), 'utf8')
)

const messages = linter.verify(code, [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'off',
    },
  },
])

const undefs = messages.filter(m => m.ruleId === 'no-undef')
if (undefs.length === 0) {
  console.log('no-undef: 0 errors in video-server/index.js')
  process.exit(0)
} else {
  for (const m of undefs) {
    console.error(`${m.line}:${m.column}  error  '${m.message}'  no-undef`)
  }
  process.exit(1)
}
