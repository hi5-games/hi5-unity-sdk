# Optimizing the WebGL build

Portals load your game over the web, so download size and load time matter (many also enforce size limits).
The window `H5 Platform SDK > Open` guides you through it. Every change is previewed and nothing runs silently.

| Tab | What it does |
|---|---|
| **Optimize Wizard** | Six steps, one at a time: Build & Analyze → Textures → Audio → Shaders & Fonts → Test (QA) → Release build. The step bar lets you jump to any step. |
| **Build Settings** | The few size options that are a real trade-off (compression, stripping, IL2CPP code generation, exceptions), scenes, and both build buttons. |
| **Textures** | Lowers the WebGL max texture size (default cap 2048, never above the source size) and enables crunch compression. |
| **Audio** | Vorbis for WebGL, quality cap (default 0.5), load type by clip size, optional Force to Mono. |
| **Shaders** | Shows the shaders of the last build and Graphics Settings > *Always Included Shaders*. Entries no material uses can be removed (unselected by default; UI, sprite, TextMeshPro and URP shaders are protected). |
| **Fonts** | Lists font files and TextMeshPro font assets with advice (subset very large CJK/Unicode fonts, trim atlases). Only automatic change: *Clear Dynamic Data On Build* for dynamic TMP fonts. |

## Two kinds of build
- **Analysis build** (step 1, *Build & Analyze*, about 1-3 min): one fixed configuration chosen to finish fast. Its size is meaningless; the report of assets by type and the largest assets is what counts. Your settings are restored afterwards. Never send this build.
- **Release build** (last step, *Build for Release*, about 5-15 min): uses your Build Settings. This is the build you send.

## Recommended flow
1. **Build & Analyze** once. The tabs now show sizes "in build".
2. **Textures** → *Scan*, review the list (largest first), untick anything that must stay sharp, *Apply selected*.
3. **Audio**, **Shaders** and **Fonts** → same.
4. **Test (QA)** to check the integration and the screen sizes.
5. **Release build**: pick the options (`Managed stripping: Medium` is safe; `High` is smaller but can break reflection-based code, so test before using it), then *Build for Release*. Use *Test last build* once more before you send it.

## Safety
- Only the **WebGL platform override** of each texture/audio importer is changed. Other platforms keep their settings.
  (Exception: *Force to Mono* is a clip-wide importer flag.)
- **Undo last apply** restores the exact previous importer values for the assets changed by the last apply (one level per type; stored in `Library/H5PlatformSDK/`, not in version control).
- Assets under `Editor/`, `Gizmos/` and `Packages/` are skipped. Shader/font undo works the same way (one level per tab).
- Review visuals/sound after applying. Crunch is lossy; quality 50 is a starting point.

## Shaders and fonts: what to expect
- A shader that is not on the Always Included list is only built when a material/scene references it. Removing entries is safe only if no script loads them with `Shader.Find`; that is why nothing is pre-selected.
- Fonts: the SDK cannot subset a TTF for you. The big win is replacing a 5-10 MB CJK font with a subset of the characters you really use (e.g. `pyftsubset`, `glyphhanger`), then re-assigning it.
- Shader *variant* stripping (URP Global Settings / IPreprocessShaders) is not covered yet.

## Not covered yet
Meshes and a PlayerPrefs viewer (backlog, see `Plans/07-Backlog.md`). Use *Largest assets* in the build report to see if anything else matters for your game.

## Notes
- Sizes marked "in build" come from the last Build & Analyze report; otherwise the source file size is shown.
- The analysis lists the 40 largest assets of the last neutral build. Builds made outside the SDK are not analyzed.
