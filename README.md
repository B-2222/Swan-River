# Swan River Hoon

A browser jet ski game set on a map-accurate Swan River in Perth, Western Australia. Send massive rooster tails, soak people on the foreshore and cars on the bridges, run from the WA Water Police, and blast out through the Fremantle moles into the Indian Ocean (Rottnest is out there if you are keen).

Open `index.html` through any static web server (for example `python3 -m http.server`) and click **HIT THE WATER**. No install or build step.

## Controls

| Key | Action |
| --- | --- |
| W / Up | Throttle |
| S / Down | Brake, then reverse (like iBR) |
| A / D, Left / Right | Steer. Like a real ski, you need throttle to turn |
| Shift | Power slide (throws a huge sheet of spray off the outside rail) |
| Space | Hop |
| C | Camera (chase, far, first person, drone) |
| M | Full map with speed zones |
| R | Back to the nearest water if stuck |
| T | Skip time forward 3 hours |
| H | Horn |
| Esc / P | Menu (change ski, launch spot, settings) |

Touch controls appear automatically on phones and tablets. Gamepads work too (left stick, triggers, X slide, Y hop).

### How to soak people
The rooster tail comes off the steering nozzle, so a hard turn throws it out sideways. Ride close along the foreshore, then turn **away** from the people and the tail and carve sheet land on them. To soak cars, run under a bridge flat out so the tail goes up through the deck (the Massive tail peaks around 20 m, the Narrows Bridge deck is about 10.5 m).

## What is real

* **River, coastline and islands.** The water outline, Fremantle Inner Harbour, the moles, Heirisson Island, the Canning, Freshwater Bay, Point Walter and the rest come straight from OpenStreetMap (BBBike Perth extract). Rottnest and Garden Island come from the GSHHS full resolution shoreline.
* **Bridges.** Every bridge over the navigable river (66 deck sections) on its real alignment: the Narrows (road, rail and shared path decks), Causeway, Matagarup (with its arches), Boorloo, Windan, Goongoonup, Elizabeth Quay Bridge, Canning Bridge, Mount Henry, Shelley, Stirling Bridge, the new Walyalup Bridge and the Fremantle rail bridge. Deck heights are estimates.
* **Buildings.** 14,939 real building footprints near the water (the whole CBD, Elizabeth Quay, Crown, South Perth, Fremantle). Heights come from OSM tags where mapped, otherwise from the building type. CBD windows light up at night.
* **Jetties, marinas and moorings.** 922 real jetties and breakwaters, every OSM-mapped marina and swing mooring, so the yacht club pens and Freshwater Bay moorings are where they should be.
* **Landmarks.** The Crawley Edge Boatshed on its jetty, the Bell Tower, Kings Park and its War Memorial, the DNA Tower, the North Mole (red) and South Mole (green) lighthouses, the Round House, the Fremantle container cranes at their OSM positions, Wadjemup lighthouse on Rotto. Heirisson Island has kangaroos.
* **Traffic.** Cars drive (on the left) along the real road network over every road bridge and along the riverside roads.
* **Ferries.** The Perth Water ferry shuttles between Elizabeth Quay and the Mends Street Jetty, and a Rottnest fast cat leaves Barrack Street, obeys the speed zones down the river and heads out to sea. Both throw wakes you can jump.
* **Sun and weather.** Southern hemisphere sun (it crosses the north and sets over the ocean), November sunrise and sunset times, and the afternoon sea breeze (the Fremantle Doctor) chops up the river.
* **Jet skis.** Sea-Doo RXP-X 325, Yamaha GP SVHO, Kawasaki Ultra 310R and Sea-Doo Spark Trixx, with published power, length and approximate top speeds. The rider wears a life jacket, which is compulsory on PWCs in WA.

### Speed zones (based on WA Department of Transport rules)

* 8 knots: Fremantle Port up to Mosman Bay, Perth Water (Narrows Bridge to the Causeway and on to the Windan Bridge), Matilda Bay, the upper Swan above the Windan Bridge, and the upper Canning outside the ski area.
* 8 knots through any bridge arch unless signed otherwise.
* 8 knots within 50 m of a person in the water.
* 10 knots between sunset and sunrise outside the restricted areas.
* Freestyle (jumps, donuts) is only allowed in the gazetted Narrows PWC area downstream of the Narrows Bridge. You score 1.5x in there and the cops do not care.

Zone boundaries are simplified into polygons for the game and some have changed over the years, so do not use this as a boating guide. Check the Department of Transport before you go out for real.

### Water Police

Patrols start from the real Fremantle Water Police base in North Fremantle and patrol Perth Water, Melville Water and Fremantle. They only book what they see (land blocks line of sight). Wanted stars bring in more units and at three stars the PolAir helicopter (with a spotlight at night). Break line of sight and stay hidden to escape. Stop next to a police boat and you get pulled over with an infringement notice. Police vessel types follow the WA Water Police fleet as reported publicly: a 17.7 m patrol vessel (Cygnet V class), a 7.6 m jet boat and RHIBs.

Fines use amounts from the WA Marine (Infringements) Regulations and news reporting: $160 for exceeding 8 knots in a restricted area or through a bridge arch, $200 within 50 m of a person in the water, $300 for reckless operation of a PWC.

## Project layout

```
index.html, css/          page, HUD and menus
js/main.js                game loop, scoring, offences
js/world.js               loads the map data, height and shore-distance queries
js/terrain.js             land mesh in level-of-detail chunks, Rottnest
js/water.js               water shader, waves (shared with the physics), wake foam
js/sky.js                 day and night cycle
js/static.js              buildings, bridges, jetties, moorings, landmarks, trees, collisions
js/jetski.js              jet ski physics and chase camera
js/spray.js               rooster tail and spray particles, hit detection
js/npc.js                 people, swimmers, kangaroos, bridge traffic
js/boats.js               ferries, Rottnest fast cat, ski boats, yachts, kayaks, wakes
js/police.js              Water Police AI, wanted level, PolAir
js/nav.js                 A* pathfinding over the real river
js/zones.js               speed zones and place names
js/hud.js, audio.js, input.js, models.js
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
