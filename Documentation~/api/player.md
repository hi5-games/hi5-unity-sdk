# Player

Player name and language.

```csharp
static void GetPlayerName(Action<bool, string> onComplete)
static void GetLocale(Action<string> onComplete)
```

| Call | Result |
|---|---|
| `GetPlayerName(onComplete)` | `onComplete(ok, name)`. The name defaults to `"Player"` when the platform has none. |
| `GetLocale(onComplete)` | `onComplete(code)` with a language code such as `"en"` or `"vi"`. It falls back to `"en"`. |

Both calls are asynchronous. Use the result to choose the game language on first start, and keep the player's own language choice afterwards.

```csharp
H5SDK.GetLocale(code => SetLanguage(code));
```
