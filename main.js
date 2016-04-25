// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var scene, camera, renderer;
var geometry, material, mesh, pointset;
var ptgeom, ptcloud;
var voro;
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var controls;

var line;

var datgui;
var settings;

var VoroSettings = function() {
    this.mode = 'add/delete';
};



function make_line(len) {
    var geometry = new THREE.BufferGeometry();
    geometry.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 4 * 3 ), len ) );
    var material = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 2, transparent: false } );
    var line = new THREE.Line( geometry, material );
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

function v3_raycast_vertex_index(voro, mesh, mouse, camera, caster) {
    caster.setFromCamera(mouse, camera);

    var intersects = raycaster.intersectObject(mesh);
    line.visible = intersects.length>0;
    if (intersects.length == 0)
        return -1;
    
    var intersect = intersects[0];
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

function v3_raycast_pt(mesh, mouse, camera, caster) {
    caster.setFromCamera(mouse, camera);
    
    var intersects = raycaster.intersectObject(mesh);
    line.visible = intersects.length>0;
    if (intersects.length == 0)
        return null;
    
    var intersect = intersects[0];
    return intersect.point;
}
function v3_add_cell(voro, pt_3, geometry) {
    var pt = [pt_3.x, pt_3.y, pt_3.z];
    voro.add_cell(pt, true);
    v3_update_geometry(voro, geometry);
    add_pt_to_scene(pt_3);
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

function add_pt_to_scene(pos) {
    var ptgeom = new THREE.Geometry();
    ptgeom.vertices.push(pos);
    var ptmat = new THREE.PointsMaterial( { size: .1, color: 0x0000ff, depthTest: false } );
    var ptcloud = new THREE.Points(ptgeom, ptmat);
    scene.add(ptcloud);
}

//var geometry = v3_build_geometry(voro, {settings}); // build an actual threejs buffergeometry
// note: "geometry" object returned might not be a threejs geometry; might be an object that has a threejs buffergeometry and some extra info
//var gl_buffers = voro.build_gl_buffers(); // v3_build_geometry calls this

function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 30;
    

    

    

    


    // create voro structure w/ bounding box
    voro = new Module.Voro([-10,-10,-10],[10,10,10]);
    var numPts = 1000;
    for (var i=0; i<numPts; i++) {
        voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], false);
    }
    var lastcellid = voro.add_cell([0,0,0], true); // add seed to click
    
    geometry = v3_build_geometry(voro, {});
    
    
//    voro.delete();

    add_pt_to_scene(new THREE.Vector3(0,0,0));
    
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
//    material = new THREE.MeshBasicMaterial( { color: 0xffffff, wireframe: true } ) ;
    mesh = new THREE.Mesh( geometry, material );
//    mesh.raycast = THREE.Mesh.prototype.raycast_fixed;
    scene.add( mesh );
    
    line = make_line(3);
    scene.add(line);
//    edges = new THREE.EdgesHelper( mesh, 0x00ff00 ); scene.add( edges );



    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setPixelRatio( window.devicePixelRatio );
    
    window.addEventListener( 'resize', onWindowResize, false );
    document.addEventListener( 'mousemove', onDocumentMouseMove, false );
    document.addEventListener( 'mousedown', onDocumentMouseDown, false );
    document.addEventListener( 'keydown', onDocumentKeyDown, false );

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
    
    
    datgui = new dat.GUI();
    settings = new VoroSettings();
    datgui.add(settings,'mode',['camera', 'toggle', 'add/delete']).listen();
    
    animate();
    render();
}

function onDocumentKeyDown( event ) {
    if (event.keyCode == 32) {
        if (settings.mode == 'toggle') {
            settings.mode = 'add/delete';
        } else {
            settings.mode = 'toggle';
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    controls.handleResize();
    render();
}
function onDocumentMouseDown( event ) {
    
    if (settings.mode == 'toggle') {
        if (event.button == 2) {
            var cell = v3_raycast(voro, mesh, mouse, camera, raycaster);
            v3_toggle_cell(voro, cell, geometry);
        } else {
            var cell = v3_raycast_neighbor(voro, mesh, mouse, camera, raycaster);
            v3_toggle_cell(voro, cell, geometry);
        }
        v3_raycast(voro, mesh, mouse, camera, raycaster);
        onChangeVertices();
    }
    if (settings.mode == 'add/delete') {
        if (event.button == 2) {
            
        } else {
            var pt = v3_raycast_pt(mesh, mouse, camera, raycaster);
            if (pt) {
                v3_add_cell(voro, pt, geometry);
            }
        }
    }
    
}
function onDocumentMouseMove( event ) {
    event.preventDefault();
    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    var cell = v3_raycast(voro, mesh, mouse, camera, raycaster);
//    console.log(mouse.x +","+mouse.y +": " +cell)
    if (!controls.isActive()) {
        controls.dragEnabled = cell < 0 || settings.mode == 'camera';
    }
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