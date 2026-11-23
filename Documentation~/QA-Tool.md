# Test your build with the QA tool

The QA tool opens your build in the browser, the way a portal would, so you can check the SDK integration and the game's layout before you send the build to us. You do not need a terminal.

## Open it
1. In Unity, open **H5 Platform SDK > Open**.
2. Build the game (**Optimize Wizard**, step 1 or the last step).
3. On **Home** click **Test with QA tool**, or go to wizard step 5 and click **Start QA tool**.

Your browser opens the game. Click **Stop QA server** in the same place when you are done.

## What to look at

The tool starts in **guided steps**: the game on the left, one test card on the right. Follow the card: do what it says, answer if it asks. The tool sets up each ad scenario itself. When it detects something (a save, an ad, a mute) the card says so and waits for you to press **Continue**. Spinner plus **Can't trigger it** means the tool is waiting for the game; if you cannot make the game do it, press the button and the step is recorded as a finding. **Progress** lists the steps (with **Restart test** per step and **Restart all tests**); **Findings** lists what failed. On a failed step choose **Continue** to go on or **Try again**. **Reload game** (bottom right) restarts the game and keeps your results. Every step must pass before you send the build.
1. **Build startup** - the tool waits for the SDK to start and `GameReady()` to be sent, then asks you: *Is the game actually ready at this moment?* Look at the game and answer. *No* fails the step.
2. **Game saves** - required. Answering *No* to "Does the game save progress?" fails this step. Otherwise: play until the game saves (the card confirms the save event was detected, press **Continue**), press **Reload game**, then answer whether your progress is restored.
3. **Rewarded ads** - answer *Does the game offer rewarded ads?* If **No**, the step passes. If **Yes**, two cases, each ending with a question you answer:
   - *Closed early:* trigger a rewarded ad in the game. The tool closes it before the end. Answer **Reward received** or **No reward**. The game must NOT give the reward, otherwise the case fails.
   - *Watched to the end:* trigger a rewarded ad and let it play. Answer the same question. The game must give the reward, otherwise the case fails.
4. **Interstitial ads** - same question. If **Yes**, play until the game shows an interstitial. When the tool detects it, answer whether the game paused and muted while the ad was on screen and carried on afterwards. *No* fails the step.
5. **System events** - required, run in order. Press the button on each card: **Send mute signal** (the game must go silent), **Mute and reload** (the platform keeps the mute on while the game reloads; click inside the game, then answer whether it is still muted: sound that comes back fails the step), **Hide the tab** (the game must go silent). Click inside the game first so audio can start.
6. **Scale test** - three cases: 16:9, 9:16 and 1:1. Press **Show this screen**, look at the game (nothing cut off or overlapping, popups can be closed), then answer **Layout OK** or **Layout broken**. A broken layout fails the case.

When all steps pass the card says **All steps passed**. Press **Export report**.

**Switch to manual testing** (top) lifts the guided steps and leaves the game free to play. Use the icons under the game (pause, platform mute, hide tab, reload, full screen) and pick a tool from **Select tool**: Logs, Scaling test, Advertisement, Game Storage, Platform Settings.

**Advertisement**: choose what the next ad does, then play. Try *Show*, *No fill*, *Watched to the end* and *Closed early*. The game must never freeze, and must give a reward only when the ad was watched to the end.

**Game Storage**: look at the saved data, delete it, or edit it, then press the **reload** icon to see how the game loads a fresh, old or damaged save.

**Platform Settings**: send a platform pause and resume, and switch the language.

**Scaling test**: pick a size from the list: landscape 16:9, portrait 9:16, square, phone portrait and landscape, tablet. **Resize test** changes the size continuously. Check that the whole game stays visible and nothing is cut off, in both orientations.

Two quick checks: press the **hide tab** icon (the game must go quiet) and the **mute** icon (the game must obey it).

Browsers only start sound after a click, so click inside the game once before checking audio.

## Before you send the build
1. Run the checks once more on the **release build** (**Test last build** on the last wizard step).
2. Press **Export report** and keep the downloaded `qa-report-<game name>.json` file.
3. Send us the build folder and the report.

A check that fails tells you what to fix. If a fix is not obvious, send us the report and we will help.

Command line, automatic runs and scenario tests (for CI and agents): [QA-Tool-Advanced.md](QA-Tool-Advanced.md).
