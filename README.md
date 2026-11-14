# Jezero Turnback

Jezero Turnback is a browser-based Marswalk simulator for the NASA Space Apps Challenge. It compares two walks across Jezero’s western delta and shows when a delay makes it necessary to skip a science stop to protect the return reserve.

## Try the demo

1. Press **Play**. The crew walks to Hogwallow Flats and completes Stop 1.
2. When playback pauses, press **Inject 20-min delay**.
3. Read the new recommendation, follow the highlighted return path, and check the time left at the habitat.

Use the route selector to compare approaches. The Slope and Rover traverse controls toggle the overlays. Select a numbered science waypoint for its task, time estimate, and linked Perseverance observation.

## Run or deploy

Serve `public/` over HTTP. From the repository root, run `python -m http.server 8000 --directory public` and open `http://localhost:8000`. No JavaScript build step or browser login is required. Netlify uses the publish directory configured in `netlify.toml`.

## Data and calculation

- [USGS Mars 2020 HiRISE terrain mosaic](https://www.usgs.gov/data/mars-2020-terrain-relative-navigation-hirise-dtm-mosaic). A one-metre elevation crop is used to derive the hillshade, slope, and route measurements. Horizontal distances correct for the map projection's east-west scale at the patch.
- [NASA/JPL Perseverance location map](https://science.nasa.gov/mission/mars-2020-perseverance/location-map/). Rover track and end-of-drive waypoints are from the map's MMGIS layers. The science stops are hypothetical tasks based on observations at [Hogwallow Flats](https://science.nasa.gov/resource/perseverances-mastcam-z-views-hogwallow-flats/) and [Skinner Ridge and Wildcat Ridge](https://science.nasa.gov/photojournal/2-abrasion-patches-from-perseverance-at-jezero-delta).
- [NASA PDS MEDA archive](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html). The conditions panel shows a calibrated surface pressure observation from sol 461. Its source file is linked on the page. The reading is historical and does not change the simulation.

The 90-minute budget, 15-minute reserve, 20-minute delay, task durations, and habitat location are demo assumptions. The route search uses a four-metre grid and samples the one-metre terrain slope along each edge. Sampled slopes above 25° are excluded. The walking model starts at 0.7 m/s on flat ground and multiplies time per segment by one plus 0.035 times the mean terrain slope in degrees. Distance, cumulative positive elevation change, steepest sampled slope, and walking time are summarized over the three legs. The return after the delay retraces the first leg. Walking speeds and route limits are unvalidated assumptions for the prototype.

Run `python -m pip install -r scripts/requirements.txt` then `python scripts/prepare_map.py` to regenerate the bundled map assets from the source archives.

## AI disclosure

OpenAI Codex helped identify datasets, prepare the terrain, develop and verify the simulation, and author presentation materials. The mission data comes from the linked archives. The demo includes software screenshots only.
