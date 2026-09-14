import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'com.local.mx-keypad-ahp-bridge';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = realpathSync(process.execPath);
const home = homedir();
const installRoot = join(home, 'Library', 'Application Support', 'MxKeypadAhpBridge');
const launchAgents = join(home, 'Library', 'LaunchAgents');
const logs = join(home, 'Library', 'Logs');
const plistPath = join(launchAgents, `${label}.plist`);
const domain = `gui/${process.getuid()}`;

mkdirSync(launchAgents, { recursive: true });
mkdirSync(logs, { recursive: true });
spawnSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
waitForUnload();
rmSync(installRoot, { recursive: true, force: true });
mkdirSync(installRoot, { recursive: true });
cpSync(join(root, 'dist'), join(installRoot, 'dist'), { recursive: true });
cpSync(join(root, 'node_modules'), join(installRoot, 'node_modules'), { recursive: true });
cpSync(join(root, 'package.json'), join(installRoot, 'package.json'));
cpSync(join(root, 'package-lock.json'), join(installRoot, 'package-lock.json'));

const values = {
	label,
	node,
	main: join(installRoot, 'dist', 'main.js'),
	root: installRoot,
	stdout: join(logs, 'mx-keypad-ahp-bridge.log'),
	stderr: join(logs, 'mx-keypad-ahp-bridge.error.log')
};
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${escapeXml(values.label)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${escapeXml(values.node)}</string>
		<string>${escapeXml(values.main)}</string>
		<string>--write-device</string>
		<string>--poll</string>
		<string>2000</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${escapeXml(values.root)}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>5</integer>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardOutPath</key>
	<string>${escapeXml(values.stdout)}</string>
	<key>StandardErrorPath</key>
	<string>${escapeXml(values.stderr)}</string>
</dict>
</plist>
`;

writeFileSync(plistPath, plist, { mode: 0o600 });
chmodSync(plistPath, 0o600);
execFileSync('/bin/launchctl', ['bootstrap', domain, plistPath]);
execFileSync('/bin/launchctl', ['kickstart', '-k', `${domain}/${label}`]);
console.log(`Installed and started ${label}`);

function waitForUnload() {
	for (let attempt = 0; attempt < 50; attempt++) {
		const result = spawnSync('/bin/launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' });
		if (result.status !== 0) {
			return;
		}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
	}
	throw new Error(`Timed out waiting for ${label} to unload`);
}

function escapeXml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}
