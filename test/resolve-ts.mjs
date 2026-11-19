// Lets `node --test` run the app's TypeScript as is: the source imports
// "./vad" with no extension (Vite's style), so try ".ts" when Node finds nothing.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier) || /\.\w+$/.test(specifier)) throw e;
      return next(`${specifier}.ts`, context);
    }
  },
});
