import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const label = 'com.local.mx-keypad-ahp-bridge';
const domain = `gui/${process.getuid()}`;
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const installRoot = join(homedir(), 'Library', 'Application Support', 'MxKeypadAhpBridge');

spawnSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
rmSync(plistPath, { force: true });
rmSync(installRoot, { recursive: true, force: true });
console.log(`Uninstalled ${label}`);
