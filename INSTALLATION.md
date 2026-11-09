# Install and update VibeLight Tizen

VibeLight Tizen requires Tizen 5.5 or newer. The TV and the device used for installation must be on the same network.

This is the Markdown installation reference. The illustrated guide is online in
[English](https://samirmartins.github.io/vibelight-tizen/?lang=en#install),
[Português (Brasil)](https://samirmartins.github.io/vibelight-tizen/pt-br/?lang=pt-br#install)
and [Español](https://samirmartins.github.io/vibelight-tizen/es/?lang=es#install).
It covers [v4.0.3](https://github.com/samirmartins/vibelight-tizen/releases/tag/v4.0.3).

## Apps2Samsung (recommended)

1. Download a `.wgt` from the [latest release](https://github.com/samirmartins/vibelight-tizen/releases/latest).
2. On the TV, open **Apps / App Settings**, enter `12345`, enable **Developer Mode**, enter the installer device's IP address and restart the TV. Menu details vary by model.
3. Download [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung/releases/latest), open it, and select the TV or enter its IP address.
4. Select your downloaded `.wgt` and follow the signing/installation prompts. The option's name varies by Apps2Samsung version. Sign in to Samsung if requested.

Choose the build that suits your TV:

- **Normal:** does not request TV panel Game Mode.
- **ForceGM:** requests TV panel Game Mode; support depends on the TV and firmware.

The in-app **Ultra-low video latency** setting (called **Game Mode** in v4.0.2)
controls the decoder and is separate from ForceGM's panel request. It defaults
to **OFF**, including with ForceGM. It can be unstable on some TVs/system
versions; leave it off on the previously tested Tizen 9 configuration.

### Updates

Normal and ForceGM share the same application identity. Updates preserve settings
and pairing only when the author certificate remains compatible and the installer
does not uninstall the app. Reuse your Apps2Samsung signing profile and existing
author certificate. Review automatic recovery after a certificate/install error:
it may remove the app and its data. Check the installer's messages before
proceeding; a clean reinstall requires pairing again.

## Tizen Studio (alternative)

If Apps2Samsung fails:

1. Install Tizen Studio with the **TV Extensions** and **Samsung Certificate Extension**.
2. Connect the TV in **Device Manager**, choose **Permit to install applications**, and create a Samsung certificate profile containing the TV's DUID.
3. Import the downloaded WGT through **File > Import > Tizen > Tizen Project**.
4. Repackage/sign with that profile, then run it on the TV. For an update, import
   the existing author certificate instead of creating a replacement.

The downloaded WGT must be repackaged and signed for the TV; installing it unchanged may fail. See Samsung's [Tizen Studio instructions](https://developer.samsung.com/smarttv/develop/faq/tizen-studio.html).

## After installing

Open VibeShine or Sunshine on the PC, select that PC in VibeLight and enter the
TV's PIN in the host's web interface. See the illustrated
[pairing guide](https://samirmartins.github.io/vibelight-tizen/#pair-pin).

Check your installed version against the [release notes](RELEASE_NOTES.md). Building from source uses the separate
[local compilation and packaging guide](build-tools/README.md#local-compilation-and-packaging).
