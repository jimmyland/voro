# Voro

## Cellular 3D Modeling using Voronoi Diagrams

Built on top of threejs and voro++ (used in js via emscripten), this is a simple 3D modeling program that lets you make shapes out of voronoi cells.  Try it out on the live github pages page ( http://jimmyland.github.io/voro/ ), and click the HELP? link there for more practical usage advice.

Any new code here from me is released under the standard open source MIT license.

# Developer Instructions

So far this has been mostly just one person developing, but help is certainly welcome!  I will list some getting started / install instructions below -- please let me know if you try them, and if there are any issues or fixes needed to make them work for you!

## Building and running:

### Compiling the C++ code

Note that the repository includes a pre-compiled `vorowrap.js`, so you can skip compiling the C++ code unless you plan to edit it.
If you do need to edit the C++ code:

1. Acquire Emscripten: http://kripken.github.io/emscripten-site/ (or `brew install emscripten` on Mac if you have homebrew)

2. Run `make`.

### Running the JS code

You basically just need to open index.html in a browser, BUT for the browser to successfully load all the other resource and js files it needs, you'll need to serve that file from a local server instead of opening it directly.  What I do is install the super-basic `http-server` and use that to serve index.html on localhost:

1. Install node.js: https://nodejs.org/en/download/ (or `brew install node` on Mac if you have homebrew)
2. Install http-server globally: `npm install http-server -g`
3. cd to the directory where you've downloaded the voro project files, and run `http-server`
4. While the server is running, open `http:127.0.0.1:8080` in your web browser

When developing and testing the code, I like to use Chrome and have the developer tools open, and go to the Network tab of the developer tools and make sure 'Disable cache' is checked.  That way, when I edit a javascript file and refresh the browser, it will reliably pick up my changes.

### Code overview:

The core voronoi diagram computation code is all from an academic C++ library called voro++, which lives in the voro++ subdirectory.  This code is only minimally changed in this project to allow more efficient editing of an already-constructed diagram -- I added functions to efficiently move and delete cells.

This functionality is exposed to javascript by vorowrap.cpp, which defines a `Voro` class with a suite of helper functions to add, move, and delete voronoi cells.  It then exposes buffers of triangles and vertices defining those cells to javascript via the `gl_*` functions (so-called because they expose buffers that webgl could use).  The gl_* functions pass buffers back to javascript via the black magic of casting pointers to `uintptr_t`, which javascript can then understand as an array via HEAP functions like `Module.HEAPF32.subarray` -- this is super gross, but as far as I could tell there wasn't actually a non-gross way to get a big buffer of array data back to js, so it is what it is.

Vorowrap is used by voro3.js -- so named because it wraps together correct usage of the C++ Voro class with the lovely webgl 3D library threejs, which is what I use for all the 3D rendering and UI.  voro3.js also layers additional higher-level features on top of the basic voronoi diagram functionality: It has features to track and enforce various symmetry modes, and it defines operations in terms of *Act classes (e.g., `AddAct`, `DeleteAct`) that can be tracked and undone/redone, so you can build undo/redo functionality if you want it.

voro3.js is used by main.js -- the code that sets up the 3D scene, the 3D UI interactions, the actual undo queue, etc.

Finally, index.html sets up the window, all the 2D UI that needs html definition, and starts main.js running.

Note that all js dependencies are generally just copied into the js folder, rather than using any kind of package manager.  Most of these are just downloaded snapshots of libraries, with no changes.  (The main exception is threejs, for which I maintain a monkeypatch to fix up their raycasting, and I also manually copy some of their useful 3D UI code that is not included in the main distribution into js/controls/*)

I include some compiled data (vorowrap.js and associated mem and map files) in the repo just to make http://jimmyland.github.io/voro/ work easily.