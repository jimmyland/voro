// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var scene, camera, renderer;
var geometry, material, mesh, pointset;
var voro;
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();

var line;

var datgui;
var settings;

var VoroSettings = function() {
    this.mode = 'camera';
};



function make_line() {
    var geometry = new THREE.BufferGeometry();
    geometry.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 4 * 3 ), 3 ) );
    var material = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 2, transparent: false } );
    line = new THREE.Line( geometry, material );
    return line;
}


function wait_for_ready() {
    if (ready_for_emscripten_calls) {
        init();
    } else {
        requestAnimationFrame( wait_for_ready );
    }
}
wait_for_ready();

//function v3_build_geometry_old(voro, settings) {
//    var geometry = new THREE.BufferGeometry();
//    var maxMeshVerts = 100000;
//    maxMeshVerts = Math.floor(maxMeshVerts/3)*3;
//    var meshVertsPtr = _malloc(maxMeshVerts*3*4);
//    var meshNumPts = voro.compute_whole_vertex_buffer_fresh(maxMeshVerts, meshVertsPtr);
//    
//    var array = Module.HEAPF32.subarray(meshVertsPtr/4, meshVertsPtr/4 + meshNumPts*3);
//    var vertices = new THREE.BufferAttribute(array, 3);
//    geometry.addAttribute( 'position', vertices );
//    
//    return geometry;
//}

function v3_raycast_vertex_index(voro, mesh, mouse, camera, caster) {
    caster.setFromCamera(mouse, camera);
    var intersects = raycaster.intersectObject(mesh);
    line.visible = true;//intersects.length > 0;
    if (intersects.length == 0)
        return -1;
    
    var intersect = intersects[0];
    console.log("index: " + intersect.index);
    var face = intersect.face;
    var linePosition = line.geometry.attributes.position;
    var meshPosition = mesh.geometry.attributes.position;
    linePosition.copyAt( 0, meshPosition, face.a );
    linePosition.copyAt( 1, meshPosition, face.b );
    linePosition.copyAt( 2, meshPosition, face.c );
    linePosition.copyAt( 3, meshPosition, face.a );
    line.geometry.attributes.position.needsUpdate = true;
    
    return intersect.index;
}

function v3_raycast(voro, mesh, mouse, camera, caster) {
    index = v3_raycast_vertex_index(voro, mesh, mouse, camera, caster)
    if (index < 0)
        return index;
    
    return voro.cell_from_vertex(index)
}
function v3_raycast_neighbor(voro, mesh, mouse, camera, caster) {
    index = v3_raycast_vertex_index(voro, mesh, mouse, camera, caster)
    if (index < 0)
        return index;
    
    return voro.cell_neighbor_from_vertex(index)
}

function v3_build_geometry(voro, settings) {
    var geometry = new THREE.BufferGeometry();
    var max_tris = 100000;
    voro.gl_build(max_tris /* initial guess at num tris needed */);
    var verts_ptr = voro.gl_vertices();
    var num_tris = voro.gl_tri_count();
    var max_tris = voro.gl_max_tris();
    var array = Module.HEAPF32.subarray(verts_ptr/4, verts_ptr/4 + max_tris*3*3);
    var vertices = new THREE.BufferAttribute(array, 3);
    geometry.addAttribute('position', vertices);
    geometry.setDrawRange(0, num_tris*3);
    return geometry;
}

function v3_update_geometry(voro, geometry) {
    var num_tris = voro.gl_tri_count();
    geometry.setDrawRange(0, num_tris*3);
    geometry.attributes['position'].needsUpdate = true;
}

function v3_toggle_cell(voro, cell, geometry) {
    voro.toggle_cell(cell);
    v3_update_geometry(voro, geometry);
}


//var geometry = v3_build_geometry(voro, {settings}); // build an actual threejs buffergeometry
// note: "geometry" object returned might not be a threejs geometry; might be an object that has a threejs buffergeometry and some extra info
//var gl_buffers = voro.build_gl_buffers(); // v3_build_geometry calls this

function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 10;
    

    

    datgui = new dat.GUI();
    settings = new VoroSettings();
    datgui.add(settings,'mode',['camera', 'activate', 'deactivate', 'add', 'delete']);
    


    // create voro structure w/ bounding box
    voro = new Module.Voro([-10,-10,-10],[10,10,10]);
    var numPts = 1000;
    for (var i=0; i<numPts; i++) {
        voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], Math.random()>.8);
    }
    
    geometry = v3_build_geometry(voro, {});
    
    v3_toggle_cell(voro, Math.floor(Math.random()*voro.cell_count()), geometry);
    
//    voro.delete();

    
    
    var lights = [];
    lights[0] = new THREE.PointLight( 0xffffff, 1, 0 );
    lights[1] = new THREE.PointLight( 0xffffff, 1, 0 );
    lights[2] = new THREE.PointLight( 0xffffff, 1, 0 );
    
    lights[0].position.set( 0, 200, 0 );
    lights[1].position.set( 100, 200, 100 );
    lights[2].position.set( -100, -200, -100 );
    
    scene.add( lights[0] );
    scene.add( lights[1] );
    scene.add( lights[2] );
    
//    var ptsgeometry = new THREE.BufferGeometry();
//    var ptsarray = Module.HEAPF32.subarray(offset/4, offs  et/4 + numPts*3);
//    ptsverts = new THREE.BufferAttribute(ptsarray, 3);
//    ptsgeometry.addAttribute( 'position', ptsverts );
//    ptsmaterial = new THREE.PointsMaterial( { size: .1, color: 0x0000ff } );
//    pointset = new THREE.Points( ptsgeometry, ptsmaterial );
//    scene.add( pointset ); // no longer corresponds to vor                                                                                                                                                                                                                                                                                                                 o cells, todo fix and re-add
    material = new THREE.MeshPhongMaterial( { color: 0xdddddd, specular: 0x009900, shininess: 30, shading: THREE.FlatShading } ) ;
    mesh = new THREE.Mesh( geometry, material );
//    mesh.raycast = THREE.Mesh.prototype.raycast_fixed;
    scene.add( mesh );
    
    line = make_line();
    scene.add(line);
//    edges = new THREE.EdgesHelper( mesh, 0x00ff00 ); scene.add( edges );



    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setPixelRatio( window.devicePixelRatio );
    
    window.addEventListener( 'resize', onWindowResize, false );
    document.addEventListener( 'mousemove', onDocumentMouseMove, false );

    container = document.getElementById( 'container' );
    container.appendChild( renderer.domElement );
    
    controls = new THREE.TrackballControls( camera, renderer.domElement );
    controls.rotateSpeed = 10.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 1.8;
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;
    controls.keys = [ 65, 83, 68 ];
    controls.addEventListener( 'change', render );
    
    animate();
    render();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    controls.handleResize();
    render();
}
function onDocumentMouseMove( event ) {
    event.preventDefault();
    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    var cell = v3_raycast(voro, mesh, mouse, camera, raycaster);
    console.log(cell);
    v3_toggle_cell(voro, cell, geometry);
    onChangeVertices();
}

function render() {
    renderer.render( scene, camera );
}

function onChangeVertices() {
    geometry.attributes['position'].needsUpdate = true;
    render();
}


function animate() {
//    v3_toggle_cell(voro, Math.floor(Math.random()*voro.cell_count()), geometry);
    controls.update();
    onChangeVertices();
    requestAnimationFrame( animate );

}