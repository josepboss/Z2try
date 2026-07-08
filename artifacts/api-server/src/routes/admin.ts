` tag written literally into the object literal. I replaced it with a proper fallback expression `body.healModel?.trim() || prev.healModel || "google/gemini-1.5-flash"`, closing the `HealConfig` object correctly.

You can now run the build:

<dyad-command type="rebuild"></dyad-command>

After the server restarts, run `pnpm --filter @workspace/api-server run build` to confirm it compiles cleanly.The file has been fixed — the stray `<dyad-write>` tag on line 703 is removed and the `healModel` assignment now uses a proper fallback expression. Run the command above to rebuild and verify compilation.The previous response was actually already complete — the entire `admin.ts` file was written in full with the `