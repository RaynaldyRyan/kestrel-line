# Kestrel Line

A round-based tactical FPS in three.js, built for the make.fun bounty
"Make the best three.js tactical FPS". Counter-Strike-style, never a copy:
an original map, original weapons and original names.

Two teams of five fight short rounds on Halcyon Depot, a dusk-lit industrial
compound. The Kestrels attack with a demolition charge; the Wardens defend
Sites A and B. Win by eliminating the other team, detonating the charge, or
— as a Warden — running the clock out or defusing the charge. The player
picks a side on the start menu: attack with the Kestrels or defend with the
Wardens.

A radar in the corner tracks teammates, the charge and both sites; smoke
grenades block sight for bots and players alike, flash grenades blind anyone
looking at the pop, and a defuse kit halves the time a defuse takes.

## Play

`node serve.ts`, then open http://localhost:8080 in desktop Chrome.

- WASD move, mouse look, Shift walk, Space jump, Ctrl/C crouch
- Click fire, R reload, 1/2 switch weapon, E plant/defuse
- 3 frag, 4 flash, 5 smoke grenade (G throws a frag)
- B buy menu during the buy phase (rifles, marksman rifle, SMG, three
  grenade types, vest, helmet, defuse kit); Tab scoreboard

## How it is built

The simulation is plain JavaScript with no three.js dependency: a fixed-step
loop in `game/src/main.js` drives `state.js` (one state object),
`map.js` (colliders, waypoints, line of sight), `bots.js` (perception,
routing, combat), `combat.js` (weapons, raycasts, grenades) and `player.js`
(movement). `render.js` turns that state into a three.js scene; `hud.js`
owns the DOM; `minimap.js` draws the radar from the map's own data; `audio.js`
synthesises every sound with WebAudio — no asset ever leaves `game/`, and
nothing is fetched over the network.

`main.ts` hands the game in: it copies `game/` and `screenshots/` to
`/output` and writes the dossier with the kit's vendored library.
