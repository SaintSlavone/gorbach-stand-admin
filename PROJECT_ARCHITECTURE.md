# Project architecture

The Gorbach stand uses Python's standard library and static HTML, CSS and JavaScript. `server.py` serves an explicit route list and coordinates the two bounded API surfaces. `model.py` validates conversation input and builds Gemini requests from the current knowledge. `knowledge.py` validates and saves the editable knowledge file and supports offline import from legacy Gorbach revisions.

Static pages and their styles are under `public/`. The standalone embed artifact is `public/widget/gorbach.js` and comes from the widget repository. Keep shared API changes coordinated with that repository. Company knowledge ships under `data/initial/`. Keep runtime state and secrets out of Git.

Validate changes with `python -m unittest discover -s tests -v`. The production server requires no frontend compilation.
