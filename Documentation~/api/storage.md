# Storage

Save and load player progress. This page is **required**.

```csharp
static void SaveData(string key, string json, Action<bool> onComplete = null)
static void LoadData(string key, Action<bool, string> onComplete)
```

| Call | Result |
|---|---|
| `SaveData(key, json, onComplete)` | Stores the string. `onComplete(true)` means it was stored. |
| `LoadData(key, onComplete)` | Calls `onComplete(true, value)`, or `onComplete(false, null)` when the key does not exist **or** storage failed. |

## Rules

- Values are **strings**. Serialize your data yourself (for example with `JsonUtility`).
- Both calls are **asynchronous** and complete in a later frame. Do not assume `LoadData` has returned on the next line.
- Treat `ok == false` as "no save, start fresh".
- Load your saves **before** you call `GameReady()`. The QA tool fails the build if saves are read after it.
- Save progress with `SaveData`, not raw `PlayerPrefs`, if it must survive on the portal. `PlayerPrefs` is fine for local-only settings.
- Saves must survive a page reload. The QA tool tests this with its **Reload game** button.
- In the Unity Editor saves are kept in memory only, so they are lost when you stop Play Mode.

## Example

```csharp
[System.Serializable] class Progress { public int level; public int coins; }

void LoadProgress(System.Action<Progress> done)
{
    H5SDK.LoadData("progress", (ok, json) =>
        done(ok ? JsonUtility.FromJson<Progress>(json) : new Progress { level = 1 }));
}

void SaveProgress(Progress p) =>
    H5SDK.SaveData("progress", JsonUtility.ToJson(p));
```
