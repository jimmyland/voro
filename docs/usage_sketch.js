// This usage sketch is a mix of actual usage example and sketch of how I'd like usage to look (for in-progress features)
// i.e. initially it records how I think I would like to use the library (before it exists)
// and then as I actually implement it, it will solidify into how the library is actually used.


// init lib
var voro = new Module.Voro([-10,-10,-10],[10,10,10]); // args are the bounding box min and max

// add points as needed in js
var numPts = 1000;
for (var i=0; i<numPts; i++) {
    voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], Math.random()>.8);
}

// compute the voronoi diagram and dump the whole thing into a vertex buffer -- useful if you don't care about editing, etc.
// todo: replace! this use path will be deprecated as fully featured version is developed.
// var maxMeshVerts = Math.floor(100000/3)*3;
// var meshVertsPtr = _malloc(maxMeshVerts*3*4);
// var meshNumPts = voro.compute_whole_vertex_buffer_fresh(maxMeshVerts, meshVertsPtr); 

// --- fake usage starts here ////// I haven't written these parts of the library yet ---

// threejs helper fns
var geometry = v3_build_geometry(voro, {settings}); // build an actual threejs buffergeometry
var gl_buffers = voro.build_gl_buffers(); // v3_build_geometry calls this

// raycast via threejs function, but then do a lookup via voro
var cell = v3_raycast(voro, ray parameters however threejs likes them); 
var cell = voro.lookup_cell_from_vertex(vertex_index) // v3_raycast uses this to lookup the cell

// update the rendered diagram -- visits cell and its neighbors, updates the buffers used by the geometry
voro.toggle(cell); // type goes n->0 or 0->1
voro.set_type(cell, type);

// delete, add and move cells.  all require recomputation of the cell and its neighbors
voro.delete_cell(cell);
voro.add_cell(pos, type); // this one was already defined above; after the voronoi diagram has been built, it should trigger recomputation
voro.move_cell(cell, [x, y, z]); // cache cell neighbors, delete cell, add new, recompute buffers for cell and its old and new neighbor cells
voro.recompute_cell(cell); // re-gen all buffers for the cell
voro.switch_cells(cell1, cell2); // switch the cells in their buffers; update all references as needed to both cells.  helps for effecient delete (switch w/ end and pop end)

// expands any buffers as needed, sets the correct length on all buffers, marks buffers dirty as needed.
v3_update_geometry(voro, geometry);
// -> todo: check if arrays backing the buffergeometry passed in are still the same memory as the voro arrays, if not re-set them
var gl_buffers = voro.get_existing_gl_buffers(); // use this to check


// --- end of fake usage \\\\\\ let's get real again! ---

// cleanup
voro.delete();