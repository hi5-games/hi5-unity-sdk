# Test your build with the QA tool

The QA tool opens your build in the browser, the way a portal would, so you can check the SDK integration and the game's layout before you send the build to us. You do not need a terminal.

## Open it
1. In Unity, open **H5 Platform SDK > Open**.
2. Build the game (**Optimize Wizard**, step 1 or the last step).
3. On **Home** click **Test with QA tool**, or go to wizard step 5 and click **Start QA tool**.

Your browser opens the game. Click **Stop QA server** in the same place when you are done.

## What to look at

**Requirements tab** shows one test step at a time, like a guided checklist. Follow the card: do what it says, answer if it asks, and it moves on by itself when the step passes. **Progress** lists all steps; **Findings** lists the ones that failed. Every step must pass before you send the build.
1. **SDK start-up** - the SDK starts and `GameReady()` is called once, after loading finished.
2. **Save data** - required. Play until the game saves, then press **Reload game** to confirm the progress is restored. Answering *No* to "Does the game save progress?" fails this step.
3. **Interstitial ads** - answer *Does the game show interstitial ads?* If **No**, the step passes. If **Yes**, play until one shows, then set **No fill** on the Ads tab, trigger one again and keep playing: the game must not freeze.
4. **Rewarded ads** - same question. If **Yes**, two cases, each ending with a question you answer:
   - *Case 1:* Ads tab = **Watched to the end**, trigger a rewarded ad in the game, then answer **Reward received** or **No reward**. The game must give the reward, otherwise the case fails.
   - *Case 2:* Ads tab = **Closed early**, trigger one, then answer the same question. The game must NOT give the reward, otherwise the case fails.
5. **Pause & audio** - required, run in order. Use the buttons on each line: **Show test ad** (game silent and paused during the ad, resumes after), **Hide tab 4s**, **Mute 4s** (platform mute). Click inside the game first so audio can start.
6. **Screen layout** - three cases: 16:9, 9:16 and 1:1. Press **Show** on each, look at the game (nothing cut off or overlapping, popups can be closed), then answer **Layout OK** or **Layout broken**. A broken layout fails the case.
7. **Other SDK features** - optional, shown for information.

The line at the top says **Ready to send** when nothing is failing and no step is left.

**Ads tab**: choose what the next ad does, then play. Try *Show*, *No fill*, *Watched to the end* and *Closed early*. The game must never freeze, and must give a reward only when the ad was watched to the end.

**Storage tab**: look at the saved data, delete it, or edit it, then press **Reload game** to see how the game loads a fresh, old or damaged save.

**Platform tab**: send a platform pause and resume, and switch the language.

**Screen sizes**: pick a size from the list above the game: landscape 16:9, portrait 9:16, square, phone portrait and landscape, tablet. **Resize test** changes the size continuously. Check that the whole game stays visible and nothing is cut off, in both orientations.

Two quick checks: press **Hide tab** (the game must go quiet) and **Platform mute** (the game must obey it).

Browsers only start sound after a click, so click inside the game once before checking audio.

## Before you send the build
1. Run the checks once more on the **release build** (**Test last build** on the last wizard step).
2. Press **Export report** and keep the downloaded `qa-report-<game name>.json` file.
3. Send us the build folder and the report.

A check that fails tells you what to fix. If a fix is not obvious, send us the report and we will help.

Command line, automatic runs and scenario tests (for CI and agents): [QA-Tool-Advanced.md](QA-Tool-Advanced.md).
