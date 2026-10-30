// Patches the generated Android project (after `npx cap add android`).
//  1. AndroidManifest: MainActivity must accept the ".NOTIFICATION_CLICKED" intent that the
//     background-runner plugin puts on its notifications. Without this filter, tapping a
//     notification does nothing (no activity matches the intent).
//  2. app/build.gradle: the plugin ships its JS engine as a local .aar (see plugin README).
// Usage: node scripts/patch-android.mjs [androidDir]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLICK_ACTION = '.NOTIFICATION_CLICKED';

export function patchManifest(xml) {
  if (xml.includes(`"${CLICK_ACTION}"`)) return xml;
  const filter = `
            <!-- Tapping a background-runner notification opens the app -->
            <intent-filter>
                <action android:name="${CLICK_ACTION}" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
`;
  // Insert right after the launcher intent-filter of the main activity.
  const launcher = /<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>\s*<\/intent-filter>/;
  const m = xml.match(launcher);
  if (!m) throw new Error('launcher intent-filter not found in AndroidManifest.xml');
  const at = m.index + m[0].length;
  return xml.slice(0, at) + '\n' + filter + xml.slice(at);
}

const FLATDIR_FROM = "dirs '../capacitor-cordova-android-plugins/src/main/libs', 'libs'";
const FLATDIR_ADD = "dirs '../../node_modules/@capacitor/background-runner/android/src/main/libs', 'libs'";

export function patchGradle(text) {
  if (text.includes(FLATDIR_ADD)) return text;
  if (!text.includes(FLATDIR_FROM)) throw new Error('flatDir block not found in app/build.gradle');
  return text.replace(FLATDIR_FROM, `${FLATDIR_FROM}\n        ${FLATDIR_ADD}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || 'android';
  const manifest = join(dir, 'app/src/main/AndroidManifest.xml');
  const gradle = join(dir, 'app/build.gradle');
  writeFileSync(manifest, patchManifest(readFileSync(manifest, 'utf8')));
  writeFileSync(gradle, patchGradle(readFileSync(gradle, 'utf8')));
  console.log('patched', manifest, 'and', gradle);
}
