# The checks of step 0c

Each script is one check of step 0c (`~/projects/home-projects/requirements.md`, "Step 0c"). The header of each script says how to run it and what exit 0 means. The records of the runs on the devices are in the `home-projects` log.

| Script | Check | Needs the 0c routes |
|---|---|---|
| `check-1-relay.ts` | 1: a call forced through `fairfox-turn` carries sound | no: it reaches the relay only |
| `check-2-cli.ts` | 2: werift between two real networks | yes, on the deployed server |
| `check-3-page.ts`, `check-3-log.ts` | 3: the bare page, before the devices | yes, local or deployed |
| `check-4-cli-to-page.ts` | 4: the CLI calls the bare page on the iPhone | yes, on the deployed server |
| `check-5-echo.ts` | 5: the server sends back the sound it hears | yes, local or deployed |
| `check-7-push.ts` | 7: push to the closed home-screen app | yes, on the deployed server |

`audio.ts`, `signal.ts` and `webrtc.ts` are shared by the checks.

The 0c routes are not on `main`: the last deploy of step 0c removed them from production (L2). They are the server modules `check3.ts`, `check3-page.ts`, `check5.ts`, `check7.ts` and `check7-page.ts`, with their settings `FAIRFOX_TURN_SECRET` and `FAIRFOX_CHECK7_PUSH_KEY`, at commit `676665c` on the branch `rebuild-0c`. Release 42 ran that commit. To run a check that needs them, check out `676665c` and run the script from there, against a local server or a deploy of that commit.
