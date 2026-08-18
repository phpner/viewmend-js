import { defineConfig } from 'tsup';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  define: {
    __VIEWMEND_SDK_VERSION__: JSON.stringify(packageJson.version),
  },
});
