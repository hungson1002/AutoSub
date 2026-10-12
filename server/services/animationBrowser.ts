import {existsSync} from 'node:fs';
import path from 'node:path';

export function resolveBrowserExecutable(){
  const candidates=[process.env.AUTOSUB_CHROME_PATH,
    process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Google','Chrome','Application','chrome.exe'),
    process.env['PROGRAMFILES(X86)']&&path.join(process.env['PROGRAMFILES(X86)'],'Google','Chrome','Application','chrome.exe'),
    process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Google','Chrome','Application','chrome.exe'),
    process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Microsoft','Edge','Application','msedge.exe'),
  ].filter((candidate):candidate is string=>Boolean(candidate));
  return candidates.find(candidate=>existsSync(candidate));
}
