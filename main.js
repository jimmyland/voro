// main test code for running the vorojs functions + showing results via threejs
// currently just a chopped up version of a basic threejs example

if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

var scene, camera, renderer;
var geometry, material, mesh, pointset;
var vertices, offset, meshVertsPtr;


function wait_for_ready() {
    if (ready_for_emscripten_calls) {
        init();
    } else {
        requestAnimationFrame( wait_for_ready );
    }
}
wait_for_ready();

function init() {
    
    // quick test of embind's class export stuff
    
//    voro.hi();
//    console.log(voro.min[0]);
    


    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
    camera.position.z = 10;
    
    controls = new THREE.TrackballControls( camera );
    controls.rotateSpeed = 10.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 1.8;
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;
    controls.keys = [ 65, 83, 68 ];
    controls.addEventListener( 'change', render );

    
    geometry = new THREE.BufferGeometry();
    
    var maxMeshVerts = 100000;
    maxMeshVerts = Math.floor(maxMeshVerts/3)*3;
    meshVertsPtr = _malloc(maxMeshVerts*3*4);
//    var meshNumPts = _createVoro(-10, 10, -10, 10, -10, 10,
//                              numPts, offset, maxMeshVerts, meshVertsPtr);
    var voro = new Module.Voro([-10,-10,-10],[10,10,10]);
    var numPts = 1000;
    for (var i=0; i<numPts; i++) {
        voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], Math.random()>.8);
    }
    var meshNumPts = voro.compute_whole_vertex_buffer_fresh(maxMeshVerts, meshVertsPtr);
    voro.delete();

    var array = Module.HEAPF32.subarray(meshVertsPtr/4, meshVertsPtr/4 + meshNumPts*3);
    vertices = new THREE.BufferAttribute(array, 3);
    geometry.addAttribute( 'position', vertices );
    
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
//    var ptsarray = Module.HEAPF32.subarray(offset/4, offset/4 + numPts*3);
//    ptsverts = new THREE.BufferAttribute(ptsarray, 3);
//    ptsgeometry.addAttribute( 'position', ptsverts );
//    ptsmaterial = new THREE.PointsMaterial( { size: .1, color: 0x0000ff } );
//    pointset = new THREE.Points( ptsgeometry, ptsmaterial );
//    scene.add( pointset ); // no longer corresponds to voro cells, todo fix and re-add
    material = new THREE.MeshPhongMaterial( { color: 0xdddddd, specular: 0x009900, shininess: 30, shading: THREE.FlatShading } ) ;
    mesh = new THREE.Mesh( geometry, material );
    scene.add( mesh );
//    edges = new THREE.EdgesHelper( mesh, 0x00ff00 ); scene.add( edges );



    renderer = new THREE.WebGLRenderer();
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.setPixelRatio( window.devicePixelRatio );
    
    window.addEventListener( 'resize', onWindowResize, false );

    container = document.getElementById( 'container' );
    container.appendChild( renderer.domElement );
    
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

function render() {
    renderer.render( scene, camera );
}

function onChangeVertices() {
    vertices.needsUpdate = true;
    render();
}


function animate() {
    requestAnimationFrame( animate );
    controls.update();
}