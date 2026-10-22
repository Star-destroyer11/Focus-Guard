# Focus Guard

Focus Guard is a Tampermonkey userscript for spoofing and bypassing browser focus detection. It includes event logging, configurable page-level overrides, fullscreen bypass, and JSON log exports.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Create a new userscript in the Tampermonkey dashboard.
3. Paste the contents of `focus-guard.user.js` into the editor.
4. Save the script and reload the website.

## Usage

- **Open/Hide Panel:** Press `Alt + Shift + G`.
- **Monitor Events:** View browser focus and visibility events in real time.
- **Configure Overrides:** Enable page-level visibility and focus overrides in the control panel.
- **Fullscreen Simulator:** Test fullscreen-dependent website behavior.
- **Export Logs:** Click **Export JSON** to download event history for analysis.
- **Clear Logs:** Click **Clear log** to erase recorded events.

## Settings

Monitoring is enabled by default, while page overrides and fullscreen simulation are disabled. Settings and event history are saved using Tampermonkey storage.

## Disclaimer

Focus Guard modifies selected client-side JavaScript APIs only when configured to do so. It cannot guarantee compatibility with every website or override browser-native and server-side checks.

**Version:** `1.0.0`
