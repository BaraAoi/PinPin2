# PINPIN II — шёпот леса

A browser-based co-op horror game for **1–10 players** (balanced around four).
You are dropped into a procedurally generated night forest with a dying
flashlight, a wristwatch and your voice.

> **Night is the main time of day.** In the dark you are nearly blind: every
> surface is revealed for a moment by an expanding echo wave. Shout, speak into
> the microphone, throw a stone or light a flare to *see* — and remember that the
> Librarian sees the same waves.

## Features

- **Echolocation.** `Q` shouts; microphone input drives the same sonar shader
  automatically; stones and flares also pulse. Six concurrent wavefronts are
  rendered on every forest material.
- **Living day/night cycle.** 8 minutes per cycle, 58 % of which is night.
  Dawn and dusk are short breathing rooms; night is the main act.
- **Procedural forest.** A 400 m terrain field with trails, a lake, swamps,
  clearings, ruins, camps and a radio tower — all generated from the seed shared
  by the host.
- **Modular night creature.** A Librarian-style enemy with patrol / investigate /
  chase / stun states that reacts to every noise event, hears echo wavefronts,
  and can be blinded by a shove.
- **Physical 3D inventory.** A 6×4 backpack you open with `Tab`: drag items
  around the grid, rotate the camera, inspect, use and drop them.
- **Casio wristwatch.** A real 3D model on the wrist, raised with `C`, with a
  full-screen LCD showing forest time, phase, battery and noise.
- **Interactive hub.** An in-engine night camp: your avatar stands by the fire,
  other players appear around it, microphone level and input device are
  adjustable before the run.
- **P2P multiplayer.** PeerJS star topology with the host as authority; GitHub
  Pages friendly (fully static, `base: './'`).

## Controls

| Key | Action |
| --- | --- |
| `WASD` / `Shift` / `Ctrl` / `Space` | move / sprint / crouch / jump |
| `Q` | shout (echo pulse — makes noise) |
| `E` | interact: loot, revive, radio tower |
| `Tab` | 3D inventory |
| `C` | raise the watch / read the LCD |
| `M` | mute the microphone |
| `Mouse` | look, `LMB` swing, `Esc` pause |

Flares, stones, keys and tapes are used from the 3D backpack (`Tab`).

## Developing

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # static build in dist/
```

Publish `dist/` to GitHub Pages (Settings → Pages → *Deploy from a branch*), or
run `npm run build` in a workflow. `vite.config.ts` uses `base: './'` so the
build works from any subpath.

## Tech

Three.js (r186) for rendering, a custom sonar shader for echolocation, PeerJS
for WebRTC data + voice, TypeScript + Vite. All audio is synthesised at runtime
— there are no asset files to download.
