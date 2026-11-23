# Game events

Tell the platform what the game is doing. `GameReady()` is **required**. The others are optional but recommended.

```csharp
static void GameReady()                         // loading done, first interactive frame
static void LevelStarted(string levelName = null)
static void LevelCompleted(string levelName = null)
static void LevelFailed(string levelName = null)
static void LevelPaused()
static void LevelResumed()
static void Restart()
static void ReturnToHome()
```

## GameReady

Call `GameReady()` **exactly once per session**, when loading has finished and the game is interactive. Load saves first, then call it. The QA tool checks that it is called once, after loading reached 100%, and that no interstitial is shown before it.

## Level and navigation events

| Call | When |
|---|---|
| `LevelStarted(name)` | A level or round begins. |
| `LevelCompleted(name)` / `LevelFailed(name)` | The level ends. A natural moment for an interstitial. |
| `LevelPaused()` / `LevelResumed()` | The player pauses or resumes through your own menu. |
| `Restart()` | The player restarts. |
| `ReturnToHome()` | The player goes back to the main menu. |

`levelName` is an optional label. Platforms that do not use an event ignore it. That is never an error.

```csharp
H5SDK.LevelStarted("level_12");
// ...
H5SDK.LevelCompleted("level_12");
```
