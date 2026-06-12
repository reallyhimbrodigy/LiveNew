const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Fixes the iOS pod install error:
 *   "The Swift pod `AppCheckCore` depends upon `GoogleUtilities` and
 *    `RecaptchaInterop`, which do not define modules."
 *
 * Pulled in transitively by @react-native-google-signin. A transitive version
 * bump (RecaptchaInterop 101.x / AppCheckCore) started requiring modular
 * headers to integrate as static libraries. This project uses CNG (the Podfile
 * is generated on every prebuild / EAS build), so we patch the generated
 * Podfile here. Targeted per-pod modular headers for the offending Google pods.
 *
 * NOTE: must be a .cjs file — the project's package.json is "type": "module",
 * so a .js config plugin would be loaded as ESM and `require` would throw.
 */
module.exports = function withModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes('# livenew:modular-headers')) {
        return cfg; // already applied
      }

      const inject = [
        '',
        '  # livenew:modular-headers — make the transitive Google pods generate',
        '  # module maps so the Swift AppCheckCore pod can integrate statically.',
        "  pod 'GoogleUtilities', :modular_headers => true",
        "  pod 'RecaptchaInterop', :modular_headers => true",
        "  pod 'AppCheckCore', :modular_headers => true",
      ].join('\n');

      const targetRe = /(target\s+['"][^'"]+['"]\s+do\s*\n)/;
      if (targetRe.test(contents)) {
        contents = contents.replace(targetRe, `$1${inject}\n`);
      } else {
        contents = contents.replace(
          /^(platform :ios.*$)/m,
          '$1\n\nuse_modular_headers!'
        );
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
};
