# Swan River

A browser jet ski game set on a map-accurate Swan River in Perth, Western Australia. Send massive rooster tails, soak people on the foreshore and cars on the bridges, run from the WA Water Police, and blast out through the Fremantle moles into the Indian Ocean (Rottnest is out there if you are keen).

Open `index.html` through any static web server (for example `python3 -m http.server`) and click **HIT THE WATER**. No install or build step.

## Controls

| Key | Action |
| --- | --- |
| W / Up | Throttle |
| S / Down | Brake, then reverse (iBR style: the gate drops over the nozzle) |
| A / D, Left / Right | Steer. Like a real ski, you need throttle to turn; the bars ramp in so you can carve precisely |
| Q / E | Trim the nozzle down / up and it stays there (up: bow lifts, faster, bigger rooster tail, hops; down: more grip in turns) |
| Shift (while steering) | Power slide: the rider throws the hull onto its side until the V lets go and the ski slides (huge sheet of spray off the outside rail) |
| Space | Tap to hop, hold to pull back on the bars (wheelie) |
| [ / ] (or - / =) | Rooster tail smaller / bigger, right there on the water: Small, Big, Massive, Ridiculous, Insane. You can also click the TAIL readout under the speedo |
| 1 to 8 | Teleport to the launch spots (0 jumps to the Water Police base) |
| M | Full map with speed zones. Click anywhere on the water to teleport there |
| C | Camera: chase, far chase, first person, passenger looking back (sat behind the rider facing the rooster tail), drone |
| V (hold) | Look back from any camera |
| R | Back to the nearest water if stuck |
| T | Skip time forward 3 hours |
| Esc / P | Menu (change ski, launch spot, settings) |

Teleporting is blocked while the Water Police are after you. Touch controls appear automatically on phones and tablets. Gamepads work too.

### How to soak people
Ride close along the foreshore, then turn **away** from the people so the carve sheet and the tail land on them. To soak cars, run under a bridge flat out so the rooster tail goes up through the deck (the Massive tail climbs about 11 m, the Narrows Bridge deck is about 10.5 m; Ridiculous goes higher).

## How the jet ski works

The handling is **SkiPhysics** (`js/skiphysics/`, from b-2222/jetskirider): a 6-degree-of-freedom rigid body sampled at 11 points on the hull, floating on the game's own water (the same waves the water shader draws, boat wakes, the real river bed and the land, wired up in `js/physworld.js`).

* **Jet pump.** Water comes in through an intake under the hull and is fired out of the nozzle at the stern. Thrust is applied at the nozzle and is limited by engine power at speed, so the 325 hp RXP-X tops out at about 58 knots and the 90 hp Spark at about 43.
* **Thrust vectoring.** The handlebars swing the nozzle. Off the throttle there is very little steering, exactly like the real thing.
* **Ventilation.** If the intake leaves the water (jumps, big rolls, skipping across chop at full noise) the pump sucks air, the revs flare and the thrust disappears until it hooks up again.
* **Planing hull and carving.** At rest it floats on buoyancy, the bow rises over the hump, then planing lift takes over. Each hull point has tyre-like sideways grip that builds to a peak and then lets go, and the strakes bite harder the faster you go, so a hooked-up ski carves hard (around 1.5 to 2.5 g) and the rider leans it into the turn.
* **Power slide.** Hold Shift while steering and the rider rolls the hull onto its side. Once the V bottom comes out of the water the grip lets go and the stern comes round. A light, flat Spark unhooks at about 17 to 37 degrees of roll; the heavy deep-V race and touring hulls (RXP-X, GP, Ultra) have to be thrown much further over (about 25 to 51 degrees) and held there before they slide.
* **iBR.** Squeezing the brake drops a gate over the nozzle and fires the jet forwards and down, so you stop hard and then reverse slowly.
* **Water.** Afternoon sea-breeze chop (the Fremantle Doctor) is rougher out in Melville Water and calmer in the lee of the shore, and the ocean has swell coming through the moles. Near the camera the water is drawn on a fine 1.5 m mesh so the chop and the wakes are really there.
* **Boat wakes.** Every boat leaves a Kelvin wake (the 19.5 degree V) along the path it actually took, so a boat that turns leaves a curved wake. Each arm is a short wave train: a big leading ridge, a trough, a smaller ridge, breaking white along the top. The physics and the water mesh use the same wake maths, so what you see is exactly what you hit: crest a wake at speed and you launch. Runabouts and cruisers give a hop; the Rottnest fast cat (38 m, 30 knots once it is out of the 8 knot zones) throws a wake close to a metre high that gives you real air.
* **Spray and white water.** The hull throws spray off the chines at speed and a wall of water off the leading side in a power slide; a carve peels a sheet off the outside, and landings splash (SkiEffects and Spray from jetskirider). Wherever droplets come down, and behind the jet, the water turns white (a foam map that follows the ski, then fades and breaks up into lace), with milky aerated water left behind. Boats churn white water too.
* **Rooster tail.** The jet stream hits the surface behind the ski and erupts into a thick column that breaks up into spray, bigger with trim up and when the nozzle is swung in a turn.

## What is real

* **River, coastline and islands.** The water outline, Fremantle Inner Harbour, the moles, Heirisson Island, the Canning, Freshwater Bay, Point Walter and the rest come straight from OpenStreetMap (BBBike Perth extract). Rottnest and Garden Island come from the GSHHS full resolution shoreline. The map is at real scale; use the teleports to get around quickly.
* **Bridges.** Every bridge over the navigable river (66 deck sections) on its real alignment: the Narrows (road, rail and shared path decks), Causeway, Matagarup (with its arches), Boorloo, Windan, Goongoonup, Elizabeth Quay Bridge, Canning Bridge, Mount Henry, Shelley, Stirling Bridge, the new Walyalup Bridge and the Fremantle rail bridge. Deck heights are estimates.
* **Buildings.** 14,939 real building footprints near the water (the whole CBD, Elizabeth Quay, Crown, South Perth, Fremantle). Heights come from OSM tags where mapped, otherwise from the building type. Facades are glass towers, offices, apartments, houses with tiled roofs and sheds; windows light up at night.
* **Water Police base.** The station sits where it really is: Point Direction at the end of Harvest Road, North Fremantle, on the OSM building and pontoons tagged "Fremantle Water Police", with boats moored and reinforcements launching from it.
* **Jetties, marinas and moorings.** 922 real jetties and breakwaters, every OSM-mapped marina and swing mooring.
* **Landmarks.** The Crawley Edge Boatshed on its jetty, the Bell Tower, Kings Park and its War Memorial, the DNA Tower, the North Mole (red) and South Mole (green) lighthouses, the Round House, the Fremantle container cranes at their OSM positions, Wadjemup lighthouse on Rotto. Heirisson Island has kangaroos.
* **Traffic.** Cars drive (on the left) along the real road network over every road bridge and along the riverside roads.
* **Ferries.** The Perth Water ferry shuttles between Elizabeth Quay and the Mends Street Jetty, and a Rottnest fast cat leaves Barrack Street, obeys the speed zones down the river and heads out to sea.
* **Sun.** Southern hemisphere sun (it crosses the north and sets over the ocean) with November sunrise and sunset times.
* **Jet skis.** Sea-Doo RXP-X 325, Yamaha GP SVHO, Kawasaki Ultra 310R and Sea-Doo Spark Trixx, with published power, length, weight and approximate top speeds. The rider wears a life jacket, which is compulsory on PWCs in WA.

### Speed zones (based on WA Department of Transport rules)

* 8 knots: Fremantle Port up to Mosman Bay, Perth Water (Narrows Bridge to the Causeway and on to the Windan Bridge), Matilda Bay, the upper Swan above the Windan Bridge, and the upper Canning outside the ski area.
* 8 knots through any bridge arch unless signed otherwise, and within 50 m of a person in the water.
* 10 knots between sunset and sunrise outside the restricted areas.
* Freestyle (jumps, donuts) is only allowed in the gazetted Narrows PWC area downstream of the Narrows Bridge. You score 1.5x in there and the cops do not care.

Zone boundaries are simplified into polygons for the game, so do not use this as a boating guide. Check the Department of Transport before you go out for real.

### Water Police

They do not chase you just for breaking a rule out of their sight:

* **The wrong person.** Most people on the shore just yell. People filming you on their phone, and the odd off-duty cop, ring it in when you soak them. A unit is sent to that spot; get out of there before it arrives and the call-out is stood down.
* **Seen doing it.** If a patrol actually watches you soak someone, drench a police boat or ram one, it is a pursuit straight away.
* **Warnings first.** Speeding or freestyling right in front of a patrol gets a loudspeaker warning. Keep it up in front of them and they pull you over.

More stars bring more units from the base and, at three stars, the PolAir helicopter (with a spotlight at night). Break line of sight and stay hidden to escape. Stop next to a police boat and you get pulled over with an infringement notice. Police vessels follow the WA Water Police fleet as reported publicly: a 17.7 m patrol vessel (Cygnet V class), a 7.6 m jet boat and RHIBs.

Fines use amounts from the WA Marine (Infringements) Regulations and news reporting: $160 for exceeding 8 knots in a restricted area or through a bridge arch, $200 within 50 m of a person in the water, $300 for reckless operation of a PWC.

## Graphics

Low, Medium (sun shadows) and High (shadows plus real mirror reflections of the city in the water). If the frame rate drops too low the game steps the setting down once by itself.

## Project layout

```
index.html, css/          page, HUD and menus
js/main.js                game loop, scoring, offences, teleports
js/world.js               loads the map data, height and shore-distance queries
js/terrain.js             land mesh in level-of-detail chunks, Rottnest
js/water.js               water surface, waves (shared with the physics), wakes, planar reflections
js/sky.js                 sky, clouds, day and night, environment lighting
js/static.js              buildings, bridges, jetties, moorings, landmarks, Water Police base, trees, collisions
js/jetski.js              the player's ski on SkiPhysics: controls, crashes, shore, spray, cameras
js/jetstream.js           the rooster tail jet
js/spray.js               spray particles and hit detection
js/npc.js                 people, swimmers, kangaroos, bridge traffic
js/boats.js               ferries, Rottnest fast cat, ski boats, yachts, kayaks, wakes
js/police.js              Water Police AI, wanted level, PolAir
js/nav.js                 A* pathfinding over the real river
js/zones.js               speed zones and place names
js/hud.js, audio.js, input.js, models.js
js/skiphysics/            SkiPhysics and the Sea-Doo specs from b-2222/jetskirider (no three.js), plus a hull-dependent slide threshold and an optional speed grip boost
js/physworld.js           the world object SkiPhysics samples: the game's waves, boat wakes, river bed and land
js/skifx/                 hull and slide spray (SkiEffects), droplets (Spray), FoamField and the noise texture, from jetskirider (no rooster tail)
js/wakes.js               boat wakes along each boat's real track, shared by the physics and the water shader
data/                     generated map data
tools/                    Python scripts that build data/ from OpenStreetMap
vendor/three.module.min.js  three.js r160 (MIT)
```

## Rebuilding the map data

```
pip install osmium shapely numpy pillow scipy
curl -O https://download.bbbike.org/osm/bbbike/Perth/Perth.osm.pbf
python tools/extract.py Perth.osm.pbf osm_raw.pkl
python tools/water.py
python tools/grid.py
python tools/reach.py
python tools/build.py data
```

Run them from a scratch folder with `tools/` on hand (they read and write intermediate files in the current folder).

## Credits

* Map data &copy; OpenStreetMap contributors, available under the Open Database License (ODbL).
* Island shorelines from GSHHS (Wessel and Smith), via the basemap-data-hires package (LGPL).
* three.js &copy; three.js authors (MIT).
